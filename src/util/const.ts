import { Network } from '../types/types.js';

export const DEFAULT_ALCHEMY_API_KEY = 'demo';
export const DEFAULT_NETWORK = Network.ETH_MAINNET;
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_REQUEST_TIMEOUT = 0; // 0 = no timeout

/**
 * Legacy keyed HTTP URL. JSON-RPC calls use {@link jsonRpcHttpUrl} plus bearer
 * auth instead. This helper remains for callers that inspect the base URL.
 */
export function getAlchemyHttpUrl(network: string, apiKey: string): string {
  return `https://${network}.g.alchemy.com/v2/${apiKey}`;
}

export function getAlchemyNftHttpUrl(network: string, apiKey: string): string {
  return `https://${network}.g.alchemy.com/nft/v3/${apiKey}`;
}

export function getAlchemyWebhookHttpUrl(): string {
  return 'https://dashboard.alchemy.com/api';
}

export function getPricesBaseUrl(apiKey: string): string {
  return `https://api.g.alchemy.com/prices/v1/${apiKey}`;
}

export function getDataBaseUrl(apiKey: string): string {
  return `https://api.g.alchemy.com/data/v1/${apiKey}`;
}

export enum AlchemyApiType {
  BASE,
  NFT,
  WEBHOOK,
  PRICES,
  PORTFOLIO
}

export function noop(): void {
  // It's a no-op
}

export const ETH_NULL_VALUE = '0x';

export const ETH_NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
