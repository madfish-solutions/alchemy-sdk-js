/**
 * Numeric values accepted anywhere the SDK previously took an ethers
 * `BigNumberish`.
 *
 * @public
 */
export type Quantity = string | number | bigint;

/**
 * A block number, block hash, or commitment tag such as `latest`.
 *
 * @public
 */
export type BlockTag = string | number;

/**
 * A listener invoked when a websocket subscription emits.
 *
 * @public
 */
export type Listener = (...args: any[]) => void;

/**
 * Network metadata returned by {@link CoreNamespace.getNetwork}.
 *
 * @public
 */
export interface NetworkInfo {
  /** Alchemy network slug, for example `eth-mainnet`. */
  name: string;
  /** EVM chain id. `0` when the slug is not in the Alchemy chain registry. */
  chainId: number;
}

/**
 * Recommended fee values for a transaction.
 *
 * @public
 */
export interface FeeData {
  gasPrice: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  lastBaseFeePerGas: bigint | null;
}

/**
 * A log emitted by a transaction.
 *
 * @public
 */
export interface Log {
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  removed: boolean;
  address: string;
  data: string;
  topics: string[];
  transactionHash: string;
  logIndex: number;
}

/**
 * Fields accepted by `eth_call` and `eth_estimateGas`.
 *
 * @public
 */
export interface TransactionRequest {
  to?: string;
  from?: string;
  nonce?: Quantity;
  gasLimit?: Quantity;
  gas?: Quantity;
  gasPrice?: Quantity;
  data?: string;
  input?: string;
  value?: Quantity;
  chainId?: Quantity;
  type?: Quantity;
  accessList?: Array<{ address: string; storageKeys: string[] }>;
  maxFeePerGas?: Quantity;
  maxPriorityFeePerGas?: Quantity;
}

/**
 * A mined or pending transaction.
 *
 * @public
 */
export interface TransactionResponse {
  hash: string;
  type?: number;
  blockHash: string | null;
  blockNumber: number | null;
  transactionIndex: number | null;
  confirmations: number;
  from: string;
  to: string | null;
  nonce: number;
  gasLimit: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  data: string;
  value: bigint;
  chainId: number;
  r?: string;
  s?: string;
  v?: number;
  wait: (confirmations?: number) => Promise<TransactionReceipt | null>;
}

/**
 * A transaction receipt.
 *
 * @public
 */
export interface TransactionReceipt {
  to: string | null;
  from: string;
  contractAddress: string | null;
  transactionIndex: number;
  gasUsed: bigint;
  logsBloom: string;
  blockHash: string;
  transactionHash: string;
  logs: Log[];
  blockNumber: number;
  confirmations: number;
  cumulativeGasUsed: bigint;
  effectiveGasPrice?: bigint;
  status?: number;
  type?: number;
}

/**
 * A block whose transactions are hashes.
 *
 * @public
 */
export interface Block {
  hash: string | null;
  parentHash: string;
  number: number | null;
  timestamp: number;
  nonce: string | null;
  difficulty: bigint;
  gasLimit: bigint;
  gasUsed: bigint;
  miner: string;
  extraData: string;
  baseFeePerGas: bigint | null;
  transactions: string[];
}

/**
 * A block whose transactions are full transaction objects.
 *
 * @public
 */
export interface BlockWithTransactions extends Omit<Block, 'transactions'> {
  transactions: TransactionResponse[];
}
