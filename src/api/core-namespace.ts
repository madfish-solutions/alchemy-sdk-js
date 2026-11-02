import {
  getAssetTransfers,
  getLogs,
  getTransactionReceipts
} from '../internal/core-api.js';
import {
  formatBlockTag,
  getBlockByTag,
  getFeeData,
  getTransactionByHash,
  getTransactionReceiptByHash,
  toRpcTransaction,
  waitForTransaction
} from '../internal/eth-rpc.js';
import type {
  Block,
  BlockTag,
  BlockWithTransactions,
  FeeData,
  Log,
  NetworkInfo,
  Quantity,
  TransactionReceipt,
  TransactionRequest,
  TransactionResponse
} from '../types/eth.js';
import {
  AssetTransfersParams,
  AssetTransfersResponse,
  AssetTransfersWithMetadataParams,
  AssetTransfersWithMetadataResponse,
  DeployResult,
  Filter,
  FilterByBlockHash,
  GetTokensForOwnerOptions,
  GetTokensForOwnerResponse,
  OwnedToken,
  TokenBalanceType,
  TokenBalancesOptionsDefaultTokens,
  TokenBalancesOptionsErc20,
  TokenBalancesResponse,
  TokenBalancesResponseErc20,
  TokenMetadataResponse,
  TransactionReceiptsParams,
  TransactionReceiptsResponse
} from '../types/types.js';
import { ETH_NULL_VALUE } from '../util/const.js';
import { nullsToUndefined } from '../util/util.js';
import { AlchemyConfig } from './alchemy-config.js';
import { formatUnits, quantityToHex, toDecimalString, toHex } from './util.js';

/**
 * The core namespace contains the commonly used Ethereum JSON-RPC methods and
 * Alchemy's Enhanced APIs.
 *
 * Do not call this constructor directly. Instead, instantiate an Alchemy object
 * with `const alchemy = new Alchemy(config)` and then access the core namespace
 * via `alchemy.core`.
 */
export class CoreNamespace {
  /** @internal */
  constructor(private readonly config: AlchemyConfig) {}

  /**
   * Returns the balance of a given address as of the provided block.
   *
   * @param addressOrName The address or ENS name of the account.
   * @param blockTag The optional block number or hash. Defaults to `latest`.
   * @public
   */
  async getBalance(
    addressOrName: string,
    blockTag?: BlockTag
  ): Promise<bigint> {
    const address = await this.config.resolveAddress(addressOrName);
    const tag = blockTag == null ? 'latest' : formatBlockTag(blockTag);
    const balance: string = await this.config.send('eth_getBalance', [
      address,
      tag
    ]);
    return BigInt(balance);
  }

  /**
   * Checks if the provided address is a smart contract.
   *
   * @param address The address to check type for.
   * @public
   */
  async isContractAddress(address: string): Promise<boolean> {
    const code = await this.getCode(address);
    return code !== ETH_NULL_VALUE && code !== '0x0';
  }

  /**
   * Returns the contract code of the provided address at the block. If there is
   * no contract deployed, the result is `0x`.
   *
   * @param addressOrName The address or ENS name of the account.
   * @param blockTag The optional block number or hash. Defaults to `latest`.
   * @public
   */
  async getCode(addressOrName: string, blockTag?: BlockTag): Promise<string> {
    const address = await this.config.resolveAddress(addressOrName);
    const tag = blockTag == null ? 'latest' : formatBlockTag(blockTag);
    return this.config.send('eth_getCode', [address, tag]);
  }

  /**
   * Returns the value of the storage slot at `position` for `addressOrName`.
   *
   * @param addressOrName The address or ENS name of the account.
   * @param position The storage slot.
   * @param blockTag The optional block number or hash. Defaults to `latest`.
   * @public
   */
  async getStorageAt(
    addressOrName: string,
    position: Quantity,
    blockTag?: BlockTag
  ): Promise<string> {
    const address = await this.config.resolveAddress(addressOrName);
    const tag = blockTag == null ? 'latest' : formatBlockTag(blockTag);
    return this.config.send('eth_getStorageAt', [
      address,
      toHexQuantity(position),
      tag
    ]);
  }

  /**
   * Returns the number of transactions sent from the address, which is the
   * nonce of the next transaction.
   *
   * @param addressOrName The address or ENS name of the account.
   * @param blockTag The optional block number or hash.
   * @public
   */
  async getTransactionCount(
    addressOrName: string,
    blockTag?: BlockTag
  ): Promise<number> {
    const address = await this.config.resolveAddress(addressOrName);
    const tag = blockTag == null ? 'latest' : formatBlockTag(blockTag);
    const count: string = await this.config.send('eth_getTransactionCount', [
      address,
      tag
    ]);
    return Number(BigInt(count));
  }

  /**
   * Returns the block for the provided number, hash, or tag. Transactions are
   * hashes. Use {@link getBlockWithTransactions} for full transaction objects.
   *
   * @param blockHashOrBlockTag The block number, hash, or tag.
   * @public
   */
  async getBlock(blockHashOrBlockTag: BlockTag | string): Promise<Block> {
    return getBlockByTag(
      this.config,
      blockHashOrBlockTag,
      false
    ) as Promise<Block>;
  }

  /**
   * Returns the block for the provided number, hash, or tag, including full
   * transaction objects.
   *
   * @param blockHashOrBlockTag The block number, hash, or tag.
   * @public
   */
  async getBlockWithTransactions(
    blockHashOrBlockTag: BlockTag | string
  ): Promise<BlockWithTransactions> {
    return getBlockByTag(
      this.config,
      blockHashOrBlockTag,
      true
    ) as Promise<BlockWithTransactions>;
  }

  /**
   * Returns the network this client is connected to.
   *
   * @public
   */
  async getNetwork(): Promise<NetworkInfo> {
    return this.config.getNetworkInfo();
  }

  /**
   * Returns the block number of the most recently mined block.
   *
   * @public
   */
  async getBlockNumber(): Promise<number> {
    const hex: string = await this.config.send('eth_blockNumber', []);
    return Number(BigInt(hex));
  }

  /**
   * Returns the best guess of the current gas price to use in a transaction.
   *
   * @public
   */
  async getGasPrice(): Promise<bigint> {
    const hex: string = await this.config.send('eth_gasPrice', []);
    return BigInt(hex);
  }

  /**
   * Returns the recommended fee data to use in a transaction.
   *
   * For an EIP-1559 transaction, `maxFeePerGas` and `maxPriorityFeePerGas`
   * should be used. For legacy transactions, `gasPrice` should be used.
   *
   * @public
   */
  async getFeeData(): Promise<FeeData> {
    return getFeeData(this.config);
  }

  /**
   * Resolves once the client can reach the network.
   *
   * @public
   */
  async ready(): Promise<NetworkInfo> {
    await this.getBlockNumber();
    return this.getNetwork();
  }

  /**
   * Executes a call without creating a transaction.
   *
   * @param transaction The call to execute.
   * @param blockTag The optional block number or hash.
   * @public
   */
  async call(
    transaction: TransactionRequest,
    blockTag?: BlockTag
  ): Promise<string> {
    const tag = blockTag == null ? 'latest' : formatBlockTag(blockTag);
    return this.config.send('eth_call', [toRpcTransaction(transaction), tag]);
  }

  /**
   * Estimates the gas required to submit `transaction`.
   *
   * This is an alias for {@link TransactNamespace.estimateGas}.
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
   * Returns the transaction with `transactionHash`, or null if it is unknown.
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
   * Returns the transaction receipt, or null if the transaction has not been mined.
   *
   * @param transactionHash The hash of the transaction to get.
   * @public
   */
  async getTransactionReceipt(
    transactionHash: string
  ): Promise<TransactionReceipt | null> {
    return getTransactionReceiptByHash(this.config, transactionHash);
  }

  /**
   * Submits a signed transaction.
   *
   * @param signedTransaction The signed transaction hex.
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
   * Resolves when `transactionHash` has `confirmations` blocks mined on top of
   * it. `confirmations` of 0 returns the receipt immediately, or null if the
   * transaction is not yet mined.
   *
   * @param transactionHash The hash of the transaction to wait for.
   * @param confirmations The number of blocks to wait for. Defaults to 1.
   * @param timeout The maximum time to wait, in milliseconds.
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
   * Returns logs that match the provided filter.
   *
   * @param filter The filter object to use.
   * @public
   */
  async getLogs(filter: Filter | FilterByBlockHash): Promise<Array<Log>> {
    return getLogs(this.config, filter);
  }

  /**
   * Sends a raw JSON-RPC request.
   *
   * @param method The method to call.
   * @param params The parameters to pass to the method.
   * @public
   */
  async send(method: string, params: Array<any>): Promise<any> {
    return this.config.send(method, params);
  }

  /**
   * Finds the address that deployed the provided contract and the block number
   * it was deployed in.
   *
   * This method binary-searches blocks since genesis and can take a long time.
   *
   * @param contractAddress - The contract address to find the deployer for.
   * @beta
   */
  async findContractDeployer(contractAddress: string): Promise<DeployResult> {
    const currentBlockNum = await this.getBlockNumber();
    if (
      (await this.getCode(contractAddress, currentBlockNum)) === ETH_NULL_VALUE
    ) {
      throw new Error(`Contract '${contractAddress}' does not exist`);
    }

    const firstBlock = await binarySearchFirstBlock(
      0,
      currentBlockNum + 1,
      contractAddress,
      this
    );

    const txReceipts = await getTransactionReceipts(
      this.config,
      {
        blockNumber: toHex(firstBlock)
      },
      'findContractDeployer'
    );
    const matchingReceipt = txReceipts.receipts?.find(
      receipt =>
        receipt.contractAddress?.toLowerCase() === contractAddress.toLowerCase()
    );
    return {
      deployerAddress: matchingReceipt?.from,
      blockNumber: firstBlock
    };
  }

  /**
   * Returns the ERC-20 token balances for a specific owner address.
   *
   * @param addressOrName The owner address to get the token balances for.
   * @public
   */
  async getTokenBalances(
    addressOrName: string
  ): Promise<TokenBalancesResponseErc20>;

  /**
   * Returns the token balances for a specific owner address given a list of contracts.
   *
   * @param addressOrName The owner address to get the token balances for.
   * @param contractAddresses A list of contract addresses to check. If omitted,
   *   all ERC-20 tokens will be checked.
   * @public
   */
  async getTokenBalances(
    addressOrName: string,
    contractAddresses?: string[]
  ): Promise<TokenBalancesResponse>;

  /**
   * Returns the ERC-20 token balances for a specific owner.
   *
   * @param addressOrName The owner address to get the token balances for.
   * @param options Token type options set to ERC-20 with optional page key.
   * @public
   */
  async getTokenBalances(
    addressOrName: string,
    options: TokenBalancesOptionsErc20
  ): Promise<TokenBalancesResponseErc20>;

  /**
   * Returns the token balances for a specific owner, fetching from the top 100
   * tokens by 24 hour volume.
   *
   * @param addressOrName The owner address to get the token balances for.
   * @param options Token type options set to the default token list.
   * @public
   */
  async getTokenBalances(
    addressOrName: string,
    options: TokenBalancesOptionsDefaultTokens
  ): Promise<TokenBalancesResponse>;

  async getTokenBalances(
    addressOrName: string,
    contractAddressesOrOptions?:
      | string[]
      | TokenBalancesOptionsDefaultTokens
      | TokenBalancesOptionsErc20
  ) {
    const address = await this.config.resolveAddress(addressOrName);
    if (Array.isArray(contractAddressesOrOptions)) {
      if (contractAddressesOrOptions.length > 1500) {
        throw new Error(
          'You cannot pass in more than 1500 contract addresses to getTokenBalances()'
        );
      }
      if (contractAddressesOrOptions.length === 0) {
        throw new Error(
          'getTokenBalances() requires at least one contractAddress when using an array'
        );
      }
      return this.config.send('alchemy_getTokenBalances', [
        address,
        contractAddressesOrOptions
      ]);
    }
    const tokenType =
      contractAddressesOrOptions === undefined
        ? TokenBalanceType.ERC20
        : contractAddressesOrOptions.type;
    const params: Array<string | { pageKey: string }> = [address, tokenType];
    if (
      contractAddressesOrOptions?.type === TokenBalanceType.ERC20 &&
      contractAddressesOrOptions.pageKey
    ) {
      params.push({ pageKey: contractAddressesOrOptions.pageKey });
    }
    return this.config.send('alchemy_getTokenBalances', params);
  }

  /**
   * Returns the tokens that the specified address owns, along with the amount
   * of each token and the relevant metadata.
   *
   * @param addressOrName The owner address to get the tokens with balances for.
   * @param options Additional options to pass to the request.
   * @public
   */
  async getTokensForOwner(
    addressOrName: string,
    options?: GetTokensForOwnerOptions
  ): Promise<GetTokensForOwnerResponse> {
    const address = await this.config.resolveAddress(addressOrName);
    const params: any[] = [
      address,
      options?.contractAddresses ?? TokenBalanceType.ERC20
    ];
    if (options?.pageKey) {
      params.push({ pageKey: options.pageKey });
    }
    const response = (await this.config.send(
      'alchemy_getTokenBalances',
      params
    )) as TokenBalancesResponseErc20;

    const formattedBalances = response.tokenBalances.map(balance => ({
      contractAddress: balance.contractAddress,
      rawBalance:
        balance.tokenBalance == null
          ? undefined
          : toDecimalString(balance.tokenBalance)
    }));

    const metadataPromises = await Promise.allSettled(
      response.tokenBalances.map(token =>
        this.config.send('alchemy_getTokenMetadata', [token.contractAddress])
      )
    );
    const metadata: TokenMetadataResponse[] = metadataPromises.map(p =>
      p.status === 'fulfilled'
        ? p.value
        : {
            name: null,
            symbol: null,
            decimals: null,
            logo: null
          }
    );
    const ownedTokens = formattedBalances.map((balance, index) => ({
      ...balance,
      ...metadata[index],
      balance:
        metadata[index].decimals !== null && balance.rawBalance != null
          ? formatUnits(balance.rawBalance, metadata[index].decimals!)
          : undefined
    }));

    return {
      tokens: ownedTokens.map(t => nullsToUndefined<OwnedToken>(t)),
      pageKey: response.pageKey
    };
  }

  /**
   * Returns metadata for a given token contract address.
   *
   * @param address The contract address to get metadata for.
   * @public
   */
  async getTokenMetadata(address: string): Promise<TokenMetadataResponse> {
    return this.config.send('alchemy_getTokenMetadata', [address]);
  }

  /**
   * Get transactions for specific addresses.
   *
   * @param params An object containing fields for the asset transfer query
   * @public
   */
  async getAssetTransfers(
    params: AssetTransfersWithMetadataParams
  ): Promise<AssetTransfersWithMetadataResponse>;
  async getAssetTransfers(
    params: AssetTransfersParams
  ): Promise<AssetTransfersResponse>;
  async getAssetTransfers(
    params: AssetTransfersWithMetadataParams | AssetTransfersParams
  ): Promise<AssetTransfersResponse | AssetTransfersWithMetadataResponse> {
    return getAssetTransfers(this.config, params);
  }

  /**
   * Gets all transaction receipts for a given block by number or block hash.
   *
   * @param params An object containing fields for the transaction receipt query.
   * @public
   */
  async getTransactionReceipts(
    params: TransactionReceiptsParams
  ): Promise<TransactionReceiptsResponse> {
    return getTransactionReceipts(this.config, params);
  }

  /**
   * Returns the owner address for an ENS name, or `null` if it does not resolve.
   *
   * @param name The ENS name to resolve.
   */
  async resolveName(name: string): Promise<string | null> {
    return this.config.resolveName(name);
  }

  /**
   * Reverse-resolves an address to an ENS name. Returns null when no reverse
   * record is set or the forward lookup does not match.
   *
   * @param address The address to look up.
   */
  async lookupAddress(address: string): Promise<string | null> {
    return this.config.lookupAddress(address);
  }
}

async function binarySearchFirstBlock(
  start: number,
  end: number,
  address: string,
  core: CoreNamespace
): Promise<number> {
  if (start >= end) {
    return end;
  }

  const mid = Math.floor((start + end) / 2);
  const code = await core.getCode(address, mid);
  if (code === ETH_NULL_VALUE || code === '0x0') {
    return binarySearchFirstBlock(mid + 1, end, address, core);
  }
  return binarySearchFirstBlock(start, mid, address, core);
}

function toHexQuantity(position: Quantity): string {
  return quantityToHex(position) ?? '0x0';
}
