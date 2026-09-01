import { STAGE0_RNS_API_URL } from "./constants.js";
import type {
  EvmAddress,
  RnsApiErrorBody,
  RnsAvailability,
  RnsListResponse,
  RnsResolution,
  RnsReverseResolution,
} from "./types.js";

export class Stage0RnsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: RnsApiErrorBody,
  ) {
    super(body.detail ?? body.error ?? `Stage0 RNS API returned HTTP ${status}`);
    this.name = "Stage0RnsApiError";
  }
}

export interface Stage0RnsApiClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

function pathValue(value: string) {
  return encodeURIComponent(value.trim());
}

export function createStage0RnsApiClient(options: Stage0RnsApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? STAGE0_RNS_API_URL).replace(/\/$/, "");
  const fetcher = options.fetch ?? globalThis.fetch;

  async function request<T>(path: string): Promise<T> {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const body = await response.json() as T | RnsApiErrorBody;
    if (!response.ok) {
      throw new Stage0RnsApiError(response.status, body as RnsApiErrorBody);
    }
    return body as T;
  }

  return {
    getNetwork: () => request<Record<string, unknown>>("/network"),
    getHealth: () => request<Record<string, unknown>>("/health"),
    resolveName: (name: string) => request<RnsResolution>(`/resolve/${pathValue(name)}`),
    reverseResolve: (address: EvmAddress) => request<RnsReverseResolution>(`/reverse/${pathValue(address)}`),
    getName: (name: string) => request<RnsAvailability & { indexed: Record<string, unknown> | null }>(`/names/${pathValue(name)}`),
    getAvailability: (name: string) => request<RnsAvailability>(`/availability/${pathValue(name)}`),
    listAddressNames: (address: EvmAddress) => request<Record<string, unknown>>(`/addresses/${pathValue(address)}/names`),
    getPricing: (name?: string, years = 1) => {
      const query = new URLSearchParams({ years: String(years) });
      if (name) query.set("name", name);
      return request<Record<string, unknown>>(`/pricing?${query}`);
    },
    listPrimaryAuctions: <T = Record<string, unknown>>(limit = 50) => request<RnsListResponse<T>>(`/auctions?limit=${limit}`),
    listMarketplaceListings: <T = Record<string, unknown>>(limit = 50) => request<RnsListResponse<T>>(`/marketplace/listings?limit=${limit}`),
    listMarketplaceAuctions: <T = Record<string, unknown>>(limit = 50) => request<RnsListResponse<T>>(`/marketplace/auctions?limit=${limit}`),
    listMarketplaceActivity: <T = Record<string, unknown>>(limit = 50) => request<RnsListResponse<T>>(`/marketplace/activity?limit=${limit}`),
  };
}
