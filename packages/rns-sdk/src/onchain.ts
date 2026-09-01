import {
  getAddress,
  parseAbi,
  zeroAddress,
  type PublicClient,
} from "viem";
import { namehash } from "viem/ens";
import { rnsContracts } from "./constants.js";
import type { EvmAddress, RnsAvailability, RnsResolution } from "./types.js";

const registryAbi = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
]);
const resolverAbi = parseAbi(["function addr(bytes32 node) view returns (address)"]);
const registrarAbi = parseAbi([
  "function available(string name) view returns (bool)",
  "function effectivePolicy(string name) view returns (uint8)",
  "function expiryOf(string name) view returns (uint256)",
]);
const policyNames = ["open", "protected", "auction_only", "fixed_premium"] as const;

export function normalizeRiseName(input: string) {
  const lower = input.trim().toLowerCase();
  const label = lower.endsWith(".rise") ? lower.slice(0, -5) : lower;
  if (!/^[a-z0-9-]{1,32}$/.test(label) || label.startsWith("-") || label.endsWith("-")) {
    throw new Error("Invalid .rise name");
  }
  return { label, name: `${label}.rise` };
}

export function createStage0RnsOnchainClient(client: PublicClient) {
  async function getAvailability(input: string): Promise<RnsAvailability> {
    const { label, name } = normalizeRiseName(input);
    const node = namehash(name);
    const [ownerRaw, resolverRaw, expiry, available, policyRaw, blockNumber] = await Promise.all([
      client.readContract({ address: rnsContracts.registry, abi: registryAbi, functionName: "owner", args: [node] }),
      client.readContract({ address: rnsContracts.registry, abi: registryAbi, functionName: "resolver", args: [node] }),
      client.readContract({ address: rnsContracts.registrar, abi: registrarAbi, functionName: "expiryOf", args: [label] }),
      client.readContract({ address: rnsContracts.registrar, abi: registrarAbi, functionName: "available", args: [label] }),
      client.readContract({ address: rnsContracts.registrar, abi: registrarAbi, functionName: "effectivePolicy", args: [label] }),
      client.getBlockNumber(),
    ]);
    const owner = getAddress(ownerRaw).toLowerCase() as EvmAddress;
    const resolver = getAddress(resolverRaw).toLowerCase() as EvmAddress;
    let resolved: EvmAddress | null = null;
    if (resolver !== zeroAddress) {
      try {
        resolved = getAddress(await client.readContract({
          address: resolver,
          abi: resolverAbi,
          functionName: "addr",
          args: [node],
        })).toLowerCase() as EvmAddress;
      } catch {
        resolved = null;
      }
    }
    const policy = Number(policyRaw);
    const nowUnix = BigInt(Math.floor(Date.now() / 1_000));

    return {
      chainId: 4_153,
      network: "RISE Mainnet",
      node,
      label,
      name,
      owner: owner === zeroAddress ? null : owner,
      resolver: resolver === zeroAddress ? null : resolver,
      resolvedAddress: !resolved || resolved === zeroAddress ? null : resolved,
      expiry: expiry.toString(),
      isExpired: expiry > 0n && expiry <= nowUnix,
      registered: owner !== zeroAddress && expiry > nowUnix,
      available,
      policy: { id: policy, name: policyNames[policy] ?? "unknown" },
      publicRegistrationAvailable: available && policy === 0,
      blockNumber: blockNumber.toString(),
      source: "onchain",
    };
  }

  async function resolveName(input: string): Promise<RnsResolution | null> {
    const record = await getAvailability(input);
    if (!record.registered || !record.owner) return null;
    return {
      chainId: record.chainId,
      name: record.name,
      node: record.node,
      address: record.resolvedAddress,
      owner: record.owner,
      resolver: record.resolver,
      expiry: record.expiry,
      blockNumber: record.blockNumber,
      source: "onchain",
    };
  }

  return { getAvailability, resolveName };
}
