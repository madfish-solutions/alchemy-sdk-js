import { type PublicClient, createPublicClient, defineChain } from 'viem';

import { alchemyTransport } from '@alchemy/common';

import { JsonRpcRequest, JsonRpcResponse } from '../internal/internal-types.js';
import { jsonRpcHttpUrl, resolveNetwork } from '../internal/network.js';
import { RequestBatcher } from '../internal/request-batcher.js';
import type { NetworkInfo } from '../types/eth.js';
import { AlchemySettings, Network } from '../types/types.js';
import {
  AlchemyApiType,
  DEFAULT_ALCHEMY_API_KEY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_NETWORK,
  DEFAULT_REQUEST_TIMEOUT,
  getAlchemyHttpUrl,
  getAlchemyNftHttpUrl,
  getAlchemyWebhookHttpUrl,
  getDataBaseUrl,
  getPricesBaseUrl
} from '../util/const.js';
import { VERSION } from '../version.js';
import type { AlchemyWebSocketProvider } from './alchemy-websocket-provider.js';
import { isHexAddress } from './util.js';

/**
 * This class holds the config information for the SDK client instance and
 * exposes the underlying viem client for more advanced use cases.
 *
 * @public
 */
export class AlchemyConfig {
  /** The Alchemy API key. */
  readonly apiKey: string;

  /** The Network that this SDK is associated with. */
  readonly network: Network | string;

  /** The maximum number of retries to perform. */
  readonly maxRetries: number;

  /** Setting to enable automatic batching on json-rpc requests. Defaults to false.*/
  readonly batchRequests: boolean;

  /** Optional headers forwarded to Alchemy HTTP requests. */
  readonly headers?: Record<string, string>;

  /**
   * Optional JWT. When set, it is sent instead of the API key as the bearer token.
   */
  readonly jwt?: string;

  /**
   * The optional hardcoded URL to send requests to instead of using the network
   * and apiKey.
   */
  readonly url?: string;

  /** The optional Alchemy auth token to use when sending requests with the Notify API. */
  readonly authToken?: string;

  /**
   * The optional Request timeout provided in `ms` for NFT and NOTIFY API. Defaults to 0.
   */
  readonly requestTimeout: number;

  /** @internal */
  readonly batcher: RequestBatcher;

  private _client: Promise<PublicClient> | undefined;
  private _websocketProvider: Promise<AlchemyWebSocketProvider> | undefined;
  private nextId = 1;

  constructor(config?: AlchemySettings) {
    this.apiKey = config?.apiKey || DEFAULT_ALCHEMY_API_KEY;
    this.network = config?.network || DEFAULT_NETWORK;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.url = config?.url;
    this.authToken = config?.authToken;
    this.jwt = config?.jwt;
    this.headers = config?.headers;
    this.batchRequests = config?.batchRequests || false;
    this.requestTimeout = config?.requestTimeout || DEFAULT_REQUEST_TIMEOUT;
    this.batcher = new RequestBatcher(requests => this.postBatch(requests));
  }

  /**
   * Returns the URL endpoint to send the HTTP request to. If a custom URL was
   * provided in the config, that URL is returned. Otherwise, the default URL is
   * from the network and API key.
   *
   * @param apiType - The type of API to get the URL for.
   * @internal
   */
  _getRequestUrl(apiType: AlchemyApiType): string {
    if (this.url !== undefined) {
      return this.url;
    } else if (apiType === AlchemyApiType.NFT) {
      return getAlchemyNftHttpUrl(this.network, this.apiKey);
    } else if (apiType === AlchemyApiType.WEBHOOK) {
      return getAlchemyWebhookHttpUrl();
    } else if (apiType === AlchemyApiType.PRICES) {
      return getPricesBaseUrl(this.apiKey);
    } else if (apiType === AlchemyApiType.PORTFOLIO) {
      return getDataBaseUrl(this.apiKey);
    } else {
      return getAlchemyHttpUrl(this.network, this.apiKey);
    }
  }

  /**
   * Returns the viem public client used for JSON-RPC. The same client is reused
   * for the lifetime of this config.
   *
   * @public
   */
  getClient(): Promise<PublicClient> {
    this.assertEvmNetwork();
    if (!this._client) {
      this._client = Promise.resolve(this.createClient());
    }
    return this._client;
  }

  /**
   * Returns an AlchemyWebsocketProvider instance. Only one provider is created
   * per Alchemy instance.
   */
  getWebSocketProvider(): Promise<AlchemyWebSocketProvider> {
    if (!this._websocketProvider) {
      this._websocketProvider = import('./alchemy-websocket-provider.js').then(
        ({ AlchemyWebSocketProvider }) => new AlchemyWebSocketProvider(this)
      );
    }
    return this._websocketProvider;
  }

  /**
   * Sends a JSON-RPC request. Batches when `batchRequests` is enabled.
   * Otherwise the call goes through `alchemyTransport`, which applies retries.
   *
   * @internal
   */
  send(method: string, params: unknown[] = []): Promise<any> {
    this.assertEvmNetwork();
    if (this.batchRequests) {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: this.nextId++,
        method,
        params
      };
      return this.batcher.enqueueRequest(request);
    }
    return this.getClient().then(client =>
      client.request({ method, params } as any)
    );
  }

  /** @internal */
  async resolveName(name: string): Promise<string | null> {
    if (isHexAddress(name)) {
      return name;
    }
    if (!name.includes('.')) {
      return null;
    }
    try {
      const client = await this.getClient();
      const address = await client.getEnsAddress({ name });
      return address ?? null;
    } catch {
      return null;
    }
  }

  /** @internal */
  async lookupAddress(address: string): Promise<string | null> {
    try {
      const client = await this.getClient();
      const name = await client.getEnsName({
        address: address as `0x${string}`
      });
      return name ?? null;
    } catch {
      return null;
    }
  }

  /** @internal */
  async resolveAddress(addressOrName: string): Promise<string> {
    if (isHexAddress(addressOrName)) {
      return addressOrName;
    }
    const resolved = await this.resolveName(addressOrName);
    if (resolved === null) {
      throw new Error(`Unable to resolve the ENS address: ${addressOrName}`);
    }
    return resolved;
  }

  /** @internal */
  getNetworkInfo(): NetworkInfo {
    const resolved = resolveNetwork(String(this.network));
    return {
      name: resolved.slug,
      chainId: resolved.chainId ?? 0
    };
  }

  private assertEvmNetwork(): void {
    const resolved = resolveNetwork(String(this.network));
    if (resolved.solana) {
      throw new Error(
        `JSON-RPC is not available for Solana network '${resolved.slug}'.`
      );
    }
  }

  private createClient(): PublicClient {
    const resolved = resolveNetwork(String(this.network));
    const endpoint = jsonRpcHttpUrl(String(this.network), this.url);
    const chain = defineChain({
      id: resolved.chainId ?? 1,
      name: resolved.slug,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [endpoint] } }
    });
    const transport = alchemyTransport({
      apiKey: this.apiKey,
      jwt: this.jwt,
      url:
        this.url ??
        (resolved.chainId == null ? resolved.rpcBaseUrl : undefined),
      retryCount: this.maxRetries,
      retryDelay: 1000,
      timeout: this.requestTimeout > 0 ? this.requestTimeout : undefined,
      fetchOptions: {
        headers: {
          'Alchemy-Sdk-Version': VERSION,
          ...this.headers
        }
      }
    });
    return createPublicClient({ chain, transport });
  }

  private async postBatch(
    requests: JsonRpcRequest[]
  ): Promise<JsonRpcResponse[]> {
    const token = this.jwt ?? this.apiKey;
    const response = await fetch(
      jsonRpcHttpUrl(String(this.network), this.url),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Alchemy-Sdk-Version': VERSION,
          'Alchemy-Sdk-Method': 'batchSend',
          ...this.headers
        },
        body: JSON.stringify(requests)
      }
    );
    if (!response.ok) {
      const { ServerError } = await import('@alchemy/common');
      throw new ServerError(await response.text(), response.status);
    }
    return (await response.json()) as JsonRpcResponse[];
  }
}
