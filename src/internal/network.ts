import { getAlchemyRpcUrl, getSupportedChainIds } from '@alchemy/common';

export interface ResolvedNetwork {
  slug: string;
  chainId?: number;
  /** Alchemy RPC base URL without an API key, such as `https://eth-mainnet.g.alchemy.com/v2`. */
  rpcBaseUrl: string;
  solana: boolean;
}

let registryBySlug:
  | Map<string, { chainId: number; rpcBaseUrl: string }>
  | undefined;

function loadRegistry(): Map<string, { chainId: number; rpcBaseUrl: string }> {
  if (registryBySlug) {
    return registryBySlug;
  }
  const map = new Map<string, { chainId: number; rpcBaseUrl: string }>();
  for (const chainId of getSupportedChainIds()) {
    const rpcBaseUrl = getAlchemyRpcUrl(chainId);
    if (!rpcBaseUrl) {
      continue;
    }
    let slug: string;
    try {
      slug = new URL(rpcBaseUrl).hostname.split('.')[0];
    } catch {
      continue;
    }
    if (slug) {
      map.set(slug, { chainId, rpcBaseUrl });
    }
  }
  registryBySlug = map;
  return map;
}

/**
 * Resolves an Alchemy network slug to a chain id and RPC base URL.
 *
 * Slugs present in `@alchemy/common` use that registry. Unknown slugs fall back
 * to `https://{slug}.g.alchemy.com/v2` so a new chain can be used before this
 * package's `Network` enum is updated.
 *
 * @internal
 */
export function resolveNetwork(network: string): ResolvedNetwork {
  if (network.startsWith('solana-')) {
    return {
      slug: network,
      rpcBaseUrl: `https://${network}.g.alchemy.com/v2`,
      solana: true
    };
  }
  const known = loadRegistry().get(network);
  if (known) {
    return {
      slug: network,
      chainId: known.chainId,
      rpcBaseUrl: known.rpcBaseUrl,
      solana: false
    };
  }
  return {
    slug: network,
    rpcBaseUrl: `https://${network}.g.alchemy.com/v2`,
    solana: false
  };
}

/** @internal */
export function resetNetworkCache(): void {
  registryBySlug = undefined;
}

/**
 * HTTP JSON-RPC endpoint for a network. Custom `url` overrides the registry.
 * The API key is sent as a bearer token, matching `alchemyTransport`.
 *
 * @internal
 */
export function jsonRpcHttpUrl(network: string, url?: string): string {
  if (url) {
    return url;
  }
  const resolved = resolveNetwork(network);
  if (resolved.chainId != null) {
    return getAlchemyRpcUrl(resolved.chainId) ?? resolved.rpcBaseUrl;
  }
  return resolved.rpcBaseUrl;
}

/** @internal */
export function jsonRpcWsUrl(
  network: string,
  apiKey: string,
  url?: string
): string {
  if (url) {
    return url;
  }
  const http = jsonRpcHttpUrl(network);
  const wsBase = http.replace(/^http(s?)/, 'ws$1');
  return `${wsBase}/${apiKey}`;
}
