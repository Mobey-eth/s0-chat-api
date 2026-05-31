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
}

function pickModel(input: GenerateInput): string {
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

export async function generateDeepSeekAnswer(input: GenerateInput) {
  if (!config.deepseekApiKey) {
    throw new Error("DEEPSEEK_API_KEY is missing");
  }

  const model = pickModel(input);
  const max_tokens = pickMaxTokens(model);

  const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek request failed with ${response.status}: ${text}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    model?: string;
  };

  const answer = json.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error("DeepSeek returned an empty answer");
  }

  return {
    model: json.model ?? model,
    answer,
  } satisfies DeepSeekResponse;
}
