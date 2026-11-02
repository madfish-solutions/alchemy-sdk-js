import { Alchemy, Network } from '../../src/index.js';
import { resolveNetwork } from '../../src/internal/network.js';
import { AlchemyApiType } from '../../src/util/const.js';

describe('Alchemy JSON-RPC client', () => {
  it('resolves a known network slug', () => {
    const resolved = resolveNetwork(Network.ETH_MAINNET);
    expect(resolved.slug).toEqual(Network.ETH_MAINNET);
    expect(resolved.chainId).toEqual(1);
    expect(resolved.rpcBaseUrl).toContain('eth-mainnet.g.alchemy.com');
    expect(resolved.solana).toBe(false);
  });

  it('throws when JSON-RPC is used on Solana', async () => {
    const alchemy = new Alchemy({ network: Network.SOLANA_MAINNET });
    expect(() => alchemy.config.getClient()).toThrow(/Solana/);
  });

  it('uses the batcher when batching is enabled', async () => {
    const alchemy = new Alchemy({
      batchRequests: true,
      url: 'https://example.test/v2'
    });
    const enqueue = jest
      .spyOn(alchemy.config.batcher, 'enqueueRequest')
      .mockResolvedValueOnce('0x1')
      .mockResolvedValueOnce('0x2');

    const first = alchemy.core.send('eth_blockNumber', []);
    const second = alchemy.core.send('eth_chainId', []);
    expect(await first).toEqual('0x1');
    expect(await second).toEqual('0x2');
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('accepts a URL hard override', () => {
    const alchemy = new Alchemy({
      apiKey: 'demo-key',
      url: 'hardcoded-url'
    });
    expect(alchemy.config._getRequestUrl(AlchemyApiType.BASE)).toEqual(
      'hardcoded-url'
    );
    expect(alchemy.config.apiKey).toEqual('demo-key');
  });
});
