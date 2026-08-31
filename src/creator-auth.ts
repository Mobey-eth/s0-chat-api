import { getAddress, verifyMessage, type Hex } from "viem";
import { config } from "./config.js";

const SIGNATURE_MAX_AGE_MS = 10 * 60 * 1_000;

export type CreatorApplicationType = "nft" | "presale";
export type CreatorAdminAction = "list_creator_applications" | "set_creator_approval";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function isFreshTimestamp(timestamp: number) {
  const ageMs = Date.now() - timestamp;
  return ageMs >= -30_000 && ageMs <= SIGNATURE_MAX_AGE_MS;
}

export function buildCreatorApplicationAuthorizationMessage(input: {
  chainId: number;
  timestamp: number;
  payload: unknown;
}) {
  return [
    "Stage0 creator application",
    `Network: ${config.riseNetworkName} (${input.chainId})`,
    `Timestamp: ${input.timestamp}`,
    `Payload: ${stableJson(input.payload)}`,
  ].join("\n");
}

export function buildCreatorAdminAuthorizationMessage(input: {
  action: CreatorAdminAction;
  chainId: number;
  timestamp: number;
  payload: unknown;
}) {
  return [
    "Stage0 creator access administration",
    `Network: ${config.riseNetworkName} (${input.chainId})`,
    `Action: ${input.action}`,
    `Timestamp: ${input.timestamp}`,
    `Payload: ${stableJson(input.payload)}`,
  ].join("\n");
}

export async function verifyCreatorApplicationAuthorization(input: {
  chainId: number;
  timestamp: number;
  address: string;
  signature: Hex;
  payload: unknown;
}) {
  if (!isFreshTimestamp(input.timestamp)) return false;

  let address: `0x${string}`;
  try {
    address = getAddress(input.address);
  } catch {
    return false;
  }

  return verifyMessage({
    address,
    message: buildCreatorApplicationAuthorizationMessage(input),
    signature: input.signature,
  });
}

export async function verifyCreatorAdminAuthorization(input: {
  action: CreatorAdminAction;
  chainId: number;
  timestamp: number;
  address: string;
  signature: Hex;
  payload: unknown;
}) {
  if (!isFreshTimestamp(input.timestamp)) return false;

  let address: `0x${string}`;
  try {
    address = getAddress(input.address);
  } catch {
    return false;
  }

  if (address.toLowerCase() !== config.creatorAdminAddress) return false;

  return verifyMessage({
    address,
    message: buildCreatorAdminAuthorizationMessage(input),
    signature: input.signature,
  });
}
