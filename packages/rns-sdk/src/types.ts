export type EvmAddress = `0x${string}`;
export type HexHash = `0x${string}`;

export interface RnsResolution {
  chainId: 4_153;
  name: string;
  node: HexHash;
  address: EvmAddress | null;
  owner: EvmAddress;
  resolver: EvmAddress | null;
  expiry: string;
  blockNumber: string;
  source: "onchain";
}

export interface RnsReverseResolution {
  chainId: 4_153;
  address: EvmAddress;
  primaryName: string | null;
  node: HexHash | null;
  resolvedAddress: EvmAddress | null;
  expiry: string | null;
  isExpired: boolean | null;
  lastIndexedBlock: string | null;
  lastIndexedAt: string | null;
}

export interface RnsAvailability {
  chainId: 4_153;
  network: "RISE Mainnet";
  node: HexHash;
  label: string;
  name: string;
  owner: EvmAddress | null;
  resolver: EvmAddress | null;
  resolvedAddress: EvmAddress | null;
  expiry: string;
  isExpired: boolean;
  registered: boolean;
  available: boolean;
  policy: {
    id: number;
    name: "open" | "protected" | "auction_only" | "fixed_premium" | "unknown";
  };
  publicRegistrationAvailable: boolean;
  blockNumber: string;
  source: "onchain";
}

export interface RnsListResponse<T> {
  chainId: 4_153;
  count: number;
  items: T[];
}

export interface RnsApiErrorBody {
  error: string;
  detail?: string;
  requestId?: string;
}
