import type { AlchemyConfig } from '../api/alchemy-config.js';
import {
  fromHex,
  hexToBigInt,
  isHexString,
  quantityToHex,
  toHex
} from '../api/util.js';
import type {
  Block,
  BlockTag,
  BlockWithTransactions,
  FeeData,
  Log,
  TransactionReceipt,
  TransactionRequest,
  TransactionResponse
} from '../types/eth.js';

export function formatBlockTag(tag: BlockTag): string {
  if (typeof tag === 'number') {
    return toHex(tag);
  }
  return tag;
}

export function toRpcTransaction(
  tx: TransactionRequest
): Record<string, unknown> {
  const rpc: Record<string, unknown> = {
    to: tx.to,
    from: tx.from,
    data: tx.data ?? tx.input,
    gas: quantityToHex(tx.gasLimit ?? tx.gas),
    gasPrice: quantityToHex(tx.gasPrice),
    value: quantityToHex(tx.value),
    nonce: quantityToHex(tx.nonce),
    maxFeePerGas: quantityToHex(tx.maxFeePerGas),
    maxPriorityFeePerGas: quantityToHex(tx.maxPriorityFeePerGas),
    type: quantityToHex(tx.type),
    chainId: quantityToHex(tx.chainId),
    accessList: tx.accessList
  };
  return Object.fromEntries(
    Object.entries(rpc).filter(([, value]) => value !== undefined)
  );
}

export function formatLog(raw: any): Log {
  return {
    address: raw.address,
    topics: raw.topics ?? [],
    data: raw.data ?? '0x',
    blockNumber: fromHex(raw.blockNumber),
    transactionHash: raw.transactionHash,
    transactionIndex: fromHex(raw.transactionIndex),
    blockHash: raw.blockHash,
    logIndex: fromHex(raw.logIndex),
    removed: raw.removed ?? false
  };
}

export function formatTransaction(
  raw: any,
  wait: (
    hash: string,
    confirmations?: number
  ) => Promise<TransactionReceipt | null>
): TransactionResponse {
  return {
    hash: raw.hash,
    type: raw.type != null ? fromHex(raw.type) : undefined,
    blockHash: raw.blockHash ?? null,
    blockNumber: raw.blockNumber != null ? fromHex(raw.blockNumber) : null,
    transactionIndex:
      raw.transactionIndex != null ? fromHex(raw.transactionIndex) : null,
    confirmations: raw.blockNumber == null ? 0 : 1,
    from: raw.from,
    to: raw.to ?? null,
    nonce: raw.nonce != null ? fromHex(raw.nonce) : 0,
    gasLimit: hexToBigInt(raw.gas ?? raw.gasLimit),
    ...(raw.gasPrice != null ? { gasPrice: hexToBigInt(raw.gasPrice) } : {}),
    ...(raw.maxFeePerGas != null
      ? { maxFeePerGas: hexToBigInt(raw.maxFeePerGas) }
      : {}),
    ...(raw.maxPriorityFeePerGas != null
      ? { maxPriorityFeePerGas: hexToBigInt(raw.maxPriorityFeePerGas) }
      : {}),
    data: raw.input ?? raw.data ?? '0x',
    value: hexToBigInt(raw.value),
    chainId: raw.chainId != null ? fromHex(raw.chainId) : 0,
    r: raw.r,
    s: raw.s,
    v: raw.v != null ? fromHex(raw.v) : undefined,
    wait: (confirmations?: number) => wait(raw.hash, confirmations)
  };
}

export function formatReceipt(raw: any): TransactionReceipt {
  return {
    to: raw.to ?? null,
    from: raw.from,
    contractAddress: raw.contractAddress ?? null,
    transactionIndex: fromHex(raw.transactionIndex),
    gasUsed: hexToBigInt(raw.gasUsed),
    logsBloom: raw.logsBloom ?? '0x',
    blockHash: raw.blockHash,
    transactionHash: raw.transactionHash,
    logs: Array.isArray(raw.logs) ? raw.logs.map(formatLog) : [],
    blockNumber: fromHex(raw.blockNumber),
    confirmations: 1,
    cumulativeGasUsed: hexToBigInt(raw.cumulativeGasUsed),
    ...(raw.effectiveGasPrice != null
      ? { effectiveGasPrice: hexToBigInt(raw.effectiveGasPrice) }
      : {}),
    ...(raw.status != null ? { status: fromHex(raw.status) } : {}),
    ...(raw.type != null ? { type: fromHex(raw.type) } : {})
  };
}

export function formatBlockResponse(
  raw: any,
  fullTransactions: boolean,
  wait: (
    hash: string,
    confirmations?: number
  ) => Promise<TransactionReceipt | null>
): Block | BlockWithTransactions {
  const transactions = fullTransactions
    ? (raw.transactions ?? []).map((tx: any) => formatTransaction(tx, wait))
    : raw.transactions ?? [];
  return {
    hash: raw.hash ?? null,
    parentHash: raw.parentHash,
    number: raw.number != null ? fromHex(raw.number) : null,
    timestamp: raw.timestamp != null ? fromHex(raw.timestamp) : 0,
    nonce: raw.nonce ?? null,
    difficulty: hexToBigInt(raw.difficulty ?? '0x0'),
    gasLimit: hexToBigInt(raw.gasLimit ?? '0x0'),
    gasUsed: hexToBigInt(raw.gasUsed ?? '0x0'),
    miner: raw.miner ?? raw.author ?? '',
    extraData: raw.extraData ?? '0x',
    baseFeePerGas:
      raw.baseFeePerGas != null ? hexToBigInt(raw.baseFeePerGas) : null,
    transactions
  };
}

export async function getBlockByTag(
  config: AlchemyConfig,
  blockHashOrBlockTag: BlockTag,
  fullTransactions: boolean
): Promise<Block | BlockWithTransactions> {
  const tag = formatBlockTag(blockHashOrBlockTag);
  const method = isHexString(tag, 32)
    ? 'eth_getBlockByHash'
    : 'eth_getBlockByNumber';
  const raw = await config.send(method, [tag, fullTransactions]);
  if (raw == null) {
    throw new Error(`Block not found: ${tag}`);
  }
  return formatBlockResponse(raw, fullTransactions, (hash, confirmations) =>
    waitForTransaction(config, hash, confirmations)
  );
}

export async function getTransactionByHash(
  config: AlchemyConfig,
  transactionHash: string
): Promise<TransactionResponse | null> {
  const raw = await config.send('eth_getTransactionByHash', [transactionHash]);
  if (raw == null) {
    return null;
  }
  return formatTransaction(raw, (hash, confirmations) =>
    waitForTransaction(config, hash, confirmations)
  );
}

export async function getTransactionReceiptByHash(
  config: AlchemyConfig,
  transactionHash: string
): Promise<TransactionReceipt | null> {
  const raw = await config.send('eth_getTransactionReceipt', [transactionHash]);
  if (raw == null) {
    return null;
  }
  return formatReceipt(raw);
}

export async function waitForTransaction(
  config: AlchemyConfig,
  transactionHash: string,
  confirmations = 1,
  timeout?: number
): Promise<TransactionReceipt | null> {
  const started = Date.now();
  for (;;) {
    const receipt = await getTransactionReceiptByHash(config, transactionHash);
    if (confirmations <= 0) {
      return receipt;
    }
    if (receipt) {
      const current = fromHex(await config.send('eth_blockNumber', []));
      const seen = current - receipt.blockNumber + 1;
      if (seen >= confirmations) {
        return { ...receipt, confirmations: seen };
      }
    }
    if (timeout != null && Date.now() - started > timeout) {
      throw new Error(
        `Timed out waiting for transaction ${transactionHash} after ${timeout}ms`
      );
    }
    await delay(1000);
  }
}

export async function getFeeData(config: AlchemyConfig): Promise<FeeData> {
  const [block, gasPriceHex] = await Promise.all([
    getBlockByTag(config, 'latest', false),
    config.send('eth_gasPrice', [])
  ]);
  const gasPrice = hexToBigInt(gasPriceHex);
  let maxPriorityFeePerGas: bigint | null = null;
  let maxFeePerGas: bigint | null = null;
  try {
    maxPriorityFeePerGas = hexToBigInt(
      await config.send('eth_maxPriorityFeePerGas', [])
    );
    if (block.baseFeePerGas != null) {
      maxFeePerGas = block.baseFeePerGas * 2n + maxPriorityFeePerGas;
    }
  } catch {
    maxPriorityFeePerGas = null;
    maxFeePerGas = null;
  }
  return {
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    lastBaseFeePerGas: block.baseFeePerGas
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
