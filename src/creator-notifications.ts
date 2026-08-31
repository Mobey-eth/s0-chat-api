import { config } from "./config.js";
import type { CreatorApplicationRecord } from "./db.js";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeSlack(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function optional(value: string | undefined) {
  return value?.trim() || "Not provided";
}

function detailLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function applicationRows(application: CreatorApplicationRecord) {
  const common = [
    ["Application", application.applicationType === "nft" ? "NFT collection" : "Token launch"],
    ["Project", application.projectName],
    ["Stage", application.projectStage],
    ["Founder", `${application.founderName} · ${application.founderRole}`],
    ["Founder wallet", application.applicantWallet],
    ["Address supplied", application.founderAddressInput],
    ["Founder email", application.founderEmail],
    ["Website", optional(application.projectWebsiteUrl)],
    ["Project X", optional(application.projectX)],
    ["Project Telegram", optional(application.projectTelegram)],
    ["Project Discord", optional(application.projectDiscord)],
    ["Founder X", optional(application.founderX)],
    ["Founder Telegram", optional(application.founderTelegram)],
    ["Founder Discord", optional(application.founderDiscord)],
  ];
  const specifics = Object.entries(application.projectDetails).map(([key, value]) => [
    detailLabel(key),
    value || "Not provided",
  ]);
  return [...common, ...specifics] as Array<[string, string]>;
}

function teamText(application: CreatorApplicationRecord) {
  if (application.teamMembers.length === 0) return "Solo founder / no team supplied";
  return application.teamMembers
    .map((member, index) => {
      const handles = [member.x, member.telegram, member.discord].filter(Boolean).join(" · ");
      return `${index + 1}. ${member.name} — ${member.role}${handles ? ` (${handles})` : ""}`;
    })
    .join("\n");
}

async function sendSlack(application: CreatorApplicationRecord) {
  if (!config.rnsAdminActivitySlackWebhookUrl) return "skipped" as const;

  const title = application.applicationType === "nft" ? "New NFT creator application" : "New token launch application";
  const rows = applicationRows(application);
  const fields = rows.slice(0, 10).map(([label, value]) => ({
    type: "mrkdwn",
    text: `*${escapeSlack(label)}*\n${escapeSlack(value).slice(0, 900)}`,
  }));
  const response = await fetch(config.rnsAdminActivitySlackWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `${title}: ${application.projectName}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: title } },
        { type: "section", text: { type: "mrkdwn", text: `*${escapeSlack(application.projectName)}*\n${escapeSlack(application.projectDescription).slice(0, 2600)}` } },
        { type: "section", fields },
        { type: "section", text: { type: "mrkdwn", text: `*Team*\n${escapeSlack(teamText(application)).slice(0, 2800)}` } },
        ...(application.imageUrl
          ? [{ type: "image", image_url: application.imageUrl, alt_text: `${application.projectName} project image` }]
          : []),
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Review in Stage0" },
              url: `${config.stage0AppUrl}/admin`,
            },
          ],
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `${config.riseNetworkName} (${application.chainId}) · Application ${application.id}` },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Slack webhook failed with status ${response.status}`);
  return "sent" as const;
}

async function sendEmail(application: CreatorApplicationRecord) {
  if (!config.resendApiKey) return "skipped" as const;

  const rows = applicationRows(application)
    .map(
      ([label, value]) => `<tr>
        <td style="padding:9px 0;color:#829188;font-size:13px;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:9px 0 9px 18px;color:#f5f7f5;font-size:13px;font-weight:700;text-align:right;vertical-align:top;word-break:break-word;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join("");
  const team = escapeHtml(teamText(application)).replace(/\n/g, "<br>");
  const image = application.imageUrl
    ? `<img src="${escapeHtml(application.imageUrl)}" alt="${escapeHtml(application.projectName)}" style="display:block;width:100%;max-height:360px;object-fit:cover;border-radius:18px;margin:0 0 24px;">`
    : "";
  const kind = application.applicationType === "nft" ? "NFT creator" : "token launch";
  const html = `<!doctype html>
    <html><body style="margin:0;padding:32px 16px;background:#edf1ed;font-family:Arial,sans-serif;color:#f5f7f5;">
      <div style="max-width:680px;margin:0 auto;overflow:hidden;border-radius:24px;background:#0d1812;border:1px solid #203328;">
        <div style="padding:22px 28px;border-bottom:1px solid #203328;background:#101f16;color:#b8f34a;font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;">Stage0 creator intake</div>
        <div style="padding:30px 28px 26px;">
          <h1 style="margin:0 0 8px;font-size:28px;line-height:1.15;color:#fff;">New ${escapeHtml(kind)} application</h1>
          <p style="margin:0 0 22px;color:#b9c5bc;">${escapeHtml(application.projectName)} submitted an application for RISE Mainnet.</p>
          ${image}
          <div style="padding:18px;border-radius:16px;background:#101f16;color:#d8e0db;font-size:14px;line-height:1.65;margin-bottom:22px;">${escapeHtml(application.projectDescription)}</div>
          <table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #203328;border-bottom:1px solid #203328;">${rows}</table>
          <div style="margin:22px 0;padding:18px;border-radius:16px;background:#101f16;color:#d8e0db;font-size:13px;line-height:1.65;"><strong style="color:#fff;">Team</strong><br>${team}</div>
          <a href="${escapeHtml(config.stage0AppUrl)}/admin" style="display:inline-block;padding:13px 18px;border-radius:999px;background:#b8f34a;color:#0b160f;text-decoration:none;font-size:14px;font-weight:800;">Review application</a>
        </div>
        <div style="padding:16px 28px;background:#09110d;color:#7e9185;font-size:12px;">Application ${application.id} · ${config.riseNetworkName} (${application.chainId})</div>
      </div>
    </body></html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `Stage0 <${config.resendFromEmail}>`,
      to: [config.creatorApplicationEmail],
      subject: `[Stage0] ${application.projectName} ${kind} application`,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return "sent" as const;
}

export async function notifyCreatorApplication(application: CreatorApplicationRecord) {
  const [slack, email] = await Promise.allSettled([sendSlack(application), sendEmail(application)]);
  const errors = [slack, email]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));
  const values = [slack, email]
    .filter((result): result is PromiseFulfilledResult<"sent" | "skipped"> => result.status === "fulfilled")
    .map((result) => result.value);
  const sentCount = values.filter((value) => value === "sent").length;

  return {
    status: errors.length === 0
      ? sentCount > 0 ? "sent" as const : "skipped" as const
      : sentCount > 0 ? "partial" as const : "failed" as const,
    error: errors.length > 0 ? errors.join(" | ") : null,
  };
}
