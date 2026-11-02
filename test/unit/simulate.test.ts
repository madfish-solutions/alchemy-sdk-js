import {
  DebugCallType,
  SimulateAssetType,
  SimulateChangeType
} from '../../src/index.js';
import { mapSimulatedCall } from '../../src/internal/simulate.js';

const transfer =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

describe('eth_simulateV1 mapping', () => {
  const usdc = {
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    value: '0x0',
    data: '0xa9059cbb'
  };

  it('maps an ERC-20 transfer log', () => {
    const mapped = mapSimulatedCall(usdc, {
      status: '0x1',
      gasUsed: '0xf328',
      returnData:
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      logs: [
        {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          topics: [
            transfer,
            '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
            '0x000000000000000000000000fc43f5f9dd45258b3aff31bdbe6561d97e8b71de'
          ],
          data: '0x00000000000000000000000000000000000000000000000000000000000f4240'
        }
      ]
    });

    expect(mapped.assets.error).toBeUndefined();
    expect(mapped.assets.gasUsed).toBe('0xf328');
    expect(mapped.assets.changes).toEqual([
      {
        assetType: SimulateAssetType.ERC20,
        changeType: SimulateChangeType.TRANSFER,
        from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        to: '0xfc43f5f9dd45258b3aff31bdbe6561d97e8b71de',
        contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        rawAmount: '1000000'
      }
    ]);
    expect(mapped.execution.calls).toHaveLength(1);
    expect(mapped.execution.calls[0].type).toBe(DebugCallType.CALL);
    expect(mapped.execution.calls[0].output).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    );
    expect(mapped.execution.logs).toHaveLength(1);
  });

  it('maps an ERC-721 transfer and an approval-for-all', () => {
    const nft = mapSimulatedCall(
      { from: '0x699aeca448ad51effd6dbee0a8618a79cf4370ba' },
      {
        status: '0x1',
        logs: [
          {
            address: '0x32e74d0b224e3ab4e854e81adc645dac9968ee93',
            topics: [
              transfer,
              '0x000000000000000000000000699aeca448ad51effd6dbee0a8618a79cf4370ba',
              '0x000000000000000000000000699aeca448ad51effd6dbee0a8618a79cf4370bb',
              '0x0000000000000000000000000000000000000000000000000000000000000625'
            ],
            data: '0x'
          }
        ]
      }
    );
    expect(nft.assets.changes[0]).toMatchObject({
      assetType: SimulateAssetType.ERC721,
      changeType: SimulateChangeType.TRANSFER,
      tokenId: '1573',
      contractAddress: '0x32e74d0b224e3ab4e854e81adc645dac9968ee93'
    });

    const approval = mapSimulatedCall(
      { from: '0xa06c3c08a19e51b33309eddfb356c33ead8517a3' },
      {
        status: '0x1',
        logs: [
          {
            address: '0xb54420149dbe2d5b2186a3e6dc6fc9d1a58316d4',
            topics: [
              '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
              '0x000000000000000000000000a06c3c08a19e51b33309eddfb356c33ead8517a3',
              '0x0000000000000000000000000dd7eef07982749410eceaa721cdc8ff3167fc9b'
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000000000001'
          }
        ]
      }
    );
    expect(approval.assets.changes[0]).toMatchObject({
      assetType: SimulateAssetType.ERC721,
      changeType: SimulateChangeType.APPROVE,
      decimals: 0
    });
  });

  it('maps a reverted call to an error and no asset changes', () => {
    const mapped = mapSimulatedCall(
      { from: '0x538dF212DEf9d27B646B733cB267a69cBE1b77ad' },
      {
        status: '0x0',
        gasUsed: '0x53ef',
        returnData: '0x',
        error: { message: 'execution reverted' },
        logs: []
      }
    );
    expect(mapped.assets.changes).toEqual([]);
    expect(mapped.assets.gasUsed).toBe('0x53ef');
    expect(mapped.assets.error?.message).toBe('execution reverted');
    expect(mapped.execution.calls[0].error).toBe('execution reverted');
  });
});
