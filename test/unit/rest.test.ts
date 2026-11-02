import { Alchemy } from '../../src/index.js';
import { setHttpTransport } from '../../src/internal/http.js';

const CONTRACT = '0x0000000000000000000000000000000000000001';

describe('REST retries', () => {
  afterEach(() => {
    jest.useRealTimers();
    setHttpTransport();
  });

  function skipDelays(): void {
    jest.useFakeTimers();
    jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
      callback();
      return 0 as any;
    });
  }

  it('retries 429 and then succeeds', async () => {
    skipDelays();
    let calls = 0;
    setHttpTransport(async () => {
      calls += 1;
      if (calls < 3) {
        return { status: 429, data: 'Too many requests' };
      }
      return { status: 200, data: { owners: ['0xabc'], pageKey: null } };
    });

    const alchemy = new Alchemy({ maxRetries: 5 });
    const owners = await alchemy.nft.getOwnersForContract(CONTRACT);
    expect(owners.owners).toEqual(['0xabc']);
    expect(calls).toEqual(3);
  });

  it('fails immediately on 400', async () => {
    skipDelays();
    let calls = 0;
    setHttpTransport(async () => {
      calls += 1;
      return { status: 400, data: 'bad request' };
    });

    const alchemy = new Alchemy({ maxRetries: 5 });
    await expect(alchemy.nft.getOwnersForContract(CONTRACT)).rejects.toThrow(
      'bad request'
    );
    expect(calls).toEqual(1);
  });
});
