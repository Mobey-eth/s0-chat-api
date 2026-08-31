import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  classifyAndBuildAction,
  continueActionDraft,
  detectPageOnlyActionIntent,
  detectQuickActionIntent,
  getActionFollowUp,
  getActionReadyReply,
  buildOpenDashboard,
  buildOpenRoute,
  startQuickAction,
  suggestForDraftField,
  updateCompletedActionDraft,
} from "../actions/builder.js";
import type { ActionDraft, ActionType } from "../actions/types.js";
import { ACTION_TYPES } from "../actions/types.js";
import {
  appendChatMessage,
  countSessionUserMessages,
  createChatSession,
  getLatestActionDraft,
  getSessionMessages,
  getOffTopicStrikes,
  incrementOffTopicStrikes,
  insertToolRun,
  logChatError,
  resetOffTopicStrikes,
  saveActionDraft,
  takeRateLimit,
} from "../db.js";
import {
  guardActionDraft,
  guardAssistantOutput,
  guardUserMessage,
  looksUnreadable,
  stripSelfDescription,
  stripVendorMentions,
} from "../guardrails.js";
import {
  ChatLLMError,
  generateAssistantAnswer,
} from "../llm/deepseek.js";
import {
  SENNA_OPENERS,
  SENNA_LLM_RECOVERY,
  SENNA_LLM_UNAVAILABLE,
  SENNA_TYPO_CLARIFY,
  buildOffTopicConcisePromptBlock,
} from "../prompts/senna.js";
import { buildSystemPrompt } from "../prompts/system.js";
import { retrieveDocContext } from "../retrieval/docs.js";
import { buildExplorerTxUrl, buildStage0ContextBlock, extractTxHashFromText } from "../tools/stage0.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(config.chatInputMaxChars),
});

const requestSchema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  mode: z.enum(["auto", "fast", "deep"]).default("auto"),
  messages: z.array(messageSchema).min(1).max(30),
  walletAddress: z.string().optional(),
  evmAddress: z.string().optional(),
  chainId: z.coerce.number().int().positive().optional(),
  quickAction: z.enum(ACTION_TYPES).optional(),
});

function buildRequesterKey(input: {
  ip: string;
  userAgent: string;
  walletAddress?: string;
  evmAddress?: string;
}) {
  const identity =
    input.evmAddress ??
    input.walletAddress ??
    createHash("sha256").update(`${input.ip}|${input.userAgent}`).digest("hex");

  return identity.toLowerCase();
}

function cleanAssistantAnswer(answer: string) {
  const stripped = stripSelfDescription(answer);
  const noVendors = stripVendorMentions(stripped);
  return noVendors
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/^\s*Source:.*$/gim, "")
    .replace(/^\s*https?:\/\/\S+\s*$/gim, "")
    .replace(/\bFull steps here:\s*https?:\/\/\S+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pickShortReply(replies: string[]) {
  return replies[Math.floor(Math.random() * replies.length)];
}

function buildInstantReply(message: string): string | null {
  const normalized = message.trim().toLowerCase();

  if (/^(hi|hello|hey|yo|sup|gm|good morning|good afternoon|good evening)[.!?\s]*$/.test(normalized)) {
    return pickShortReply(SENNA_OPENERS);
  }

  if (/^(thanks|thank you|appreciate it|nice|cool)[.!?\s]*$/.test(normalized)) {
    return pickShortReply([
      "Anytime, happy to help.",
      "You got it. What else should we sort out?",
      "Glad that helped.",
      "Clean line. What should we tackle next?",
    ]);
  }

  return null;
}

const QUICK_ACTION_LABELS: Partial<Record<ActionType, string>> = {
  create_token: "create a token",
  lock_token: "lock tokens",
  airdrop_tokens: "set up an airdrop",
  buy_name: "register a .rise name",
};

function isAffirmativeConfirmation(message: string) {
  return /^(yes|yeah|yep|yup|sure|correct|right|that'?s right|please|start|start it|go ahead|do it|sounds good|exactly)\b/i.test(
    message.trim(),
  );
}

function isNegativeConfirmation(message: string) {
  return /^(no|nope|nah|cancel|stop|not that|never mind|nevermind)\b/i.test(message.trim());
}

function stripConfirmationPrefix(message: string) {
  return message
    .trim()
    .replace(/^(yes|yeah|yep|yup|sure|correct|right|that'?s right|please|start|start it|go ahead|do it|sounds good|exactly)[,!.:\s]*/i, "")
    .trim();
}

function actionDraftProgressed(blank: ActionDraft, next: ActionDraft) {
  return next.missingFields.length < blank.missingFields.length;
}

function seedHasExplicitQuickActionDetails(actionType: ActionType, message: string) {
  if (!message.trim()) return false;

  if (actionType === "create_token") {
    return /\b(?:called|named|name\s*(?:is|=|:)|symbol|ticker|supply|amount|decimals?|token\s*type|plain|mintable|burnable|taxable|non[-\s]?mintable|fixed\s+supply)\b/i.test(
      message,
    );
  }

  if (actionType === "lock_token") {
    return /\b0x[a-fA-F0-9]{40}\b/.test(message) || /\b(?:amount|lock\s+\d|vest\s+\d|days?|duration|description|label|called|named)\b/i.test(message);
  }

  if (actionType === "airdrop_tokens") {
    return /\b0x[a-fA-F0-9]{40}\b/.test(message) || /\b(?:native|eth|recipients?|airdrop\s+\d|send\s+\d)\b/i.test(message);
  }

  if (actionType === "buy_name") {
    return /\.rise\b/i.test(message) || /\b(?:name|domain|rns)\s*(?:is|=|:)|\b(?:called|named)\s+/i.test(message);
  }

  return false;
}

async function getPendingQuickAction(sessionId: string): Promise<{ actionType: ActionType; seedMessage: string } | null> {
  const recent = await getSessionMessages(sessionId, 12);
  const latestAssistant = [...recent].reverse().find((message) => message.role === "assistant");
  const meta = latestAssistant?.meta_json;
  if (!meta || typeof meta !== "object") return null;

  const pending = meta as { pendingQuickAction?: string; pendingUserMessage?: string };
  if (!pending.pendingQuickAction) return null;
  if (!ACTION_TYPES.includes(pending.pendingQuickAction as ActionType)) return null;

  const actionType = pending.pendingQuickAction as ActionType;
  if (!(actionType in QUICK_ACTION_LABELS)) return null;

  return {
    actionType,
    seedMessage: pending.pendingUserMessage ?? "",
  };
}

async function respondWithQuickActionConfirmation(input: {
  sessionId: string;
  actionType: ActionType;
  userMessage: string;
}) {
  const label = QUICK_ACTION_LABELS[input.actionType] ?? "start this flow";
  const answer = `Sounds like you want to ${label}. Should I start that flow?`;

  await appendChatMessage({
    sessionId: input.sessionId,
    role: "assistant",
    content: answer,
    metaJson: {
      pendingQuickAction: input.actionType,
      pendingUserMessage: input.userMessage,
    },
  });

  return {
    blocked: false,
    sessionId: input.sessionId,
    answer,
    citations: [] as string[],
    actionDraft: null,
    suggestions: ["Yes, start it", "No, cancel"],
  };
}

async function respondWithWalletRequiredForAction(input: {
  sessionId: string;
  actionType?: ActionType;
}) {
  const label = input.actionType ? QUICK_ACTION_LABELS[input.actionType] : null;
  const answer = label
    ? `Connect your wallet first, then I can help you ${label} and prepare the signing step.`
    : "Connect your wallet first, then I can prepare that action for signing.";

  await appendChatMessage({
    sessionId: input.sessionId,
    role: "assistant",
    content: answer,
    metaJson: {
      walletRequired: true,
      actionType: input.actionType,
    },
  });

  return {
    blocked: true,
    blockReason: "wallet_required",
    sessionId: input.sessionId,
    answer,
    citations: [] as string[],
    actionDraft: null,
    suggestions: [] as string[],
  };
}

function llmErrorToUserMessage(error: ChatLLMError): string {
  switch (error.code) {
    case "llm_empty_answer":
      return pickShortReply(SENNA_LLM_RECOVERY);
    case "llm_http_error":
    case "llm_network_error":
    case "llm_missing_key":
      return pickShortReply(SENNA_LLM_UNAVAILABLE);
    default:
      return pickShortReply(SENNA_LLM_UNAVAILABLE);
  }
}

function actionDraftToResponse(draft: ActionDraft) {
  return {
    actionType: draft.actionType,
    targetRoute: draft.targetRoute,
    requiredWallet: draft.requiredWallet,
    requiredChain: draft.requiredChain,
    prefill: draft.prefill,
    summary: draft.summary,
    warnings: draft.warnings,
    missingFields: draft.missingFields,
    nextSteps: draft.nextSteps,
  };
}

function actionDraftFromStored(stored: NonNullable<Awaited<ReturnType<typeof getLatestActionDraft>>>): ActionDraft {
  return {
    actionType: stored.actionType as ActionType,
    targetRoute: stored.route,
    requiredWallet: (stored.requiredWallet as "evm" | null) ?? null,
    requiredChain: (stored.requiredChain as "rise_mainnet" | null) ?? null,
    prefill: stored.prefill,
    summary: stored.summary,
    warnings: stored.warnings,
    missingFields: stored.missingFields,
    nextSteps: stored.nextSteps,
  };
}

function walletStateBlock(input: { hasConnectedWallet: boolean; evmAddress?: string; walletAddress?: string; chainId?: number }) {
  if (!input.hasConnectedWallet) {
    return "Wallet state: no wallet address was sent with this chat request. For wallet-specific sections, tell the user to connect a wallet to load personalized data.";
  }

  const address = input.evmAddress ?? input.walletAddress ?? "connected";
  return [
    `Wallet state: connected wallet ${address}.`,
    input.chainId ? `Connected chain ID: ${input.chainId}.` : "Connected chain ID was not sent.",
    "Do not tell the user to connect a wallet unless a wallet-gated action specifically fails.",
  ].join("\n");
}

function buildRouteDraft(route: string, summary: string) {
  if (route === "/dashboard") return buildOpenDashboard();
  if (route === "/my-nfts" || route === "/tokens") return buildOpenRoute(route, summary, { requiredWallet: "evm" });
  return buildOpenRoute(route, summary);
}

function getRouteReply(input: { route: string; fallback: string; hasConnectedWallet: boolean }) {
  if (input.route === "/dashboard") {
    return input.hasConnectedWallet
      ? "Opening your dashboard."
      : "Dashboard needs your wallet to load your activity. Use the button below, then connect.";
  }

  if (input.route === "/my-nfts") {
    return input.hasConnectedWallet
      ? "Opening your collectibles."
      : "Collectibles need your wallet to load holdings. Use the button below, then connect.";
  }

  if (input.route === "/tokens") {
    return input.hasConnectedWallet
      ? "Opening your tokens."
      : "Tokens need your wallet to load your assets. Use the button below, then connect.";
  }

  return input.fallback;
}

async function persistAndRespondDraft(args: {
  sessionId: string;
  draft: ActionDraft;
  reply: string;
  isReady: boolean;
}) {
  const { sessionId, draft, reply, isReady } = args;
  const actionGuard = guardActionDraft(draft);
  if (actionGuard.valid) {
    await saveActionDraft({
      sessionId,
      actionType: draft.actionType,
      route: draft.targetRoute,
      requiredWallet: draft.requiredWallet ?? undefined,
      requiredChain: draft.requiredChain ?? undefined,
      prefillJson: draft.prefill,
      summary: draft.summary,
      warningsJson: draft.warnings,
      missingFieldsJson: draft.missingFields,
      nextStepsJson: draft.nextSteps,
    });
  }

  await appendChatMessage({
    sessionId,
    role: "assistant",
    content: reply,
    metaJson: { actionType: draft.actionType, ready: isReady },
  });

  return {
    blocked: false,
    sessionId,
    answer: reply,
    citations: [] as string[],
    actionDraft: isReady ? actionDraftToResponse(draft) : null,
    suggestions: isReady ? [] : suggestForDraftField(draft),
  };
}

async function buildPostTurnSuggestions(input: {
  sessionId: string;
  lastUserMessage: string;
  lastAssistantAnswer: string;
}): Promise<string[]> {
  if (!config.deepseekApiKey) return [];
  try {
    const result = await generateAssistantAnswer({
      message: input.lastUserMessage,
      mode: "fast",
      docChunkCount: 0,
      messages: [
        {
          role: "system",
          content: [
            "You generate 1 to 3 very short follow-up prompts that the user might tap.",
            "Each suggestion must be 5 words or fewer, no quotes, no trailing punctuation.",
            "Suggestions must keep the user inside Stage0 topics (token, NFT, lock, airdrop, name, launch, dashboard, presale, wallet, RISE Mainnet).",
            "Output STRICT JSON: an array of strings. No commentary.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "Previous user message:",
            input.lastUserMessage,
            "",
            "Senna's reply:",
            input.lastAssistantAnswer,
            "",
            "Now produce the JSON array.",
          ].join("\n"),
        },
      ],
    });

    const text = result.answer.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/^["'\s]+|["'\s]+$/g, "").trim())
      .filter((item) => item.length > 0 && item.length <= 36)
      .slice(0, 3);
  } catch (error) {
    if (error instanceof ChatLLMError) {
      await logChatError({
        sessionId: input.sessionId,
        scope: "suggestions",
        code: error.code,
        internalMessage: error.internalDetail,
        httpStatus: error.httpStatus,
      });
    }
    return [];
  }
}

export async function registerChatRoutes(app: FastifyInstance) {
  app.post("/api/chat", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.flatten(),
      });
    }

    const input = parsed.data;
    const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
    if (!latestUserMessage) {
      return reply.code(400).send({ error: "missing_user_message" });
    }

    const requesterKey = buildRequesterKey({
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? "unknown",
      walletAddress: input.walletAddress,
      evmAddress: input.evmAddress,
    });

    const rateWindow = await takeRateLimit({
      scope: "chat_api",
      subject: requesterKey,
      windowSeconds: config.rateLimitWindowSeconds,
    });

    if (rateWindow.hits > config.rateLimitMaxRequests) {
      return reply.code(429).send({
        error: "rate_limited",
        detail: "Slow down for a few seconds and try again.",
      });
    }

    const guard = guardUserMessage(latestUserMessage.content);
    if (!guard.allowed) {
      return reply.code(200).send({
        blocked: true,
        blockReason: "guard",
        answer: guard.reason,
        sessionId: input.sessionId ?? null,
        citations: [],
        actionDraft: null,
        suggestions: [],
      });
    }

    const hasConnectedWallet = Boolean(input.walletAddress || input.evmAddress);
    const sessionId =
      input.sessionId ??
      (await createChatSession({
        walletAddress: input.walletAddress,
        evmAddress: input.evmAddress,
        title: latestUserMessage.content.slice(0, 120),
      }));

    if (!hasConnectedWallet) {
      const guestPromptCount = await countSessionUserMessages(sessionId);
      const softCapStart = config.guestPromptLimit;
      const hardCapStart = config.guestPromptLimit + 2;

      if (guestPromptCount >= hardCapStart) {
        return reply.code(200).send({
          blocked: true,
          blockReason: "guest_limit_hard",
          answer: "Guest cap reached. Connect a wallet to keep going.",
          sessionId,
          citations: [],
          actionDraft: null,
          suggestions: [],
        });
      }

      if (guestPromptCount >= softCapStart) {
        const softReply =
          guestPromptCount === softCapStart
            ? "You've hit the 5-prompt guest limit. Connect a wallet to keep chatting, your session is saved."
            : "Still in guest mode. Connect a wallet and we'll pick this back up.";

        await appendChatMessage({
          sessionId,
          role: "user",
          content: latestUserMessage.content,
        });
        await appendChatMessage({
          sessionId,
          role: "assistant",
          content: softReply,
        });

        return reply.code(200).send({
          blocked: true,
          blockReason: "guest_limit_soft",
          answer: softReply,
          sessionId,
          citations: [],
          actionDraft: null,
          suggestions: [],
        });
      }
    }

    await appendChatMessage({
      sessionId,
      role: "user",
      content: latestUserMessage.content,
    });

    // Quick action short-circuit: user tapped a `/` shortcut.
    if (input.quickAction) {
      if (!hasConnectedWallet) {
        return respondWithWalletRequiredForAction({ sessionId, actionType: input.quickAction });
      }

      const blank = startQuickAction(input.quickAction);
      if (blank) {
        const merged = continueActionDraft(blank, latestUserMessage.content) ?? blank;
        const isReady = merged.missingFields.length === 0;
        const reply = isReady ? getActionReadyReply(merged) : getActionFollowUp(merged);
        return persistAndRespondDraft({ sessionId, draft: merged, reply, isReady });
      }
    }

    const pendingQuickAction = await getPendingQuickAction(sessionId);
    if (pendingQuickAction) {
      if (isNegativeConfirmation(latestUserMessage.content)) {
        const answer = "No problem. What would you like to do instead?";
        await appendChatMessage({
          sessionId,
          role: "assistant",
          content: answer,
          metaJson: { pendingQuickActionCleared: pendingQuickAction.actionType },
        });
        return {
          blocked: false,
          sessionId,
          answer,
          citations: [],
          actionDraft: null,
          suggestions: [],
        };
      }

      if (!hasConnectedWallet) {
        return respondWithWalletRequiredForAction({
          sessionId,
          actionType: pendingQuickAction.actionType,
        });
      }

      const blank = startQuickAction(pendingQuickAction.actionType);
      if (blank) {
        const confirmed = isAffirmativeConfirmation(latestUserMessage.content);
        const latestForMerge = confirmed
          ? stripConfirmationPrefix(latestUserMessage.content)
          : latestUserMessage.content;
        const seed = confirmed && seedHasExplicitQuickActionDetails(pendingQuickAction.actionType, pendingQuickAction.seedMessage)
          ? pendingQuickAction.seedMessage
          : "";
        const seedMessage = [seed, latestForMerge].filter(Boolean).join("\n");
        const merged =
          (seedMessage ? continueActionDraft(blank, seedMessage) : null) ??
          (latestForMerge ? continueActionDraft(blank, latestForMerge) : null) ??
          blank;

        if (confirmed || actionDraftProgressed(blank, merged)) {
          await resetOffTopicStrikes(sessionId);
          const isReady = merged.missingFields.length === 0;
          const responseReply = isReady ? getActionReadyReply(merged) : getActionFollowUp(merged);
          return persistAndRespondDraft({ sessionId, draft: merged, reply: responseReply, isReady });
        }
      }

      return respondWithQuickActionConfirmation({
        sessionId,
        actionType: pendingQuickAction.actionType,
        userMessage: pendingQuickAction.seedMessage || latestUserMessage.content,
      });
    }

    const pageOnlyAction = detectPageOnlyActionIntent(latestUserMessage.content);
    if (pageOnlyAction) {
      await resetOffTopicStrikes(sessionId);
      const routeDraft = buildRouteDraft(pageOnlyAction.route, pageOnlyAction.summary);
      return persistAndRespondDraft({
        sessionId,
        draft: routeDraft,
        reply: getRouteReply({
          route: pageOnlyAction.route,
          fallback: pageOnlyAction.reply,
          hasConnectedWallet,
        }),
        isReady: true,
      });
    }

    const quickActionIntent = detectQuickActionIntent(latestUserMessage.content);
    if (quickActionIntent) {
      await resetOffTopicStrikes(sessionId);
      if (!hasConnectedWallet) {
        return respondWithWalletRequiredForAction({
          sessionId,
          actionType: quickActionIntent,
        });
      }

      return respondWithQuickActionConfirmation({
        sessionId,
        actionType: quickActionIntent,
        userMessage: latestUserMessage.content,
      });
    }

    // Friendly clarify on totally garbled input — saves an LLM call.
    if (looksUnreadable(latestUserMessage.content)) {
      const clarify = pickShortReply(SENNA_TYPO_CLARIFY);
      await appendChatMessage({ sessionId, role: "assistant", content: clarify });
      return {
        blocked: false,
        sessionId,
        answer: clarify,
        citations: [],
        actionDraft: null,
        suggestions: [],
      };
    }

    const instantReply = buildInstantReply(latestUserMessage.content);
    if (instantReply) {
      await appendChatMessage({
        sessionId,
        role: "assistant",
        content: instantReply,
      });
      await resetOffTopicStrikes(sessionId);
      return {
        blocked: false,
        sessionId,
        answer: instantReply,
        citations: [],
        actionDraft: null,
        suggestions: [],
      };
    }

    // --- Rule-based action classification ---
    const latestDraftRow = await getLatestActionDraft(sessionId);
    let ruleAction: ActionDraft | null = null;
    let updatedCompletedDraft = false;

    if (latestDraftRow && latestDraftRow.missingFields.length > 0) {
      const existing = actionDraftFromStored(latestDraftRow);
      ruleAction = continueActionDraft(existing, latestUserMessage.content);
    } else if (latestDraftRow) {
      const existing = actionDraftFromStored(latestDraftRow);
      ruleAction = updateCompletedActionDraft(existing, latestUserMessage.content);
      updatedCompletedDraft = Boolean(ruleAction);
    }

    if (!ruleAction) {
      ruleAction = classifyAndBuildAction(latestUserMessage.content);
    }

    if (ruleAction) {
      await resetOffTopicStrikes(sessionId);
      if (!hasConnectedWallet && ruleAction.requiredWallet) {
        return respondWithWalletRequiredForAction({
          sessionId,
          actionType: ruleAction.actionType,
        });
      }

      const isReady = ruleAction.missingFields.length === 0;
      const responseReply = updatedCompletedDraft && isReady
        ? "Updated. Take another look before signing."
        : isReady
          ? getActionReadyReply(ruleAction)
          : getActionFollowUp(ruleAction);
      return persistAndRespondDraft({ sessionId, draft: ruleAction, reply: responseReply, isReady });
    }

    // --- Off-topic tiered redirect ---
    if (guard.isOffTopic) {
      const strikes = await incrementOffTopicStrikes(sessionId);
      const strikeIndex = Math.max(0, strikes - 1);

      try {
        const offTopic = await generateAssistantAnswer({
          message: latestUserMessage.content,
          mode: "fast",
          docChunkCount: 0,
          forceComplex: false,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "system", content: buildOffTopicConcisePromptBlock(strikeIndex) },
            { role: "user", content: latestUserMessage.content },
          ],
        });

        const safeAnswer = cleanAssistantAnswer(offTopic.answer);
        await appendChatMessage({
          sessionId,
          role: "assistant",
          content: safeAnswer,
          metaJson: { offTopic: true, strikeIndex },
        });

        const suggestions =
          strikeIndex >= 2
            ? []
            : await buildPostTurnSuggestions({
                sessionId,
                lastUserMessage: latestUserMessage.content,
                lastAssistantAnswer: safeAnswer,
              });

        return {
          blocked: false,
          sessionId,
          answer: safeAnswer,
          citations: [],
          actionDraft: null,
          suggestions,
        };
      } catch (error) {
        if (error instanceof ChatLLMError) {
          await logChatError({
            sessionId,
            scope: "off_topic",
            code: error.code,
            internalMessage: error.internalDetail,
            httpStatus: error.httpStatus,
          });
          logger.error("Senna LLM call failed (off-topic path)", {
            code: error.code,
            httpStatus: error.httpStatus,
          });
        }
        const fallback = llmErrorToUserMessage(error as ChatLLMError);
        await appendChatMessage({ sessionId, role: "assistant", content: fallback });
        return {
          blocked: false,
          sessionId,
          answer: fallback,
          citations: [],
          actionDraft: null,
          suggestions: [],
        };
      }
    }

    // --- Retrieval ---
    const retrieval = await retrieveDocContext(latestUserMessage.content);
    await insertToolRun({
      sessionId,
      toolName: "retrieve_doc_context",
      inputJson: { query: latestUserMessage.content },
      outputJson: { citations: retrieval.citations, chunks: retrieval.chunks.length },
      status: "ok",
    });

    const docContextBlock =
      retrieval.chunks.length > 0
        ? [
            "Grounding context from Stage0 docs:",
            ...retrieval.chunks.map((chunk, index) =>
              `[Doc ${index + 1}] URL: ${chunk.source_url}\nHeading: ${chunk.heading_path ?? chunk.title ?? "Untitled"}\nContent: ${chunk.chunk_text}`,
            ),
          ].join("\n\n")
        : "No matching Stage0 docs were retrieved.";

    // --- Stable app and network context ---
    const stage0Block = buildStage0ContextBlock();
    const txHash = extractTxHashFromText(latestUserMessage.content);

    if (txHash) {
      const explorerUrl = buildExplorerTxUrl(txHash);
      await insertToolRun({
        sessionId,
        toolName: "build_rise_explorer_tx_link",
        inputJson: { txHash },
        outputJson: { explorerUrl },
        status: "ok",
      });
    }

    const txContextBlock = txHash
      ? [
          "RISE transaction hash detected:",
          `Transaction hash: ${txHash}`,
          `Explorer link: ${buildExplorerTxUrl(txHash)}`,
          "Only provide this explorer link unless a later tool adds live transaction status.",
        ].join("\n")
      : "No RISE transaction hash was detected in this message.";
    const walletContextBlock = walletStateBlock({
      hasConnectedWallet,
      evmAddress: input.evmAddress,
      walletAddress: input.walletAddress,
      chainId: input.chainId,
    });

    try {
      const completion = await generateAssistantAnswer({
        message: latestUserMessage.content,
        mode: input.mode,
        docChunkCount: retrieval.chunks.length,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "system", content: stage0Block },
          { role: "system", content: walletContextBlock },
          { role: "system", content: txContextBlock },
          { role: "system", content: docContextBlock },
          ...input.messages,
        ],
      });

      const outputGuard = guardAssistantOutput(completion.answer);
      const safeAnswer = outputGuard.valid
        ? cleanAssistantAnswer(completion.answer)
        : "I can help with Stage0 usage, RISE setup, launches, NFTs, tokens, locks, airdrops, and names. I'll stay out of internal details.";

      await appendChatMessage({
        sessionId,
        role: "assistant",
        content: safeAnswer,
        citationsJson: retrieval.citations,
        metaJson: { ok: true },
      });

      await resetOffTopicStrikes(sessionId);

      const suggestions = await buildPostTurnSuggestions({
        sessionId,
        lastUserMessage: latestUserMessage.content,
        lastAssistantAnswer: safeAnswer,
      });

      return {
        blocked: false,
        sessionId,
        answer: safeAnswer,
        citations: retrieval.citations,
        actionDraft: null,
        suggestions,
      };
    } catch (error) {
      if (error instanceof ChatLLMError) {
        await logChatError({
          sessionId,
          scope: "chat",
          code: error.code,
          internalMessage: error.internalDetail,
          httpStatus: error.httpStatus,
        });
        logger.error("Senna LLM call failed", {
          code: error.code,
          httpStatus: error.httpStatus,
        });
        const userMessage = llmErrorToUserMessage(error);
        await appendChatMessage({ sessionId, role: "assistant", content: userMessage });
        return {
          blocked: false,
          sessionId,
          answer: userMessage,
          citations: [],
          actionDraft: null,
          suggestions: [],
        };
      }

      await logChatError({
        sessionId,
        scope: "chat",
        code: "unknown_error",
        internalMessage: error instanceof Error ? error.message : String(error),
      });
      logger.error("Senna chat path threw", {
        error: error instanceof Error ? error.message : String(error),
      });
      const fallback = pickShortReply(SENNA_LLM_UNAVAILABLE);
      await appendChatMessage({ sessionId, role: "assistant", content: fallback });
      return {
        blocked: false,
        sessionId,
        answer: fallback,
        citations: [],
        actionDraft: null,
        suggestions: [],
      };
    }
  });
}
