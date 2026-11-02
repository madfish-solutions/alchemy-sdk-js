import { getAlchemyRpcUrl, getSupportedChainIds } from '@alchemy/common';

import { Network } from '../../src/index.js';
import {
  resetNetworkCache,
  resolveNetwork
} from '../../src/internal/network.js';

describe('network slugs', () => {
  afterEach(() => {
    resetNetworkCache();
  });

  it('resolves a known enum member from the registry', () => {
    const resolved = resolveNetwork(Network.ETH_MAINNET);
    expect(resolved.chainId).toEqual(1);
    expect(resolved.slug).toEqual('eth-mainnet');
    expect(resolved.rpcBaseUrl).toEqual('https://eth-mainnet.g.alchemy.com/v2');
  });

  it('includes every registry slug', () => {
    const enumSlugs = new Set<string>(Object.values(Network));
    const missing = getSupportedChainIds()
      .map(chainId => {
        const rpcBaseUrl = getAlchemyRpcUrl(chainId);
        if (!rpcBaseUrl) {
          return undefined;
        }
        const slug = new URL(rpcBaseUrl).hostname.split('.')[0];
        return enumSlugs.has(slug) ? undefined : slug;
      })
      .filter((slug): slug is string => slug != null);

    expect(missing).toEqual([]);
  });

  it('falls back when the slug is not in the registry', () => {
    const resolved = resolveNetwork('not-a-real-chain-xyz');
    expect(resolved.chainId).toBeUndefined();
    expect(resolved.rpcBaseUrl).toEqual(
      'https://not-a-real-chain-xyz.g.alchemy.com/v2'
    );
    expect(resolved.solana).toBe(false);
  });
});
