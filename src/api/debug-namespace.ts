import {
  BlockIdentifier,
  DebugCallTrace,
  DebugCallTracer,
  DebugPrestateTrace,
  DebugPrestateTracer,
  DebugTransaction
} from '../types/types.js';
import { AlchemyConfig } from './alchemy-config.js';
import { isHexString, toHex } from './util.js';

/**
 * The Debug namespace contains methods to access the non-standard RPC methods
 * for inspecting and debugging transactions.
 *
 * Do not call this constructor directly. Instead, instantiate an Alchemy object
 * with `const alchemy = new Alchemy(config)` and then access the debug namespace
 * via `alchemy.debug`.
 */
export class DebugNamespace {
  /** @internal */
  constructor(private readonly config: AlchemyConfig) {}

  /**
   * Runs an `eth_call` with the context of the provided block execution using the
   * final state of the parent block as the base.
   */
  traceCall(
    transaction: DebugTransaction,
    blockIdentifier: BlockIdentifier,
    tracer: DebugCallTracer
  ): Promise<DebugCallTrace>;
  traceCall(
    transaction: DebugTransaction,
    blockIdentifier: BlockIdentifier,
    tracer: DebugPrestateTracer
  ): Promise<DebugPrestateTrace>;
  async traceCall(
    transaction: DebugTransaction,
    blockIdentifier: BlockIdentifier,
    tracer: DebugCallTracer | DebugPrestateTracer
  ): Promise<DebugCallTrace | DebugPrestateTrace> {
    return this.config.send('debug_traceCall', [
      transaction,
      blockIdentifier,
      parseTracerParams(tracer)
    ]);
  }

  /**
   * Replays a mined transaction.
   *
   * @param timeout A duration string such as `300ms` or `2s45ms`. Max timeout is `10s`.
   */
  async traceTransaction(
    transactionHash: string,
    tracer: DebugCallTracer,
    timeout?: string
  ): Promise<DebugCallTrace>;
  async traceTransaction(
    transactionHash: string,
    tracer: DebugPrestateTracer,
    timeout?: string
  ): Promise<DebugPrestateTrace>;
  async traceTransaction(
    transactionHash: string,
    tracer: DebugCallTracer | DebugPrestateTracer,
    timeout?: string
  ): Promise<DebugCallTrace | DebugPrestateTrace> {
    return this.config.send('debug_traceTransaction', [
      transactionHash,
      parseTracerParams(tracer, timeout)
    ]);
  }

  /**
   * Replays a block that has already been mined.
   */
  traceBlock(
    blockIdentifier: BlockIdentifier | number,
    tracer: DebugCallTracer
  ): Promise<DebugCallTrace>;
  traceBlock(
    blockIdentifier: BlockIdentifier | number,
    tracer: DebugPrestateTracer
  ): Promise<DebugPrestateTrace>;
  async traceBlock(
    blockIdentifier: BlockIdentifier | number,
    tracer: DebugCallTracer | DebugPrestateTracer
  ): Promise<DebugCallTrace | DebugPrestateTrace> {
    let method: string;
    let params: [string, RawTracer];
    if (isHexString(blockIdentifier, 32)) {
      method = 'debug_traceBlockByHash';
      params = [blockIdentifier, parseTracerParams(tracer)];
    } else {
      method = 'debug_traceBlockByNumber';
      const block =
        typeof blockIdentifier === 'number'
          ? toHex(blockIdentifier)
          : blockIdentifier;
      params = [block, parseTracerParams(tracer)];
    }
    return this.config.send(method, params);
  }
}

interface RawTracer {
  tracer: string;
  tracerConfig?: {
    onlyTopCall?: boolean;
    timeout?: string;
  };
}

function parseTracerParams(
  tracer: DebugCallTracer | DebugPrestateTracer,
  timeout?: string
): RawTracer {
  return {
    tracer: tracer.type,
    ...(tracer.onlyTopCall !== undefined && {
      tracerConfig: {
        onlyTopCall: tracer.onlyTopCall,
        timeout
      }
    })
  };
}
