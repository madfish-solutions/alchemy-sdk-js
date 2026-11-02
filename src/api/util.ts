import {
  formatUnits as formatViemUnits,
  hexToNumber,
  hexToBigInt as hexToViemBigInt,
  isAddress,
  isHex as isViemHex,
  numberToHex
} from 'viem';
import type { Hex } from 'viem';

import type { Quantity } from '../types/eth.js';

/**
 * Converts a hex string to a decimal number.
 *
 * Throws when the value is outside `Number.MAX_SAFE_INTEGER`.
 *
 * @param hexString - The hex string to convert.
 * @public
 */
export function fromHex(hexString: string): number {
  return hexToNumber(hexString as Hex);
}

/**
 * Converts a number to a hex string.
 *
 * `0` is `0x0`, with no zero padding.
 *
 * @param num - The number to convert to hex.
 * @public
 */
export function toHex(num: number): string {
  return numberToHex(num);
}

/**
 * Checks if a value is a hex string with at least one digit.
 *
 * @param possibleHexString - The value to check.
 * @public
 */
export function isHex(possibleHexString: string): boolean {
  return isViemHex(possibleHexString) && possibleHexString.length > 2;
}

/**
 * Checks a hex string. `length`, when set, is the number of bytes.
 *
 * @internal
 */
export function isHexString(value: unknown, length?: number): value is string {
  if (!isViemHex(value)) {
    return false;
  }
  if (length != null && value.length !== 2 + 2 * length) {
    return false;
  }
  return true;
}

/**
 * Checks an Ethereum address, including the EIP-55 checksum when the address
 * uses mixed case.
 *
 * @internal
 */
export function isHexAddress(value: string): boolean {
  return isAddress(value);
}

/** @internal */
export function hexToBigInt(value: string | null | undefined): bigint {
  if (value == null || value === '0x' || value === '0X') {
    return 0n;
  }
  return hexToViemBigInt(normalizeHexPrefix(value));
}

/** @internal */
export function quantityToHex(
  value: Quantity | null | undefined
): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'bigint' || typeof value === 'number') {
    return numberToHex(value);
  }
  const hex = hexQuantity(value);
  if (hex != null) {
    return hex === '0x' ? '0x0' : hex;
  }
  return numberToHex(BigInt(value.trim()));
}

/**
 * Decimal string form of a hex, decimal, or bigint quantity. Used for NFT
 * token ids, which the Alchemy API expects as base-10 strings.
 *
 * @internal
 */
export function toDecimalString(value: Quantity): string {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return BigInt(value).toString();
  }
  const hex = hexQuantity(value);
  if (hex != null) {
    return hexToViemBigInt(hex === '0x' ? '0x0' : hex).toString();
  }
  return BigInt(value.trim()).toString();
}

/**
 * Formats a wei-like integer using the given number of decimals.
 *
 * @internal
 */
export function formatUnits(value: string | bigint, decimals: number): string {
  const amount = typeof value === 'bigint' ? value : quantityToBigInt(value);
  return formatViemUnits(amount, decimals);
}

function quantityToBigInt(value: string): bigint {
  const hex = hexQuantity(value);
  if (hex != null) {
    return hexToViemBigInt(hex === '0x' ? '0x0' : hex);
  }
  return BigInt(value.trim());
}

function hexQuantity(value: string): Hex | undefined {
  const trimmed = value.trim();
  const normalized = normalizeHexPrefix(trimmed);
  return isViemHex(normalized) ? normalized : undefined;
}

function normalizeHexPrefix(value: string): Hex {
  if (value.startsWith('0X')) {
    return `0x${value.slice(2)}` as Hex;
  }
  return value as Hex;
}
