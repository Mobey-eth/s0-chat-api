import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { classifyAndBuildAction, continueActionDraft, getActionFollowUp, getActionReadyReply } from "../actions/builder.js";
import type { ActionDraft } from "../actions/types.js";
import { appendChatMessage, countSessionUserMessages, createChatSession, getLatestActionDraft, insertToolRun, saveActionDraft, takeRateLimit } from "../db.js";
import { guardActionDraft, guardAssistantOutput, guardUserMessage, stripSelfDescription } from "../guardrails.js";
import { generateDeepSeekAnswer } from "../llm/deepseek.js";
import { SENNA_OPENERS } from "../prompts/senna.js";
import { buildSystemPrompt } from "../prompts/system.js";
import { retrieveDocContext } from "../retrieval/docs.js";
import { buildExplorerTxUrl, buildStage0ContextBlock, extractTxHashFromText } from "../tools/stage0.js";
import { config } from "../config.js";

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
  return stripSelfDescription(answer)
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
      "Anytime.",
      "You got it.",
      "Easy pit stop.",
      "Clean line.",
    ]);
  }

  return null;
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
        detail: "Too many chat requests right now. Give Senna a few seconds and try again.",
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
          answer: "Guest cap reached. Connect a wallet to continue.",
          sessionId,
          citations: [],
          actionDraft: null,
        });
      }

      if (guestPromptCount >= softCapStart) {
        const softReply =
          guestPromptCount === softCapStart
            ? "You've used your 5 guest prompts. Connect a wallet to keep chatting - your session is saved."
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
        });
      }
    }

    await appendChatMessage({
      sessionId,
      role: "user",
      content: latestUserMessage.content,
    });

    const instantReply = buildInstantReply(latestUserMessage.content);
    if (instantReply) {
      await appendChatMessage({
        sessionId,
        role: "assistant",
        content: instantReply,
      });

      return {
        blocked: false,
        sessionId,
        answer: instantReply,
        citations: [],
        actionDraft: null,
      };
    }

    // --- Rule-based action classification ---
    const latestDraft = await getLatestActionDraft(sessionId);
    let ruleAction: ActionDraft | null =
      latestDraft && latestDraft.missingFields.length > 0
        ? continueActionDraft(
            {
              actionType: latestDraft.actionType as ActionDraft["actionType"],
              targetRoute: latestDraft.route,
              requiredWallet: (latestDraft.requiredWallet as "evm" | null) ?? null,
              requiredChain: (latestDraft.requiredChain as "rise_testnet" | null) ?? null,
              prefill: latestDraft.prefill,
              summary: latestDraft.summary,
              warnings: latestDraft.warnings,
              missingFields: latestDraft.missingFields,
              nextSteps: latestDraft.nextSteps,
            },
            latestUserMessage.content,
          )
        : null;

    if (!ruleAction) {
      ruleAction = classifyAndBuildAction(latestUserMessage.content);
    }

    if (ruleAction) {
      const actionGuard = guardActionDraft(ruleAction);
      if (actionGuard.valid) {
        await saveActionDraft({
          sessionId,
          actionType: ruleAction.actionType,
          route: ruleAction.targetRoute,
          requiredWallet: ruleAction.requiredWallet ?? undefined,
          requiredChain: ruleAction.requiredChain ?? undefined,
          prefillJson: ruleAction.prefill,
          summary: ruleAction.summary,
          warningsJson: ruleAction.warnings,
          missingFieldsJson: ruleAction.missingFields,
          nextStepsJson: ruleAction.nextSteps,
        });
      }

      if (ruleAction.missingFields.length > 0) {
        const followUp = getActionFollowUp(ruleAction);
        await appendChatMessage({
          sessionId,
          role: "assistant",
          content: followUp,
        });

        return {
          blocked: false,
          sessionId,
          answer: followUp,
          citations: [],
          actionDraft: null,
        };
      }

      const actionReply = getActionReadyReply(ruleAction);
      await appendChatMessage({
        sessionId,
        role: "assistant",
        content: actionReply,
        metaJson: { actionType: ruleAction.actionType },
      });

      return {
        blocked: false,
        sessionId,
        answer: actionReply,
        citations: [],
        actionDraft: {
          actionType: ruleAction.actionType,
          targetRoute: ruleAction.targetRoute,
          requiredWallet: ruleAction.requiredWallet,
          requiredChain: ruleAction.requiredChain,
          prefill: ruleAction.prefill,
          summary: ruleAction.summary,
          warnings: ruleAction.warnings,
          missingFields: ruleAction.missingFields,
          nextSteps: ruleAction.nextSteps,
        },
      };
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

    try {
      const completion = await generateDeepSeekAnswer({
        message: latestUserMessage.content,
        mode: input.mode,
        docChunkCount: retrieval.chunks.length,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "system", content: stage0Block },
          { role: "system", content: txContextBlock },
          { role: "system", content: docContextBlock },
          ...input.messages,
        ],
      });

      const outputGuard = guardAssistantOutput(completion.answer);
      const safeAnswer = outputGuard.valid
        ? cleanAssistantAnswer(completion.answer)
        : "I can help with Stage0 usage, RISE setup, launch support, and action drafts, but I'm not going into internal or sensitive details.";

      await appendChatMessage({
        sessionId,
        role: "assistant",
        content: safeAnswer,
        citationsJson: retrieval.citations,
        metaJson: { model: completion.model },
      });

      return {
        blocked: false,
        sessionId,
        model: completion.model,
        answer: safeAnswer,
        citations: retrieval.citations,
        actionDraft: null,
      };
    } catch (error) {
      return reply.code(503).send({
        error: "chat_unavailable",
        sessionId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
