import {
  Alchemy,
  AlchemySubscription,
  type AlchemyWebSocketProvider,
  Network
} from '../../src/index.js';
import { loadAlchemyEnv } from '../test-util.js';

jest.setTimeout(50000);

describe('JSON-RPC client', () => {
  let alchemy: Alchemy;
  let wsProvider: AlchemyWebSocketProvider;

  beforeEach(async () => {
    await loadAlchemyEnv();
    alchemy = new Alchemy({
      apiKey: process.env.ALCHEMY_API_KEY,
      network: Network.ETH_MAINNET
    });
    wsProvider = await alchemy.config.getWebSocketProvider();
  });

  afterEach(async () => {
    await wsProvider.destroy();
  });

  it('json-rpc send matches the viem client', async () => {
    const address = '0xc94770007dda54cF92009BFF0dE90c06F603a09f';
    const actual = await alchemy.core.send('eth_getBalance', [
      address,
      'latest'
    ]);
    const client = await alchemy.config.getClient();
    const expected = await client.request({
      method: 'eth_getBalance',
      params: [address, 'latest']
    });
    expect(actual).toEqual(expected);
  });

  it('returns a block number and balance', async () => {
    const blockNumber = await alchemy.core.getBlockNumber();
    expect(blockNumber).toBeGreaterThan(0);

    const balance = await alchemy.core.getBalance(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    );
    expect(typeof balance).toEqual('bigint');

    const client = await alchemy.config.getClient();
    const chainId = await client.getChainId();
    expect(chainId).toEqual(1);
  });

  it('alchemy_pendingTransactions', (done: () => void) => {
    let eventCount = 0;
    const address = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    wsProvider.on(
      {
        method: AlchemySubscription.PENDING_TRANSACTIONS,
        toAddress: address,
        hashesOnly: true
      },
      (res: string) => {
        expect(res.substring(0, 2)).toEqual('0x');
        if (eventCount === 5) {
          done();
        }
        eventCount++;
      }
    );
  });

  it('alchemy_minedTransactions', (done: () => void) => {
    let eventCount = 0;
    wsProvider.on(
      {
        method: AlchemySubscription.MINED_TRANSACTIONS,
        hashesOnly: true
      },
      (res: any) => {
        expect(res.transaction).toBeDefined();
        expect(typeof res.transaction.hash).toEqual('string');
        if (eventCount === 5) {
          done();
        }
        eventCount++;
      }
    );
  });

  it('once', (done: () => void) => {
    const address = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    let eventCount = 0;
    wsProvider.once(
      {
        method: AlchemySubscription.PENDING_TRANSACTIONS,
        toAddress: address,
        hashesOnly: true
      },
      () => {
        eventCount++;
        if (eventCount > 1) {
          done();
        }
      }
    );

    wsProvider.once(
      {
        method: AlchemySubscription.PENDING_TRANSACTIONS,
        toAddress: address,
        hashesOnly: true
      },
      () => {
        eventCount++;
        if (eventCount > 1) {
          done();
        }
      }
    );
  });

  it('can send normal json-rpc methods', async () => {
    const res = await wsProvider.getBlockNumber();
    expect(typeof res).toBe('number');
  });

  it('full transactions', (done: () => void) => {
    let eventCount = 0;
    wsProvider.on(
      {
        method: AlchemySubscription.PENDING_TRANSACTIONS
      },
      () => {
        if (eventCount === 10) {
          done();
        }
        eventCount++;
      }
    );
  });

  it('handles blocks', (done: () => void) => {
    wsProvider.on('block', res => {
      expect(typeof res).toEqual('number');
      done();
    });
  });

  it('batching mode resolves promises', async () => {
    const batched = new Alchemy({
      apiKey: process.env.ALCHEMY_API_KEY,
      network: Network.ETH_MAINNET,
      batchRequests: true
    });

    const gasPrice = await batched.core.getGasPrice();
    const blockNumber = await batched.core.getBlockNumber();
    expect(typeof gasPrice).toEqual('bigint');
    expect(blockNumber).toBeGreaterThan(0);
  });
});
