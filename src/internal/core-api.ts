import { AlchemyConfig } from '../api/alchemy-config.js';
import { toHex } from '../api/util.js';
import type { Log } from '../types/eth.js';
import {
  AssetTransfersParams,
  AssetTransfersResponse,
  AssetTransfersWithMetadataParams,
  AssetTransfersWithMetadataResponse,
  Filter,
  FilterByBlockHash,
  TransactionReceiptsParams,
  TransactionReceiptsResponse
} from '../types/types.js';
import { formatBlock } from '../util/util.js';
import { formatBlockTag, formatLog } from './eth-rpc.js';

/**
 * Gets the asset transfers for the provided params.
 */
export async function getAssetTransfers(
  config: AlchemyConfig,
  params: AssetTransfersWithMetadataParams | AssetTransfersParams,
  _srcMethod = 'getAssetTransfers'
): Promise<AssetTransfersResponse | AssetTransfersWithMetadataResponse> {
  const request = { ...params };
  if (request.fromAddress) {
    request.fromAddress = await config.resolveAddress(request.fromAddress);
  }
  if (request.toAddress) {
    request.toAddress = await config.resolveAddress(request.toAddress);
  }
  return config.send('alchemy_getAssetTransfers', [
    {
      ...request,
      fromBlock:
        request.fromBlock != null ? formatBlock(request.fromBlock) : undefined,
      toBlock:
        request.toBlock != null ? formatBlock(request.toBlock) : undefined,
      maxCount: request.maxCount != null ? toHex(request.maxCount) : undefined
    }
  ]);
}

export async function getTransactionReceipts(
  config: AlchemyConfig,
  params: TransactionReceiptsParams,
  _srcMethod = 'getTransactionReceipts'
): Promise<TransactionReceiptsResponse> {
  return config.send('alchemy_getTransactionReceipts', [params]);
}

/**
 * Returns logs matching `filter`. An address array is passed through, which the
 * Ethereum JSON-RPC `eth_getLogs` method accepts.
 */
export async function getLogs(
  config: AlchemyConfig,
  filter: Filter | FilterByBlockHash
): Promise<Array<Log>> {
  const formatted = await formatFilter(config, filter);
  const logs: any[] = await config.send('eth_getLogs', [formatted]);
  return logs.map(formatLog);
}

async function formatFilter(
  config: AlchemyConfig,
  filter: Filter | FilterByBlockHash
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  if ('blockHash' in filter && filter.blockHash != null) {
    result.blockHash = filter.blockHash;
  }
  if (filter.topics != null) {
    result.topics = filter.topics;
  }
  if ('fromBlock' in filter && filter.fromBlock != null) {
    result.fromBlock = formatBlockTag(filter.fromBlock);
  }
  if ('toBlock' in filter && filter.toBlock != null) {
    result.toBlock = formatBlockTag(filter.toBlock);
  }
  if (Array.isArray(filter.address)) {
    result.address = await Promise.all(
      filter.address.map(address => config.resolveAddress(address))
    );
  } else if (filter.address != null) {
    result.address = await config.resolveAddress(filter.address);
  }
  return result;
}
