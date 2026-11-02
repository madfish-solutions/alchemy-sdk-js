import { Alchemy, Network } from '../../src/index.js';

function rpcResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('JSON-RPC mapping', () => {
  const address = '0x0000000000000000000000000000000000000001';

  afterEach(() => {
    jest.unstubAllGlobals();
    jest.useRealTimers();
  });

  it('maps getBalance and getFeeData onto bigint', async () => {
    jest.stubGlobal(
      'fetch',
      jest.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        const method = request.method as string;
        let result: unknown = '0x0';
        if (method === 'eth_getBalance') {
          result = '0x2a';
        } else if (method === 'eth_gasPrice') {
          result = '0x20';
        } else if (method === 'eth_maxPriorityFeePerGas') {
          result = '0x2';
        } else if (method === 'eth_getBlockByNumber') {
          result = {
            hash: '0x11',
            parentHash: '0x22',
            number: '0x10',
            timestamp: '0x1',
            nonce: '0x0',
            difficulty: '0x0',
            gasLimit: '0x1',
            gasUsed: '0x1',
            miner: address,
            extraData: '0x',
            baseFeePerGas: '0x10',
            transactions: []
          };
        }
        return rpcResponse({
          jsonrpc: '2.0',
          id: request.id,
          result
        });
      })
    );

    const alchemy = new Alchemy({
      network: Network.ETH_MAINNET,
      apiKey: 'demo',
      maxRetries: 0,
      url: 'https://example.test/v2/demo'
    });

    expect(await alchemy.core.getBalance(address)).toEqual(42n);
    const fees = await alchemy.core.getFeeData();
    expect(fees.gasPrice).toEqual(32n);
    expect(fees.lastBaseFeePerGas).toEqual(16n);
    expect(fees.maxPriorityFeePerGas).toEqual(2n);
    expect(fees.maxFeePerGas).toEqual(34n);
  });

  it('posts batched requests as one JSON-RPC array', async () => {
    jest.useFakeTimers();
    const bodies: unknown[] = [];
    jest.stubGlobal(
      'fetch',
      jest.fn(async (_url: string, init: RequestInit) => {
        const payload = JSON.parse(String(init.body));
        bodies.push(payload);
        return rpcResponse(
          payload.map((item: { id: number }) => ({
            jsonrpc: '2.0',
            id: item.id,
            result: '0x1'
          }))
        );
      })
    );

    const alchemy = new Alchemy({
      batchRequests: true,
      apiKey: 'demo',
      network: Network.ETH_MAINNET
    });
    const pending = Promise.all([
      alchemy.core.send('eth_blockNumber', []),
      alchemy.core.send('eth_chainId', [])
    ]);
    await jest.advanceTimersByTimeAsync(20);
    expect(await pending).toEqual(['0x1', '0x1']);
    expect(bodies).toHaveLength(1);
    expect(Array.isArray(bodies[0])).toBe(true);
    expect(bodies[0]).toHaveLength(2);
  });

  it('retries a failed JSON-RPC call', async () => {
    let calls = 0;
    jest.stubGlobal(
      'fetch',
      jest.fn(async (_url: string, init: RequestInit) => {
        calls += 1;
        const request = JSON.parse(String(init.body));
        if (calls === 1) {
          return new Response('unavailable', { status: 429 });
        }
        return rpcResponse({
          jsonrpc: '2.0',
          id: request.id,
          result: '0x64'
        });
      })
    );

    const alchemy = new Alchemy({
      apiKey: 'demo',
      network: Network.ETH_MAINNET,
      maxRetries: 2,
      url: 'https://example.test/v2/demo'
    });
    expect(await alchemy.core.getBlockNumber()).toEqual(100);
    expect(calls).toBeGreaterThan(1);
  });
});
