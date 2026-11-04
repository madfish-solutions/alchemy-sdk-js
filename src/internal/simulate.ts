import { AlchemyConfig } from '../api/alchemy-config.js';
import { toHex } from '../api/util.js';
import {
  DebugCallType,
  SimulateAssetType,
  SimulateChangeType
} from '../types/types.js';
import type {
  BlockIdentifier,
  DebugTransaction,
  SimulateAssetChangesChange,
  SimulateAssetChangesResponse,
  SimulateExecutionResponse,
  SimulationCallTrace,
  SimulationDebugLog
} from '../types/types.js';
import { toError } from './error.js';

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL_TOPIC =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const APPROVAL_FOR_ALL_TOPIC =
  '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';
const TRANSFER_SINGLE_TOPIC =
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const NATIVE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

interface SimulatedLog {
  address?: string;
  topics?: string[];
  data?: string;
}

interface SimulatedCallResult {
  returnData?: string;
  logs?: SimulatedLog[];
  gasUsed?: string;
  status?: string;
  error?: { message?: string };
}

interface SimulatedBlock {
  calls?: SimulatedCallResult[];
}

export interface SimulatedTransaction {
  assets: SimulateAssetChangesResponse;
  execution: SimulateExecutionResponse;
}

/**
 * Runs `eth_simulateV1` for one or more calls in a single simulated block.
 *
 * Ethereum, and the other EVM networks where Alchemy exposes the method, use
 * this RPC. Chains such as zkSync, Avalanche, Scroll, and Blast reject it.
 * Monad Testnet rejects `validation: false`, so that flag is dropped and the
 * call is sent once more.
 */
export async function simulateTransactions(
  config: AlchemyConfig,
  transactions: DebugTransaction[],
  blockIdentifier?: BlockIdentifier
): Promise<SimulatedTransaction[]> {
  const block = simulationBlock(blockIdentifier);
  const calls = transactions.map(toSimulateCall);
  const withValidation = {
    blockStateCalls: [{ calls }],
    validation: false,
    traceTransfers: true
  };
  let blocks: SimulatedBlock[];
  try {
    blocks = await config.send('eth_simulateV1', [withValidation, block]);
  } catch (error) {
    if (!rejectsValidationFlag(error)) {
      throw toError(error, 'eth_simulateV1 failed');
    }
    blocks = await config.send('eth_simulateV1', [
      {
        blockStateCalls: withValidation.blockStateCalls,
        traceTransfers: true
      },
      block
    ]);
  }
  const results = blocks?.[0]?.calls ?? [];
  return transactions.map((transaction, index) =>
    mapSimulatedCall(transaction, results[index])
  );
}

/** @internal Visible for tests. */
export function mapSimulatedCall(
  transaction: DebugTransaction,
  result: SimulatedCallResult | undefined
): SimulatedTransaction {
  const logs = result?.logs ?? [];
  const reverted = result?.status === '0x0' || result?.status === '0x';
  const errorMessage = reverted
    ? result?.error?.message || 'execution reverted'
    : undefined;
  return {
    assets: {
      changes: reverted ? [] : logs.flatMap(assetChangesFromLog),
      ...(result?.gasUsed != null ? { gasUsed: result.gasUsed } : {}),
      ...(errorMessage != null ? { error: { message: errorMessage } } : {})
    },
    execution: {
      calls: [executionCall(transaction, result, errorMessage)],
      logs: logs.map(mapLog)
    }
  };
}

function toSimulateCall(transaction: DebugTransaction): Record<string, string> {
  const call: Record<string, string> = {};
  if (transaction.from != null) {
    call.from = transaction.from;
  }
  if (transaction.to != null) {
    call.to = transaction.to;
  }
  if (transaction.gas != null) {
    call.gas = transaction.gas;
  }
  if (transaction.gasPrice != null) {
    call.gasPrice = transaction.gasPrice;
  }
  if (transaction.value != null) {
    call.value = transaction.value;
  }
  if (transaction.data != null) {
    call.data = transaction.data;
  }
  return call;
}

function simulationBlock(blockIdentifier?: BlockIdentifier): string {
  if (blockIdentifier == null) {
    return 'latest';
  }
  if (/^\d+$/.test(blockIdentifier)) {
    return toHex(Number(blockIdentifier));
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(blockIdentifier)) {
    throw new Error(
      'eth_simulateV1 accepts a block number or tag, not a block hash.'
    );
  }
  return blockIdentifier;
}

function executionCall(
  transaction: DebugTransaction,
  result: SimulatedCallResult | undefined,
  errorMessage: string | undefined
): SimulationCallTrace {
  return {
    type: DebugCallType.CALL,
    from: (transaction.from ?? '').toLowerCase(),
    to: (transaction.to ?? '').toLowerCase(),
    value: transaction.value ?? '0x0',
    gas: transaction.gas ?? '0x0',
    gasUsed: result?.gasUsed ?? '0x0',
    input: transaction.data ?? '0x',
    output: result?.returnData ?? '0x',
    ...(errorMessage != null ? { error: errorMessage } : {})
  };
}

function mapLog(log: SimulatedLog): SimulationDebugLog {
  return {
    address: (log.address ?? '').toLowerCase(),
    topics: log.topics ?? [],
    data: log.data ?? '0x'
  };
}

function assetChangesFromLog(log: SimulatedLog): SimulateAssetChangesChange[] {
  const topics = (log.topics ?? []).map(topic => topic.toLowerCase());
  const signature = topics[0];
  const address = (log.address ?? '').toLowerCase();
  const data = log.data ?? '0x';
  if (signature === TRANSFER_TOPIC && topics.length >= 3) {
    const from = addressFromTopic(topics[1]);
    const to = addressFromTopic(topics[2]);
    if (address === NATIVE_ADDRESS) {
      return [
        {
          assetType: SimulateAssetType.NATIVE,
          changeType: SimulateChangeType.TRANSFER,
          from,
          to,
          rawAmount: uintWord(data, 0)
        }
      ];
    }
    if (topics.length >= 4) {
      return [
        {
          assetType: SimulateAssetType.ERC721,
          changeType: SimulateChangeType.TRANSFER,
          from,
          to,
          contractAddress: address,
          tokenId: uintWord(topics[3], 0)
        }
      ];
    }
    return [
      {
        assetType: SimulateAssetType.ERC20,
        changeType: SimulateChangeType.TRANSFER,
        from,
        to,
        contractAddress: address,
        rawAmount: uintWord(data, 0)
      }
    ];
  }
  if (signature === TRANSFER_SINGLE_TOPIC && topics.length >= 4) {
    return [
      {
        assetType: SimulateAssetType.ERC1155,
        changeType: SimulateChangeType.TRANSFER,
        from: addressFromTopic(topics[2]),
        to: addressFromTopic(topics[3]),
        contractAddress: address,
        tokenId: uintWord(data, 0),
        rawAmount: uintWord(data, 1)
      }
    ];
  }
  if (signature === APPROVAL_TOPIC && topics.length >= 3) {
    return [
      {
        assetType: SimulateAssetType.ERC20,
        changeType: SimulateChangeType.APPROVE,
        from: addressFromTopic(topics[1]),
        to: addressFromTopic(topics[2]),
        contractAddress: address,
        rawAmount: uintWord(data, 0),
        decimals: 0
      }
    ];
  }
  if (signature === APPROVAL_FOR_ALL_TOPIC && topics.length >= 3) {
    return [
      {
        assetType: SimulateAssetType.ERC721,
        changeType: SimulateChangeType.APPROVE,
        from: addressFromTopic(topics[1]),
        to: addressFromTopic(topics[2]),
        contractAddress: address,
        decimals: 0
      }
    ];
  }
  return [];
}

function addressFromTopic(topic: string): string {
  return ('0x' + topic.slice(-40)).toLowerCase();
}

function uintWord(data: string, index: number): string {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  const word = hex.slice(index * 64, (index + 1) * 64);
  if (word.length === 0) {
    return '0';
  }
  return BigInt('0x' + word).toString(10);
}

function rejectsValidationFlag(error: unknown): boolean {
  const text = errorText(error);
  return text.includes('"validation": false') && /not supported/i.test(text);
}

function errorText(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (value == null || typeof value !== 'object' || seen.has(value)) {
      return;
    }
    seen.add(value);
    const record = value as {
      message?: unknown;
      details?: unknown;
      shortMessage?: unknown;
      cause?: unknown;
    };
    visit(record.message);
    visit(record.details);
    visit(record.shortMessage);
    visit(record.cause);
  };
  visit(error);
  return parts.join('\n');
}
