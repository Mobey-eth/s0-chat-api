import { formatEther } from "viem";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  getRnsMarketplaceBidderSubscriptions,
  getRnsMarketplaceSellerSubscriptions,
  getRnsMarketplaceWatcherSubscriptions,
  hasRnsNotificationDispatch,
  recordRnsNotificationDispatch,
  type RnsNotificationSubscription,
} from "./store.js";

type AdminRegistrationActivity = {
  chainId: number;
  name: string | null;
  fqdn: string | null;
  registrant: `0x${string}`;
  expiry: bigint;
  txHash: `0x${string}`;
  logIndex: number;
};

type AdminMarketplaceActivity = {
  chainId: number;
  source: "primary_auction" | "marketplace";
  eventType: string;
  entityType: string;
  entityId?: bigint | null;
  name?: string | null;
  node?: `0x${string}` | null;
  seller?: `0x${string}` | null;
  actor?: `0x${string}` | null;
  counterparty?: `0x${string}` | null;
  amount?: bigint | null;
  status?: string | null;
  winner?: `0x${string}` | null;
  txHash: `0x${string}`;
  logIndex: number;
};

type MarketplaceSubscriberActivity = {
  chainId: number;
  eventType: string;
  entityType: "listing" | "auction";
  entityId: bigint;
  name: string;
  fqdn: string;
  node: `0x${string}`;
  seller: `0x${string}`;
  actor?: `0x${string}` | null;
  previousHighestBidder?: `0x${string}` | null;
  amount?: bigint | null;
  status?: string | null;
  winner?: `0x${string}` | null;
  txHash: `0x${string}`;
  logIndex: number;
};

function shortAddress(address: string | null | undefined) {
  if (!address) return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatEthAmount(value: bigint | null | undefined) {
  if (value == null) return null;
  const numeric = Number(formatEther(value));
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 1) return `${numeric.toFixed(2)} ETH`;
  if (numeric >= 0.01) return `${numeric.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} ETH`;
  return `${numeric.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ETH`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function postSlack(payload: { text: string; blocks?: unknown[] }) {
  if (!config.rnsAdminActivitySlackWebhookUrl) return false;

  const response = await fetch(config.rnsAdminActivitySlackWebhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed with status ${response.status}`);
  }

  return true;
}

async function sendEmail(input: { to: string; subject: string; html: string }) {
  if (!config.resendApiKey) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `Stage0 <${config.resendFromEmail}>`,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend send failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return true;
}

function emailShell(input: {
  title: string;
  intro: string;
  bullets: string[];
  ctaLabel?: string;
  ctaHref?: string;
}) {
  const bullets = input.bullets
    .map((item) => `<li style="margin:0 0 8px;">${escapeHtml(item)}</li>`)
    .join("");
  const cta =
    input.ctaLabel && input.ctaHref
      ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(input.ctaHref)}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#f97316;color:#111;text-decoration:none;font-weight:700;">${escapeHtml(input.ctaLabel)}</a></p>`
      : "";

  return `<!doctype html>
  <html>
    <body style="margin:0;padding:24px;background:#f7f7f5;font-family:Inter,Arial,sans-serif;color:#171717;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:20px;padding:28px;">
        <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#78716c;font-weight:700;">Stage0</div>
        <h1 style="margin:12px 0 10px;font-size:24px;line-height:1.15;">${escapeHtml(input.title)}</h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#44403c;">${escapeHtml(input.intro)}</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;color:#292524;">${bullets}</ul>
        ${cta}
      </div>
    </body>
  </html>`;
}

async function maybeSendSubscriptionEmail(
  subscription: RnsNotificationSubscription,
  dispatchKey: string,
  input: {
    subject: string;
    title: string;
    intro: string;
    bullets: string[];
    txHash: `0x${string}`;
    logIndex: number;
  },
) {
  if (!config.resendApiKey) return;
  if (await hasRnsNotificationDispatch(dispatchKey)) return;

  await sendEmail({
    to: subscription.email,
    subject: input.subject,
    html: emailShell({
      title: input.title,
      intro: input.intro,
      bullets: input.bullets,
      ctaLabel: "Open marketplace",
      ctaHref: `${config.stage0AppUrl}/domains/marketplace`,
    }),
  });

  await recordRnsNotificationDispatch({
    channel: "email",
    dispatchKey,
    subscriptionId: subscription.id,
    eventSource: "marketplace",
    eventType: input.subject,
    txHash: input.txHash,
    logIndex: input.logIndex,
    detail: { email: subscription.email },
  });
}

export async function notifyAdminRnsRegistration(activity: AdminRegistrationActivity) {
  if (!config.rnsAdminActivitySlackWebhookUrl) return;

  const fqdn = activity.fqdn ?? (activity.name ? `${activity.name}.rise` : "Unknown .rise name");
  const dispatchKey = `admin:registration:${activity.chainId}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;
  if (await hasRnsNotificationDispatch(dispatchKey)) return;

  const expiry = activity.expiry > 0n ? new Date(Number(activity.expiry) * 1000).toUTCString() : "Unknown";
  const text = `New RNS mint: ${fqdn} registered by ${shortAddress(activity.registrant)}`;

  await postSlack({
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New RNS mint*\n*Name:* ${fqdn}\n*Registrant:* ${activity.registrant}\n*Expiry:* ${expiry}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<${config.riseTestnetExplorerUrl}/tx/${activity.txHash}|View transaction>`,
          },
        ],
      },
    ],
  });

  await recordRnsNotificationDispatch({
    channel: "admin_slack",
    dispatchKey,
    eventSource: "registrar",
    eventType: "name_registered",
    txHash: activity.txHash,
    logIndex: activity.logIndex,
    detail: { fqdn, registrant: activity.registrant },
  });
}

export async function notifyAdminRnsMarketplaceActivity(activity: AdminMarketplaceActivity) {
  if (!config.rnsAdminActivitySlackWebhookUrl) return;

  const dispatchKey = `admin:${activity.source}:${activity.chainId}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;
  if (await hasRnsNotificationDispatch(dispatchKey)) return;

  const fqdn = activity.name ? `${activity.name}.rise` : "Unknown .rise name";
  const amount = formatEthAmount(activity.amount);
  const lines = [
    `*Source:* ${activity.source}`,
    `*Event:* ${activity.eventType}`,
    `*Name:* ${fqdn}`,
  ];

  if (activity.seller) lines.push(`*Seller:* ${activity.seller}`);
  if (activity.actor) lines.push(`*Actor:* ${activity.actor}`);
  if (activity.counterparty) lines.push(`*Counterparty:* ${activity.counterparty}`);
  if (amount) lines.push(`*Amount:* ${amount}`);
  if (activity.status) lines.push(`*Status:* ${activity.status}`);
  if (activity.winner) lines.push(`*Winner:* ${activity.winner}`);

  await postSlack({
    text: `RNS activity: ${activity.eventType} on ${fqdn}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*RNS activity*\n${lines.join("\n")}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<${config.riseTestnetExplorerUrl}/tx/${activity.txHash}|View transaction>`,
          },
        ],
      },
    ],
  });

  await recordRnsNotificationDispatch({
    channel: "admin_slack",
    dispatchKey,
    eventSource: activity.source,
    eventType: activity.eventType,
    txHash: activity.txHash,
    logIndex: activity.logIndex,
    detail: {
      name: activity.name,
      entityType: activity.entityType,
      entityId: activity.entityId?.toString() ?? null,
    },
  });
}

export async function notifyMarketplaceSubscribers(activity: MarketplaceSubscriberActivity) {
  if (!config.resendApiKey) return;

  const sellerSubscriptions = await getRnsMarketplaceSellerSubscriptions({
    chainId: activity.chainId,
    node: activity.node,
  });

  const bidderSubscriptions =
    activity.entityType === "auction"
      ? await getRnsMarketplaceBidderSubscriptions({
          chainId: activity.chainId,
          auctionId: activity.entityId,
        })
      : [];
  const watcherSubscriptions =
    activity.entityType === "auction"
      ? await getRnsMarketplaceWatcherSubscriptions({
          chainId: activity.chainId,
          node: activity.node,
          auctionId: activity.entityId,
        })
      : [];

  const amount = formatEthAmount(activity.amount) ?? "an updated amount";
  const fqdn = activity.fqdn;

  for (const subscription of sellerSubscriptions) {
    const dispatchKey = `email:${subscription.id}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;

    if (activity.eventType === "marketplace.listed") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `Your ${fqdn} listing is live`,
        title: `${fqdn} is now listed`,
        intro: "Your fixed-price listing is live on the Stage0 marketplace.",
        bullets: [`Listing type: fixed price`, `Name: ${fqdn}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (activity.eventType === "marketplace.auction_created") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `Your ${fqdn} auction is live`,
        title: `${fqdn} is now in auction`,
        intro: "Your .rise auction is live on Stage0.",
        bullets: [`Auction name: ${fqdn}`, `Opening reserve: ${amount}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (activity.eventType === "marketplace.bid") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `New bid on ${fqdn}`,
        title: `New bid received`,
        intro: "Someone placed a fresh bid on your .rise auction.",
        bullets: [`Name: ${fqdn}`, `Bid: ${amount}`, `Bidder: ${shortAddress(activity.actor)}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (activity.eventType === "marketplace.listing_purchased") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `Your ${fqdn} listing sold`,
        title: `${fqdn} sold`,
        intro: "Your fixed-price listing has been purchased.",
        bullets: [`Name: ${fqdn}`, `Sale price: ${amount}`, `Buyer: ${shortAddress(activity.actor)}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (activity.eventType === "marketplace.auction_settled") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `Your ${fqdn} auction settled`,
        title: `${fqdn} auction settled`,
        intro: "Your auction has settled onchain.",
        bullets: [
          `Name: ${fqdn}`,
          `Final amount: ${amount}`,
          `Winner: ${shortAddress(activity.winner ?? activity.actor)}`,
        ],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }
  }

  for (const subscription of bidderSubscriptions) {
    const dispatchKey = `email:${subscription.id}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;
    const subscriptionWallet = subscription.wallet?.toLowerCase() ?? "";
    const actorWallet = activity.actor?.toLowerCase() ?? "";
    const winnerWallet = activity.winner?.toLowerCase() ?? "";

    if (activity.eventType === "marketplace.bid") {
      if (subscriptionWallet && actorWallet && subscriptionWallet === actorWallet) {
        await maybeSendSubscriptionEmail(subscription, dispatchKey, {
          subject: `Your bid is live on ${fqdn}`,
          title: `Bid submitted`,
          intro: "Your bid is now the current top bid on Stage0.",
          bullets: [`Name: ${fqdn}`, `Bid: ${amount}`],
          txHash: activity.txHash,
          logIndex: activity.logIndex,
        });
        continue;
      }

      if (
        activity.previousHighestBidder &&
        subscriptionWallet !== activity.previousHighestBidder.toLowerCase()
      ) {
        continue;
      }

      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `You've been outbid on ${fqdn}`,
        title: `Outbid on ${fqdn}`,
        intro: "Another bidder moved ahead of you. If you still want the name, place a new bid.",
        bullets: [`Name: ${fqdn}`, `Current leading bid: ${amount}`, `Leading bidder: ${shortAddress(activity.actor)}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (activity.eventType === "marketplace.auction_settled") {
      const didWin = subscriptionWallet && winnerWallet && subscriptionWallet === winnerWallet;
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: didWin ? `You won ${fqdn}` : `Auction ended for ${fqdn}`,
        title: didWin ? `You won ${fqdn}` : `${fqdn} auction ended`,
        intro: didWin
          ? "Your bid won the auction."
          : "This auction has settled. If you were outbid earlier, your funds remain withdrawable from the marketplace contract.",
        bullets: [`Name: ${fqdn}`, `Final amount: ${amount}`, `Winner: ${shortAddress(activity.winner)}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }
  }

  for (const subscription of watcherSubscriptions) {
    const dispatchKey = `email:${subscription.id}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;

    if (activity.eventType === "marketplace.auction_created") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `${fqdn} is live on Stage0`,
        title: `${fqdn} auction is live`,
        intro: "An auction you're watching is now live on Stage0.",
        bullets: [`Name: ${fqdn}`, `Opening reserve: ${amount}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (activity.eventType === "marketplace.bid") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `New bid on ${fqdn}`,
        title: `Auction watch update`,
        intro: "A new bid landed on a .rise auction you're watching.",
        bullets: [`Name: ${fqdn}`, `Latest bid: ${amount}`, `Bidder: ${shortAddress(activity.actor)}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (activity.eventType === "marketplace.auction_settled") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `${fqdn} auction settled`,
        title: `Auction watch update`,
        intro: "A watched .rise auction has now settled onchain.",
        bullets: [
          `Name: ${fqdn}`,
          `Final amount: ${amount}`,
          `Winner: ${shortAddress(activity.winner ?? activity.actor)}`,
        ],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (activity.eventType === "marketplace.auction_cancelled") {
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: `${fqdn} auction was cancelled`,
        title: `Auction watch update`,
        intro: "A watched .rise auction has been cancelled.",
        bullets: [`Name: ${fqdn}`],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
    }
  }
}

export async function safelyNotify(
  label: string,
  handler: () => Promise<void>,
) {
  try {
    await handler();
  } catch (error) {
    logger.error("rns notification failed", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
