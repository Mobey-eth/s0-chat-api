import { formatEther } from "viem";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getEthUsdPrice } from "./pricing.js";
import {
  claimRnsAuctionLifecycleDispatch,
  claimRnsNotificationDispatch,
  completeRnsAuctionLifecycleDispatch,
  failRnsAuctionLifecycleDispatch,
  getRnsMarketplaceBidderSubscriptions,
  getRnsMarketplaceSellerSubscriptions,
  getRnsMarketplaceWatcherSubscriptions,
  releaseRnsNotificationDispatch,
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
  source?: "primary_auction" | "marketplace";
  eventType: string;
  entityType: "listing" | "auction";
  entityId: bigint;
  name: string;
  fqdn: string;
  node: `0x${string}`;
  seller?: `0x${string}` | null;
  actor?: `0x${string}` | null;
  previousHighestBidder?: `0x${string}` | null;
  amount?: bigint | null;
  status?: string | null;
  winner?: `0x${string}` | null;
  txHash: `0x${string}`;
  logIndex: number;
};

export type AuctionEndedLifecycleActivity = {
  chainId: number;
  source: "primary_auction" | "marketplace";
  auctionId: bigint;
  name: string;
  fqdn: string;
  node: `0x${string}`;
  seller: `0x${string}` | null;
  highestBidder: `0x${string}` | null;
  highestBid: bigint;
  bidCount: number;
  endTime: bigint;
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

async function formatEthUsdAmount(value: bigint | null | undefined) {
  const eth = formatEthAmount(value);
  if (!eth || value == null) return null;
  try {
    const { priceUsd } = await getEthUsdPrice();
    const usd = Number(formatEther(value)) * priceUsd;
    return `${eth} (about $${usd.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })})`;
  } catch {
    return eth;
  }
}

function canonicalMarketplaceEvent(eventType: string) {
  if (eventType.startsWith("primary_auction.")) {
    return eventType.replace("primary_auction.", "marketplace.auction_").replace("auction_bid", "bid");
  }
  return eventType;
}

function marketplaceEventCopy(eventType: string) {
  const canonical = canonicalMarketplaceEvent(eventType);
  const copy: Record<string, { title: string; action: string }> = {
    "marketplace.listed": { title: "Fixed-price listing published", action: "listed" },
    "marketplace.listing_cancelled": { title: "Fixed-price listing cancelled", action: "cancelled" },
    "marketplace.listing_purchased": { title: "Domain sold", action: "sold" },
    "marketplace.auction_created": { title: "Auction published", action: "started" },
    "marketplace.bid": { title: "New highest bid", action: "received a bid" },
    "marketplace.auction_cancelled": { title: "Auction cancelled", action: "cancelled" },
    "marketplace.auction_settled": { title: "Auction settled", action: "settled" },
    "marketplace.withdrawal": { title: "Bid refund withdrawn", action: "refund withdrawn" },
  };
  return copy[canonical] ?? { title: "Domain marketplace update", action: "updated" };
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
  txHref?: string;
}) {
  const bullets = input.bullets
    .map((item) => {
      const [label, ...rest] = item.split(":");
      const value = rest.join(":").trim();
      return `<tr>
        <td style="padding:10px 0;color:#84958b;font-size:13px;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:10px 0;color:#f5f7f5;font-size:14px;font-weight:700;text-align:right;vertical-align:top;">${escapeHtml(value || label)}</td>
      </tr>`;
    })
    .join("");
  const cta =
    input.ctaLabel && input.ctaHref
      ? `<a href="${escapeHtml(input.ctaHref)}" style="display:inline-block;padding:13px 18px;border-radius:999px;background:#b8f34a;color:#0b160f;text-decoration:none;font-size:14px;font-weight:800;">${escapeHtml(input.ctaLabel)}</a>`
      : "";
  const txLink = input.txHref
    ? `<a href="${escapeHtml(input.txHref)}" style="color:#9fb3a6;text-decoration:underline;font-size:12px;">View transaction</a>`
    : "";

  return `<!doctype html>
  <html>
    <body style="margin:0;padding:32px 16px;background:#edf1ed;font-family:Arial,sans-serif;color:#f5f7f5;">
      <div style="max-width:580px;margin:0 auto;overflow:hidden;border-radius:24px;background:#0d1812;border:1px solid #203328;box-shadow:0 20px 50px rgba(13,24,18,.14);">
        <div style="padding:22px 28px;border-bottom:1px solid #203328;background:#101f16;">
          <div style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#b8f34a;font-weight:800;">StageO</div>
        </div>
        <div style="padding:30px 28px 26px;">
          <h1 style="margin:0 0 10px;font-size:28px;line-height:1.12;letter-spacing:-.02em;color:#ffffff;">${escapeHtml(input.title)}</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#b9c5bc;">${escapeHtml(input.intro)}</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #203328;border-bottom:1px solid #203328;margin-bottom:24px;">${bullets}</table>
          <div style="display:flex;align-items:center;gap:16px;">${cta}</div>
        </div>
        <div style="padding:16px 28px;background:#09110d;color:#7e9185;font-size:12px;line-height:1.5;">
          ${txLink}<div style="margin-top:6px;">You received this because you opted into updates for this .rise name.</div>
        </div>
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
    txHash?: `0x${string}`;
    logIndex?: number;
    eventSource?: string;
    eventType?: string;
    ctaLabel?: string;
    ctaHref?: string;
  },
) {
  if (!config.resendApiKey) return;
  const claimed = await claimRnsNotificationDispatch({
    channel: "email",
    dispatchKey,
    subscriptionId: subscription.id,
    eventSource: input.eventSource ?? "marketplace",
    eventType: input.eventType ?? input.subject,
    txHash: input.txHash,
    logIndex: input.logIndex,
    detail: { email: subscription.email },
  });
  if (!claimed) return;

  try {
    await sendEmail({
      to: subscription.email,
      subject: input.subject,
      html: emailShell({
        title: input.title,
        intro: input.intro,
        bullets: input.bullets,
        ctaLabel: input.ctaLabel ?? "Open marketplace",
        ctaHref: input.ctaHref ?? `${config.stage0AppUrl}/domains/marketplace`,
        txHref: input.txHash ? `${config.riseTestnetExplorerUrl}/tx/${input.txHash}` : undefined,
      }),
    });
  } catch (error) {
    await releaseRnsNotificationDispatch(dispatchKey);
    throw error;
  }
}

async function sendAuctionLifecycleEmail(
  subscription: RnsNotificationSubscription,
  dispatchKey: string,
  input: {
    chainId: number;
    eventType: string;
    subject: string;
    title: string;
    intro: string;
    bullets: string[];
    ctaLabel: string;
    detail: unknown;
  },
) {
  if (!config.resendApiKey) return;

  const attemptCount = await claimRnsAuctionLifecycleDispatch({
    dispatchKey,
    chainId: input.chainId,
    channel: "email",
    subscriptionId: subscription.id,
    eventType: input.eventType,
    recipient: subscription.email,
    detail: input.detail,
  });
  if (!attemptCount) return;

  try {
    await sendEmail({
      to: subscription.email,
      subject: input.subject,
      html: emailShell({
        title: input.title,
        intro: input.intro,
        bullets: input.bullets,
        ctaLabel: input.ctaLabel,
        ctaHref: `${config.stage0AppUrl}/domains/marketplace`,
      }),
    });
    await completeRnsAuctionLifecycleDispatch(dispatchKey);
  } catch (error) {
    await failRnsAuctionLifecycleDispatch({
      dispatchKey,
      attemptCount,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function sendAuctionLifecycleSlack(activity: AuctionEndedLifecycleActivity, eventType: string) {
  if (!config.rnsAdminActivitySlackWebhookUrl) return;

  const contractAddress =
    activity.source === "primary_auction"
      ? config.rnsContracts.auctionHouse
      : config.rnsContracts.marketplace;
  const dispatchKey = [
    "auction-ended",
    "admin",
    activity.chainId,
    contractAddress,
    activity.auctionId,
    activity.endTime,
  ].join(":");
  const attemptCount = await claimRnsAuctionLifecycleDispatch({
    dispatchKey,
    chainId: activity.chainId,
    channel: "admin_slack",
    eventType,
    recipient: "stage0-admin",
    detail: {
      source: activity.source,
      auctionId: activity.auctionId.toString(),
      fqdn: activity.fqdn,
    },
  });
  if (!attemptCount) return;

  const amount = (await formatEthUsdAmount(activity.highestBid)) ?? "No winning bid";
  const hasWinner = Boolean(activity.highestBidder);

  try {
    await postSlack({
      text: hasWinner
        ? `${activity.fqdn} auction ended with a winner`
        : `${activity.fqdn} auction ended without bids`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: hasWinner ? "Auction ended - action required" : "Auction ended - no bids",
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Name*\n${activity.fqdn}` },
            { type: "mrkdwn", text: `*Source*\n${activity.source === "primary_auction" ? "Reserved auction" : "Wallet marketplace"}` },
            { type: "mrkdwn", text: `*Bids*\n${activity.bidCount}` },
            {
              type: "mrkdwn",
              text: hasWinner
                ? `*Winner*\n${shortAddress(activity.highestBidder)}`
                : "*Result*\nNo bids received",
            },
            ...(hasWinner ? [{ type: "mrkdwn", text: `*Final bid*\n${amount}` }] : []),
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<${config.stage0AppUrl}/domains/marketplace|Open the marketplace>`,
            },
          ],
        },
      ],
    });
    await completeRnsAuctionLifecycleDispatch(dispatchKey);
  } catch (error) {
    await failRnsAuctionLifecycleDispatch({
      dispatchKey,
      attemptCount,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function notifyAuctionEndedLifecycle(activity: AuctionEndedLifecycleActivity) {
  const contractAddress =
    activity.source === "primary_auction"
      ? config.rnsContracts.auctionHouse
      : config.rnsContracts.marketplace;
  const hasWinner = Boolean(activity.highestBidder);
  const eventType = hasWinner ? "auction_ended_with_winner" : "auction_ended_without_bids";
  const amount = (await formatEthUsdAmount(activity.highestBid)) ?? "No winning bid";
  const baseKey = [
    "auction-ended",
    activity.chainId,
    contractAddress,
    activity.auctionId,
    activity.endTime,
  ].join(":");
  const emailedRecipients = new Set<string>();

  const sellerSubscriptions =
    activity.source === "marketplace" && activity.seller
      ? await getRnsMarketplaceSellerSubscriptions({
          chainId: activity.chainId,
          node: activity.node,
        })
      : [];
  const bidderSubscriptions = hasWinner
    ? await getRnsMarketplaceBidderSubscriptions({
        chainId: activity.chainId,
        auctionId: activity.auctionId,
        name: activity.name,
      })
    : [];
  const watcherSubscriptions = await getRnsMarketplaceWatcherSubscriptions({
    chainId: activity.chainId,
    node: activity.node,
    auctionId: activity.auctionId,
    name: activity.name,
  });

  for (const subscription of sellerSubscriptions) {
    const recipient = subscription.email.toLowerCase();
    if (emailedRecipients.has(recipient)) continue;
    emailedRecipients.add(recipient);
    await sendAuctionLifecycleEmail(subscription, `${baseKey}:${recipient}`, {
      chainId: activity.chainId,
      eventType,
      subject: hasWinner
        ? `${activity.fqdn} ended with a winning bid`
        : `${activity.fqdn} ended without bids`,
      title: hasWinner ? "Your auction has ended" : "No bids were placed",
      intro: hasWinner
        ? "Finalize the auction to transfer the name, then withdraw your proceeds."
        : "The auction is over. Reclaim your .rise name from marketplace escrow.",
      bullets: hasWinner
        ? [`Name: ${activity.fqdn}`, `Winning bid: ${amount}`, `Winner: ${shortAddress(activity.highestBidder)}`]
        : [`Name: ${activity.fqdn}`, "Result: No bids received"],
      ctaLabel: hasWinner ? "Finalize and claim proceeds" : "Reclaim your name",
      detail: { role: "seller", source: activity.source, auctionId: activity.auctionId.toString() },
    });
  }

  for (const subscription of bidderSubscriptions) {
    if (subscription.wallet?.toLowerCase() !== activity.highestBidder?.toLowerCase()) continue;
    const recipient = subscription.email.toLowerCase();
    if (emailedRecipients.has(recipient)) continue;
    emailedRecipients.add(recipient);
    await sendAuctionLifecycleEmail(subscription, `${baseKey}:${recipient}`, {
      chainId: activity.chainId,
      eventType,
      subject: `You won ${activity.fqdn}`,
      title: `Claim ${activity.fqdn}`,
      intro: "The auction has ended and your bid is the winner. Finalize it to receive the name.",
      bullets: [`Name: ${activity.fqdn}`, `Winning bid: ${amount}`],
      ctaLabel: "Claim your name",
      detail: { role: "winner", source: activity.source, auctionId: activity.auctionId.toString() },
    });
  }

  for (const subscription of watcherSubscriptions) {
    const recipient = subscription.email.toLowerCase();
    if (emailedRecipients.has(recipient)) continue;
    emailedRecipients.add(recipient);
    await sendAuctionLifecycleEmail(subscription, `${baseKey}:${recipient}`, {
      chainId: activity.chainId,
      eventType,
      subject: hasWinner
        ? `${activity.fqdn} auction has ended`
        : `${activity.fqdn} ended without bids`,
      title: "Auction watch update",
      intro: hasWinner
        ? "The auction you were watching has ended with a winning bid."
        : "The auction you were watching ended without receiving a bid.",
      bullets: hasWinner
        ? [`Name: ${activity.fqdn}`, `Winning bid: ${amount}`, `Winner: ${shortAddress(activity.highestBidder)}`]
        : [`Name: ${activity.fqdn}`, "Result: No bids received"],
      ctaLabel: "View auction result",
      detail: { role: "watcher", source: activity.source, auctionId: activity.auctionId.toString() },
    });
  }

  await sendAuctionLifecycleSlack(activity, eventType);
}

export async function notifyAdminRnsRegistration(activity: AdminRegistrationActivity) {
  if (!config.rnsAdminActivitySlackWebhookUrl) return;

  const fqdn = activity.fqdn ?? (activity.name ? `${activity.name}.rise` : "Unknown .rise name");
  const dispatchKey = `admin:registration:${activity.chainId}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;
  const expiry = activity.expiry > 0n ? new Date(Number(activity.expiry) * 1000).toUTCString() : "Unknown";
  const claimed = await claimRnsNotificationDispatch({
    channel: "admin_slack",
    dispatchKey,
    eventSource: "registrar",
    eventType: "name_registered",
    txHash: activity.txHash,
    logIndex: activity.logIndex,
    detail: { fqdn, registrant: activity.registrant },
  });
  if (!claimed) return;

  try {
    await postSlack({
      text: `New .rise registration: ${fqdn}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "New .rise registration" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Name*\n${fqdn}` },
            { type: "mrkdwn", text: `*Owner*\n${shortAddress(activity.registrant)}` },
            { type: "mrkdwn", text: `*Expires*\n${expiry}` },
            { type: "mrkdwn", text: "*Network*\nRISE Testnet" },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<${config.riseTestnetExplorerUrl}/tx/${activity.txHash}|View registration transaction>`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    await releaseRnsNotificationDispatch(dispatchKey);
    throw error;
  }
}

export async function notifyAdminRnsMarketplaceActivity(activity: AdminMarketplaceActivity) {
  if (!config.rnsAdminActivitySlackWebhookUrl) return;
  if (activity.eventType.endsWith("refund_available")) return;

  const dispatchKey = `admin:${activity.source}:${activity.chainId}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;
  const fqdn = activity.name ? `${activity.name}.rise` : "Unknown .rise name";
  const copy = marketplaceEventCopy(activity.eventType);
  const amount = await formatEthUsdAmount(activity.amount);
  const source = activity.source === "primary_auction" ? "Stage0 reserved-name auction" : "Wallet marketplace";
  const claimed = await claimRnsNotificationDispatch({
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
  if (!claimed) return;

  const fields: Array<{ type: "mrkdwn"; text: string }> = [
    { type: "mrkdwn", text: `*Name*\n${fqdn}` },
    { type: "mrkdwn", text: `*Activity*\n${copy.title}` },
  ];
  if (amount) fields.push({ type: "mrkdwn", text: `*Amount*\n${amount}` });
  if (activity.actor) fields.push({ type: "mrkdwn", text: `*Wallet*\n${shortAddress(activity.actor)}` });
  if (activity.seller) fields.push({ type: "mrkdwn", text: `*Seller*\n${shortAddress(activity.seller)}` });
  if (activity.winner) fields.push({ type: "mrkdwn", text: `*Winner*\n${shortAddress(activity.winner)}` });
  if (activity.status) fields.push({ type: "mrkdwn", text: `*Status*\n${activity.status}` });
  fields.push({ type: "mrkdwn", text: `*Source*\n${source}` });

  try {
    await postSlack({
      text: `${copy.title}: ${fqdn}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: copy.title },
        },
        { type: "section", fields },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<${config.riseTestnetExplorerUrl}/tx/${activity.txHash}|View marketplace transaction>`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    await releaseRnsNotificationDispatch(dispatchKey);
    throw error;
  }
}

export async function notifyMarketplaceSubscribers(activity: MarketplaceSubscriberActivity) {
  if (!config.resendApiKey) return;

  const eventType = canonicalMarketplaceEvent(activity.eventType);
  const sellerSubscriptions =
    activity.source === "primary_auction" || !activity.seller
      ? []
      : await getRnsMarketplaceSellerSubscriptions({
          chainId: activity.chainId,
          node: activity.node,
        });

  const bidderSubscriptions =
    activity.entityType === "auction"
      ? await getRnsMarketplaceBidderSubscriptions({
          chainId: activity.chainId,
          auctionId: activity.entityId,
          name: activity.name,
        })
      : [];
  const watcherSubscriptions =
    activity.entityType === "auction"
      ? await getRnsMarketplaceWatcherSubscriptions({
          chainId: activity.chainId,
          node: activity.node,
          auctionId: activity.entityId,
          name: activity.name,
        })
      : [];

  const amount = (await formatEthUsdAmount(activity.amount)) ?? "an updated amount";
  const fqdn = activity.fqdn;

  for (const subscription of sellerSubscriptions) {
    const dispatchKey = `email:${subscription.email.toLowerCase()}:${activity.chainId}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;

    if (eventType === "marketplace.listed") {
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

    if (eventType === "marketplace.auction_created") {
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

    if (eventType === "marketplace.bid") {
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

    if (eventType === "marketplace.listing_purchased") {
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

    if (eventType === "marketplace.auction_settled") {
      const hadWinner = Boolean(activity.winner);
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: hadWinner ? `Your ${fqdn} auction settled` : `${fqdn} returned to your wallet`,
        title: hadWinner ? "Proceeds ready to withdraw" : "Your name has been returned",
        intro: hadWinner
          ? "The winning name transfer is complete and your sale proceeds are ready."
          : "The no-bid auction was finalized and the name has returned to your wallet.",
        bullets: hadWinner
          ? [
              `Name: ${fqdn}`,
              `Final amount: ${amount}`,
              `Winner: ${shortAddress(activity.winner)}`,
            ]
          : [`Name: ${fqdn}`, "Result: No bids received"],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
        ctaLabel: hadWinner ? "Withdraw proceeds" : "View your name",
      });
      continue;
    }
  }

  for (const subscription of bidderSubscriptions) {
    const dispatchKey = `email:${subscription.email.toLowerCase()}:${activity.chainId}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;
    const subscriptionWallet = subscription.wallet?.toLowerCase() ?? "";
    const actorWallet = activity.actor?.toLowerCase() ?? "";
    const winnerWallet = activity.winner?.toLowerCase() ?? "";

    if (eventType === "marketplace.bid") {
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

    if (eventType === "marketplace.auction_settled") {
      if (!activity.winner) continue;
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
    const dispatchKey = `email:${subscription.email.toLowerCase()}:${activity.chainId}:${activity.txHash.toLowerCase()}:${activity.logIndex}`;

    if (eventType === "marketplace.auction_created") {
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

    if (eventType === "marketplace.bid") {
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

    if (eventType === "marketplace.auction_settled") {
      const hadWinner = Boolean(activity.winner);
      await maybeSendSubscriptionEmail(subscription, dispatchKey, {
        subject: hadWinner ? `${fqdn} auction settled` : `${fqdn} closed without bids`,
        title: `Auction watch update`,
        intro: hadWinner
          ? "A watched .rise auction has now settled onchain."
          : "A watched .rise auction closed without receiving a bid.",
        bullets: hadWinner
          ? [
              `Name: ${fqdn}`,
              `Final amount: ${amount}`,
              `Winner: ${shortAddress(activity.winner)}`,
            ]
          : [`Name: ${fqdn}`, "Result: No bids received"],
        txHash: activity.txHash,
        logIndex: activity.logIndex,
      });
      continue;
    }

    if (eventType === "marketplace.auction_cancelled") {
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
