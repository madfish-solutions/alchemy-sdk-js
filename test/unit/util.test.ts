import {
  formatUnits,
  fromHex,
  isHex,
  isHexAddress,
  toDecimalString,
  toHex
} from '../../src/api/util.js';

describe('hex and address helpers', () => {
  const checksum = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

  it('accepts lowercase and checksummed addresses', () => {
    expect(isHexAddress(checksum.toLowerCase())).toBe(true);
    expect(isHexAddress(checksum)).toBe(true);
  });

  it('rejects a broken checksum and a short address', () => {
    expect(isHexAddress('0xd8da6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(
      false
    );
    expect(isHexAddress('0x1234')).toBe(false);
  });

  it('keeps the public hex quantity contract', () => {
    expect(toHex(0)).toBe('0x0');
    expect(fromHex('0x10')).toBe(16);
    expect(isHex('0x0')).toBe(true);
    expect(isHex('0x')).toBe(false);
    expect(toDecimalString('0x1b7')).toBe('439');
    expect(formatUnits(1000000n, 6)).toBe('1');
  });
});
