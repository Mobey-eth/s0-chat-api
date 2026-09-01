import { createPublicClient, getAddress, http, parseAbi, zeroAddress } from "viem";
import { namehash } from "viem/ens";
import { config } from "../config.js";
import { normalizeRnsLabel } from "./service.js";

const client = createPublicClient({
  transport: http(config.riseRpcUrl),
});

const registryAbi = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
]);

const resolverAbi = parseAbi([
  "function addr(bytes32 node) view returns (address)",
]);

const registrarAbi = parseAbi([
  "function available(string name) view returns (bool)",
  "function effectivePolicy(string name) view returns (uint8)",
  "function expiryOf(string name) view returns (uint256)",
]);

const POLICY_NAMES = ["open", "protected", "auction_only", "fixed_premium"] as const;

function normalizedAddress(address: string) {
  return getAddress(address).toLowerCase();
}

export async function readRnsNameOnchain(name: string) {
  const label = normalizeRnsLabel(name);
  if (!label) return null;

  const fqdn = `${label}.rise`;
  const node = namehash(fqdn);
  const [ownerRaw, resolverRaw, expiry, available, policyRaw, blockNumber] = await Promise.all([
    client.readContract({
      address: config.rnsContracts.registry as `0x${string}`,
      abi: registryAbi,
      functionName: "owner",
      args: [node],
    }),
    client.readContract({
      address: config.rnsContracts.registry as `0x${string}`,
      abi: registryAbi,
      functionName: "resolver",
      args: [node],
    }),
    client.readContract({
      address: config.rnsContracts.registrar as `0x${string}`,
      abi: registrarAbi,
      functionName: "expiryOf",
      args: [label],
    }),
    client.readContract({
      address: config.rnsContracts.registrar as `0x${string}`,
      abi: registrarAbi,
      functionName: "available",
      args: [label],
    }),
    client.readContract({
      address: config.rnsContracts.registrar as `0x${string}`,
      abi: registrarAbi,
      functionName: "effectivePolicy",
      args: [label],
    }),
    client.getBlockNumber(),
  ]);

  const owner = normalizedAddress(ownerRaw);
  const resolver = normalizedAddress(resolverRaw);
  let resolvedAddress: string | null = null;
  if (resolver !== zeroAddress) {
    try {
      resolvedAddress = normalizedAddress(await client.readContract({
        address: resolver as `0x${string}`,
        abi: resolverAbi,
        functionName: "addr",
        args: [node],
      }));
    } catch {
      resolvedAddress = null;
    }
  }
  const policy = Number(policyRaw);
  const nowUnix = BigInt(Math.floor(Date.now() / 1_000));
  const registered = owner !== zeroAddress && expiry > nowUnix;

  return {
    chainId: config.riseChainId,
    network: config.riseNetworkName,
    node,
    label,
    name: fqdn,
    owner: owner === zeroAddress ? null : owner,
    resolver: resolver === zeroAddress ? null : resolver,
    resolvedAddress: !resolvedAddress || resolvedAddress === zeroAddress ? null : resolvedAddress,
    expiry: expiry.toString(),
    isExpired: expiry > 0n && expiry <= nowUnix,
    registered,
    available,
    policy: {
      id: policy,
      name: POLICY_NAMES[policy] ?? "unknown",
    },
    publicRegistrationAvailable: available && policy === 0,
    blockNumber: blockNumber.toString(),
    source: "onchain" as const,
  };
}
