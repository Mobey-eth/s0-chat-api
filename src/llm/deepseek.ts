import { config } from "../config.js";

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekResponse {
  model: string;
  answer: string;
}

export interface GenerateInput {
  message: string;
  mode: "auto" | "fast" | "deep";
  messages: ChatTurn[];
  docChunkCount: number;
  forceComplex?: boolean;
}

export type ChatLLMErrorCode =
  | "llm_missing_key"
  | "llm_empty_answer"
  | "llm_http_error"
  | "llm_network_error";

export class ChatLLMError extends Error {
  code: ChatLLMErrorCode;
  httpStatus?: number;
  internalDetail?: string;

  constructor(code: ChatLLMErrorCode, internalDetail?: string, httpStatus?: number) {
    super(code);
    this.code = code;
    this.internalDetail = internalDetail;
    this.httpStatus = httpStatus;
  }
}

function pickModel(input: GenerateInput): string {
  if (input.forceComplex) return config.deepseekModelComplex;
  if (input.mode === "fast") return config.deepseekModelFast;
  if (input.mode === "deep") return config.deepseekModelComplex;

  const complexitySignals = [
    /step/i,
    /compare/i,
    /explain/i,
    /why/i,
    /plan/i,
    /create .* presale/i,
    /lock .* for .* days/i,
    /deploy/i,
    /action/i,
    /draft/i,
  ];

  const complex =
    input.message.length > 360 ||
    input.docChunkCount >= 6 ||
    complexitySignals.some((pattern) => pattern.test(input.message));

  return complex ? config.deepseekModelComplex : config.deepseekModelFast;
}

function pickMaxTokens(model: string) {
  return model === config.deepseekModelComplex
    ? config.chatOutputMaxTokensDeep
    : config.chatOutputMaxTokensFast;
}

export async function generateAssistantAnswer(input: GenerateInput) {
  if (!config.deepseekApiKey) {
    throw new ChatLLMError("llm_missing_key", "API key not configured");
  }

  const model = pickModel(input);
  const max_tokens = pickMaxTokens(model);

  let response: Response;
  try {
    response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        stream: false,
        temperature: 0.3,
        max_tokens,
        response_format: { type: "text" },
      }),
    });
  } catch (error) {
    throw new ChatLLMError(
      "llm_network_error",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ChatLLMError("llm_http_error", text || "non-2xx response", response.status);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    model?: string;
  };

  const answer = json.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new ChatLLMError("llm_empty_answer", "no content in choices[0].message");
  }

  return {
    model: json.model ?? model,
    answer,
  } satisfies DeepSeekResponse;
}

// Back-compat alias so the rest of the codebase doesn't need to know the vendor.
export const generateDeepSeekAnswer = generateAssistantAnswer;
