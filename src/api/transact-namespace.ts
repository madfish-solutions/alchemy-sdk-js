import {
  getTransactionByHash,
  toRpcTransaction,
  waitForTransaction
} from '../internal/eth-rpc.js';
import { simulateTransactions } from '../internal/simulate.js';
import type {
  TransactionReceipt,
  TransactionRequest,
  TransactionResponse
} from '../types/eth.js';
import {
  BlockIdentifier,
  DebugTransaction,
  GasOptimizedTransactionResponse,
  GasOptimizedTransactionStatusResponse,
  SendPrivateTransactionOptions,
  SimulateAssetChangesResponse,
  SimulateExecutionResponse
} from '../types/types.js';
import { AlchemyConfig } from './alchemy-config.js';
import { fromHex, toHex } from './util.js';

/**
 * Multiples to increment fee per gas when using
 * {@link generateGasSpreadTransactions}.
 *
 * @internal
 */
export const GAS_OPTIMIZED_TX_FEE_MULTIPLES = [0.9, 1, 1.1, 1.2, 1.3];

/**
 * The Transact namespace contains methods used for sending transactions and
 * checking on the state of submitted transactions.
 *
 * Do not call this constructor directly. Instead, instantiate an Alchemy object
 * with `const alchemy = new Alchemy(config)` and then access the transact
 * namespace via `alchemy.transact`.
 */
export class TransactNamespace {
  /** @internal */
  constructor(private readonly config: AlchemyConfig) {}

  /**
   * Sends a single transaction to Flashbots. Flashbots will attempt to send the
   * transaction to miners for the next 25 blocks.
   *
   * Returns the transaction hash of the submitted transaction.
   *
   * @param signedTransaction The raw, signed transaction.
   * @param maxBlockNumber Optional highest block number in which the
   *   transaction should be included.
   * @param options Options to configure the request.
   */
  async sendPrivateTransaction(
    signedTransaction: string,
    maxBlockNumber?: number,
    options?: SendPrivateTransactionOptions
  ): Promise<string> {
    const hexBlockNumber = maxBlockNumber ? toHex(maxBlockNumber) : undefined;
    return this.config.send('eth_sendPrivateTransaction', [
      {
        tx: signedTransaction,
        maxBlockNumber: hexBlockNumber,
        preferences: options
      }
    ]);
  }

  /**
   * Stops the provided private transaction from being submitted for future
   * blocks. A transaction can only be cancelled if the request is signed by the
   * same key as the {@link sendPrivateTransaction} call submitting the
   * transaction in first place.
   *
   * Returns a boolean indicating whether the cancellation was successful.
   *
   * @param transactionHash Transaction hash of private tx to be cancelled
   */
  async cancelPrivateTransaction(transactionHash: string): Promise<boolean> {
    return this.config.send('eth_cancelPrivateTransaction', [
      {
        txHash: transactionHash
      }
    ]);
  }

  /**
   * Simulates the asset changes from a list of calls in one block.
   *
   * Calls `eth_simulateV1` with `traceTransfers` enabled. Transfers and
   * approvals are read from the logs. Token names, symbols, and logos are not
   * part of that response.
   *
   * @param transactions Calls to simulate in order.
   * @param blockIdentifier Block number or tag. Defaults to `latest`.
   */
  async simulateAssetChangesBundle(
    transactions: DebugTransaction[],
    blockIdentifier?: BlockIdentifier
  ): Promise<SimulateAssetChangesResponse[]> {
    const results = await simulateTransactions(
      this.config,
      transactions,
      blockIdentifier
    );
    return results.map(result => result.assets);
  }

  /**
   * Simulates the asset changes from a single call.
   *
   * Calls `eth_simulateV1` with `traceTransfers` enabled. Transfers and
   * approvals are read from the logs. Token names, symbols, and logos are not
   * part of that response.
   *
   * @param transaction The call to simulate.
   * @param blockIdentifier Block number or tag. Defaults to `latest`.
   */
  async simulateAssetChanges(
    transaction: DebugTransaction,
    blockIdentifier?: BlockIdentifier
  ): Promise<SimulateAssetChangesResponse> {
    const [result] = await simulateTransactions(
      this.config,
      [transaction],
      blockIdentifier
    );
    return result?.assets ?? { changes: [] };
  }

  /**
   * Simulates a list of calls in order and returns the top-level call and logs
   * for each one.
   *
   * `eth_simulateV1` does not return an internal call trace or ABI-decoded
   * inputs.
   *
   * @param transactions Calls to simulate in order.
   * @param blockIdentifier Block number or tag. Defaults to `latest`.
   */
  async simulateExecutionBundle(
    transactions: DebugTransaction[],
    blockIdentifier?: BlockIdentifier
  ): Promise<SimulateExecutionResponse[]> {
    const results = await simulateTransactions(
      this.config,
      transactions,
      blockIdentifier
    );
    return results.map(result => result.execution);
  }

  /**
   * Simulates a single call and returns its top-level result and logs.
   *
   * `eth_simulateV1` does not return an internal call trace or ABI-decoded
   * inputs.
   *
   * @param transaction The call to simulate.
   * @param blockIdentifier Block number or tag. Defaults to `latest`.
   */
  async simulateExecution(
    transaction: DebugTransaction,
    blockIdentifier?: BlockIdentifier
  ): Promise<SimulateExecutionResponse> {
    const [result] = await simulateTransactions(
      this.config,
      [transaction],
      blockIdentifier
    );
    return result?.execution ?? { calls: [], logs: [] };
  }

  /**
   * Returns the transaction with hash or null if the transaction is unknown.
   *
   * @param transactionHash The hash of the transaction to get.
   * @public
   */
  async getTransaction(
    transactionHash: string
  ): Promise<TransactionResponse | null> {
    return getTransactionByHash(this.config, transactionHash);
  }

  /**
   * Submits a signed transaction to the network.
   *
   * @param signedTransaction The signed transaction to send.
   * @public
   */
  async sendTransaction(
    signedTransaction: string
  ): Promise<TransactionResponse> {
    const hash: string = await this.config.send('eth_sendRawTransaction', [
      signedTransaction
    ]);
    const tx = await this.getTransaction(hash);
    if (tx) {
      return tx;
    }
    return {
      hash,
      blockHash: null,
      blockNumber: null,
      transactionIndex: null,
      confirmations: 0,
      from: '',
      to: null,
      nonce: 0,
      gasLimit: 0n,
      data: '0x',
      value: 0n,
      chainId: this.config.getNetworkInfo().chainId,
      wait: confirmations =>
        waitForTransaction(this.config, hash, confirmations)
    };
  }

  /**
   * Returns an estimate of the gas required to submit `transaction`.
   *
   * @param transaction The transaction to estimate gas for.
   * @public
   */
  async estimateGas(transaction: TransactionRequest): Promise<bigint> {
    const gas: string = await this.config.send('eth_estimateGas', [
      toRpcTransaction(transaction)
    ]);
    return BigInt(gas);
  }

  /**
   * Returns a fee per gas (in wei) that is an estimate of how much you can pay
   * as a priority fee, or "tip", to get a transaction included in the current block.
   *
   * @public
   */
  async getMaxPriorityFeePerGas(): Promise<number> {
    const feeHex = await this.config.send('eth_maxPriorityFeePerGas', []);
    return fromHex(feeHex);
  }

  /**
   * Resolves when `transactionHash` is mined.
   *
   * @param transactionHash The hash of the transaction to wait for.
   * @param confirmations The number of blocks to wait for.
   * @param timeout The maximum time to wait for the transaction to confirm.
   * @public
   */
  async waitForTransaction(
    transactionHash: string,
    confirmations?: number,
    timeout?: number
  ): Promise<TransactionReceipt | null> {
    return waitForTransaction(
      this.config,
      transactionHash,
      confirmations,
      timeout
    );
  }

  /**
   * Submits a list of signed replacement transactions so Alchemy can include the
   * cheapest one that gets mined.
   *
   * @param signedTransactions Signed transactions that differ only in gas fees.
   * @internal
   */
  async sendGasOptimizedTransaction(
    signedTransactions: string[]
  ): Promise<GasOptimizedTransactionResponse> {
    return this.config.send('alchemy_sendGasOptimizedTransaction', [
      {
        rawTransactions: signedTransactions
      }
    ]);
  }

  /**
   * Returns the state of the transaction job returned by
   * {@link sendGasOptimizedTransaction}.
   *
   * @param trackingId The tracking id from the response of the sent gas optimized transaction.
   * @internal
   */
  async getGasOptimizedTransactionStatus(
    trackingId: string
  ): Promise<GasOptimizedTransactionStatusResponse> {
    return this.config.send('alchemy_getGasOptimizedTransactionStatus', [
      trackingId
    ]);
  }
}

/**
 * Builds raw transactions across a spread of priority fees.
 *
 * Signing is left to the caller. This SDK no longer ships an ethers `Wallet`.
 *
 * @internal
 */
export function generateGasSpreadTransactions(
  transaction: TransactionRequest,
  gasLimit: number,
  baseFee: number,
  priorityFee: number
): TransactionRequest[] {
  return GAS_OPTIMIZED_TX_FEE_MULTIPLES.map(feeMultiplier => {
    return {
      ...transaction,
      gasLimit,
      maxFeePerGas: Math.round(
        baseFee * feeMultiplier + priorityFee * feeMultiplier
      ),
      maxPriorityFeePerGas: Math.round(feeMultiplier * priorityFee)
    };
  });
}
