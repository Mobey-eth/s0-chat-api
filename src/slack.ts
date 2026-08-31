import { config } from "./config.js";

export type SlackMessagePayload = {
  text: string;
  blocks?: unknown[];
};

export async function postSlack(payload: SlackMessagePayload) {
  if (!config.rnsAdminActivitySlackWebhookUrl) return false;

  const response = await fetch(config.rnsAdminActivitySlackWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Slack webhook failed with status ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  return true;
}
