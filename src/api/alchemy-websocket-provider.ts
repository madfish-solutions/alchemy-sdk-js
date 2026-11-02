import { fromHex } from '../api/util.js';
import {
  ALCHEMY_EVENT_TYPES,
  ALCHEMY_MINED_TRANSACTIONS_EVENT_TYPE,
  ALCHEMY_PENDING_TRANSACTIONS_EVENT_TYPE
} from '../internal/internal-types.js';
import { jsonRpcWsUrl } from '../internal/network.js';
import {
  ReconnectingWebSocket,
  defaultWebSocketConstructor
} from '../internal/reconnecting-websocket.js';
import {
  SubscriptionEvent,
  getEventTag,
  isAlchemyEvent,
  verifyAlchemyEventName
} from '../internal/subscription-event.js';
import {
  LogsEvent,
  LogsSubscriptionFilter,
  NewHeadsEvent,
  WebsocketBackfiller,
  dedupeLogs,
  dedupeNewHeads,
  throwIfCancelled
} from '../internal/websocket-backfiller.js';
import type { Listener } from '../types/eth.js';
import type { AlchemyEventType, Filter } from '../types/types.js';
import { AlchemySubscription } from '../types/types.js';
import { DEFAULT_ALCHEMY_API_KEY, noop } from '../util/const.js';
import { VERSION } from '../version.js';
import type { AlchemyConfig } from './alchemy-config.js';

const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_WAIT_TIME = 10000;
const BACKFILL_TIMEOUT = 60000;
const BACKFILL_RETRIES = 5;
const RETAINED_EVENT_BLOCK_COUNT = 10;
const MIN_RETRY_DELAY = 1000;
const RETRY_BACKOFF_FACTOR = 2;
const MAX_RETRY_DELAY = 30000;

interface ProviderConfig {
  apiKey?: string;
  network?: string;
  url?: string;
}

/**
 * WebSocket subscriptions with reconnect and log/block backfill.
 *
 * This class does not extend an ethers provider. Subscriptions are emitted
 * directly to listeners registered with {@link on}.
 */
export class AlchemyWebSocketProvider {
  readonly apiKey: string;
  /** @internal */
  readonly _websocket: ReconnectingWebSocket;
  /** @internal */
  _events: SubscriptionEvent[] = [];

  private readonly virtualSubscriptionsById = new Map<
    string,
    VirtualSubscription
  >();
  private readonly virtualIdsByPhysicalId = new Map<string, string>();
  private readonly backfiller: WebsocketBackfiller;
  private readonly pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private readonly _subIds: Record<string, Promise<string>> = {};
  private nextId = 0;
  private heartbeatIntervalId?: ReturnType<typeof setInterval>;
  private cancelBackfill: () => void = noop;

  /** @internal */
  constructor(config: AlchemyConfig | ProviderConfig, wsConstructor?: any) {
    this.apiKey = config.apiKey || DEFAULT_ALCHEMY_API_KEY;
    const network = config.network || 'eth-mainnet';
    const url = jsonRpcWsUrl(network, this.apiKey, config.url);
    const protocol = `alchemy-sdk-${VERSION}`;
    const SocketCtor = wsConstructor ?? defaultWebSocketConstructor();
    this._websocket = new ReconnectingWebSocket(url, protocol, SocketCtor);
    this.backfiller = new WebsocketBackfiller(this);
    this.addSocketListeners();
    this.startHeartbeat();
  }

  on(eventName: AlchemyEventType, listener: Listener): this {
    return this._addEventListener(eventName, listener, false);
  }

  once(eventName: AlchemyEventType, listener: Listener): this {
    return this._addEventListener(eventName, listener, true);
  }

  off(eventName: AlchemyEventType, listener?: Listener): this {
    if (listener == null) {
      return this.removeAllListeners(eventName);
    }
    const stopped: SubscriptionEvent[] = [];
    let found = false;
    const eventTag = getEventTag(eventName);
    this._events = this._events.filter(event => {
      if (event.tag !== eventTag || event.listener !== listener) {
        return true;
      }
      if (found) {
        return true;
      }
      found = true;
      stopped.push(event);
      return false;
    });
    stopped.forEach(event => this._stopEvent(event));
    return this;
  }

  removeAllListeners(eventName?: AlchemyEventType): this {
    let stopped: SubscriptionEvent[] = [];
    if (eventName == null) {
      stopped = this._events;
      this._events = [];
    } else {
      const eventTag = getEventTag(eventName);
      this._events = this._events.filter(event => {
        if (event.tag !== eventTag) {
          return true;
        }
        stopped.push(event);
        return false;
      });
    }
    stopped.forEach(event => this._stopEvent(event));
    return this;
  }

  listenerCount(eventName?: AlchemyEventType): number {
    if (!eventName) {
      return this._events.length;
    }
    const eventTag = getEventTag(eventName);
    return this._events.filter(event => event.tag === eventTag).length;
  }

  listeners(eventName?: AlchemyEventType): Listener[] {
    if (eventName == null) {
      return this._events.map(event => event.listener);
    }
    const eventTag = getEventTag(eventName);
    return this._events
      .filter(event => event.tag === eventTag)
      .map(event => event.listener);
  }

  /**
   * Sends one JSON-RPC request over the socket.
   *
   * @internal
   */
  send(method: string, params: any[] = []): Promise<any> {
    const id = ++this.nextId;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this._websocket.send(payload);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** @internal */
  async sendBatch(
    parts: Array<{ method: string; params?: any[] }>
  ): Promise<any[]> {
    return Promise.all(parts.map(part => this.send(part.method, part.params)));
  }

  async getBlockNumber(): Promise<number> {
    const hex: string = await this.send('eth_blockNumber');
    return fromHex(hex);
  }

  destroy(): Promise<void> {
    this.removeSocketListeners();
    this.stopHeartbeatAndBackfill();
    this._websocket.close();
    return Promise.resolve();
  }

  isCommunityResource(): boolean {
    return this.apiKey === DEFAULT_ALCHEMY_API_KEY;
  }

  private readonly handleMessage = (event: { data?: string }): void => {
    const message = JSON.parse(event.data ?? '');
    if (message.id != null && message.method !== 'eth_subscription') {
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(
          new Error(message.error.message ?? JSON.stringify(message.error))
        );
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    if (!isSubscriptionEvent(message)) {
      return;
    }
    const physicalId = message.params.subscription;
    const virtualId = this.virtualIdsByPhysicalId.get(physicalId);
    if (!virtualId) {
      return;
    }
    const subscription = this.virtualSubscriptionsById.get(virtualId);
    if (!subscription || subscription.method !== 'eth_subscribe') {
      return;
    }
    const result = message.params.result;
    switch (subscription.params[0]) {
      case 'newHeads': {
        const heads = subscription as NewHeadsSubscription;
        if (heads.isBackfilling) {
          addToPastEventsBuffer(
            heads.backfillBuffer,
            result,
            getNewHeadsBlockNumber
          );
        } else {
          this.emitAndRememberEvent(virtualId, result, getNewHeadsBlockNumber);
        }
        break;
      }
      case 'logs': {
        const logs = subscription as LogsSubscription;
        if (logs.isBackfilling) {
          addToPastEventsBuffer(
            logs.backfillBuffer,
            result,
            getLogsBlockNumber
          );
        } else {
          this.emitAndRememberEvent(virtualId, result, getLogsBlockNumber);
        }
        break;
      }
      default:
        this.emitEvent(virtualId, result);
    }
  };

  private readonly handleReopen = (): void => {
    this.virtualIdsByPhysicalId.clear();
    const { cancel, isCancelled } = makeCancelToken();
    this.cancelBackfill = cancel;
    for (const subscription of this.virtualSubscriptionsById.values()) {
      void this.resubscribeAndBackfill(isCancelled, subscription).catch(
        error => {
          if (!isCancelled()) {
            console.error(
              `Error while backfilling "${subscription.params[0]}" subscription. Some events may be missing.`,
              error
            );
          }
        }
      );
    }
    this.startHeartbeat();
  };

  private readonly stopHeartbeatAndBackfill = (): void => {
    if (this.heartbeatIntervalId != null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = undefined;
    }
    this.cancelBackfill();
  };

  private _addEventListener(
    eventName: AlchemyEventType,
    listener: Listener,
    once: boolean
  ): this {
    if (isAlchemyEvent(eventName)) {
      verifyAlchemyEventName(eventName);
    }
    const event = new SubscriptionEvent(getEventTag(eventName), listener, once);
    this._events.push(event);
    this._startEvent(event);
    return this;
  }

  private _startEvent(event: SubscriptionEvent): void {
    if (event.type === ALCHEMY_PENDING_TRANSACTIONS_EVENT_TYPE) {
      void this._subscribe(
        event.tag,
        [
          AlchemySubscription.PENDING_TRANSACTIONS,
          {
            fromAddress: event.fromAddress,
            toAddress: event.toAddress,
            hashesOnly: event.hashesOnly
          }
        ],
        event
      );
    } else if (event.type === ALCHEMY_MINED_TRANSACTIONS_EVENT_TYPE) {
      void this._subscribe(
        event.tag,
        [
          AlchemySubscription.MINED_TRANSACTIONS,
          {
            addresses: event.addresses,
            includeRemoved: event.includeRemoved,
            hashesOnly: event.hashesOnly
          }
        ],
        event
      );
    } else if (event.type === 'block') {
      void this._subscribe('block', ['newHeads'], event);
    } else if (event.type === 'filter') {
      void this._subscribe(
        event.tag,
        ['logs', this._getFilter(event.filter)],
        event
      );
    }
  }

  /** @internal */
  private async _subscribe(
    tag: string,
    param: any[],
    event: SubscriptionEvent
  ): Promise<void> {
    let subIdPromise = this._subIds[tag];
    const startingBlockNumber = await this.getBlockNumber();
    if (subIdPromise == null) {
      subIdPromise = this.send('eth_subscribe', param);
      this._subIds[tag] = subIdPromise;
    }
    const subId = await subIdPromise;
    this.virtualSubscriptionsById.set(subId, {
      event,
      method: 'eth_subscribe',
      params: param,
      startingBlockNumber,
      virtualId: subId,
      physicalId: subId,
      sentEvents: [],
      isBackfilling: false,
      backfillBuffer: []
    });
    this.virtualIdsByPhysicalId.set(subId, subId);
  }

  private _stopEvent(event: SubscriptionEvent): void {
    const tag = event.tag;
    if (ALCHEMY_EVENT_TYPES.includes(event.type)) {
      if (
        this._events.filter(e => ALCHEMY_EVENT_TYPES.includes(e.type)).length
      ) {
        return;
      }
    } else if (this.listenerCount(event.event)) {
      return;
    }
    const subId = this._subIds[tag];
    if (!subId) {
      return;
    }
    delete this._subIds[tag];
    void subId.then(id => {
      this.virtualSubscriptionsById.delete(id);
      this.virtualIdsByPhysicalId.delete(id);
      void this.send('eth_unsubscribe', [id]);
    });
  }

  private emit(eventName: AlchemyEventType, ...args: any[]): boolean {
    let result = false;
    const stopped: SubscriptionEvent[] = [];
    const eventTag = getEventTag(eventName);
    this._events = this._events.filter(event => {
      if (event.tag !== eventTag) {
        return true;
      }
      setTimeout(() => {
        event.listener.apply(this, args);
      }, 0);
      result = true;
      if (event.once) {
        stopped.push(event);
        return false;
      }
      return true;
    });
    stopped.forEach(event => this._stopEvent(event));
    return result;
  }

  private addSocketListeners(): void {
    this._websocket.addEventListener('message', this.handleMessage);
    this._websocket.addEventListener('reopen', this.handleReopen);
    this._websocket.addEventListener('down', this.stopHeartbeatAndBackfill);
  }

  private removeSocketListeners(): void {
    this._websocket.removeEventListener('message', this.handleMessage);
    this._websocket.removeEventListener('reopen', this.handleReopen);
    this._websocket.removeEventListener('down', this.stopHeartbeatAndBackfill);
  }

  private async resubscribeAndBackfill(
    isCancelled: () => boolean,
    subscription: VirtualSubscription
  ): Promise<void> {
    const {
      virtualId,
      method,
      params,
      sentEvents,
      backfillBuffer,
      startingBlockNumber
    } = subscription;
    subscription.isBackfilling = true;
    backfillBuffer.length = 0;
    try {
      const physicalId = await this.send(method, params);
      throwIfCancelled(isCancelled);
      subscription.physicalId = physicalId;
      this.virtualIdsByPhysicalId.set(physicalId, virtualId);
      switch (params[0]) {
        case 'newHeads': {
          const backfillEvents = await withBackoffRetries(
            () =>
              withTimeout(
                this.backfiller.getNewHeadsBackfill(
                  isCancelled,
                  sentEvents,
                  startingBlockNumber
                ),
                BACKFILL_TIMEOUT
              ),
            BACKFILL_RETRIES,
            () => !isCancelled()
          );
          throwIfCancelled(isCancelled);
          const events = dedupeNewHeads([...backfillEvents, ...backfillBuffer]);
          events.forEach(event =>
            this.emitAndRememberEvent(virtualId, event, getNewHeadsBlockNumber)
          );
          break;
        }
        case 'logs': {
          const filter: LogsSubscriptionFilter = params[1] || {};
          const backfillEvents = await withBackoffRetries(
            () =>
              withTimeout(
                this.backfiller.getLogsBackfill(
                  isCancelled,
                  filter,
                  sentEvents,
                  startingBlockNumber
                ),
                BACKFILL_TIMEOUT
              ),
            BACKFILL_RETRIES,
            () => !isCancelled()
          );
          throwIfCancelled(isCancelled);
          const events = dedupeLogs([...backfillEvents, ...backfillBuffer]);
          events.forEach(event =>
            this.emitAndRememberEvent(virtualId, event, getLogsBlockNumber)
          );
          break;
        }
        default:
          break;
      }
    } finally {
      subscription.isBackfilling = false;
      backfillBuffer.length = 0;
    }
  }

  private emitAndRememberEvent<T>(
    virtualId: string,
    result: T,
    blockNumberOf: (result: T) => number
  ): void {
    this.rememberEvent(virtualId, result, blockNumberOf);
    this.emitEvent(virtualId, result);
  }

  private emitEvent<T>(virtualId: string, result: T): void {
    const subscription = this.virtualSubscriptionsById.get(virtualId);
    if (!subscription) {
      return;
    }
    this.emitGenericEvent(subscription, result);
  }

  private rememberEvent<T>(
    virtualId: string,
    result: T,
    blockNumberOf: (result: T) => number
  ): void {
    const subscription = this.virtualSubscriptionsById.get(virtualId);
    if (!subscription) {
      return;
    }
    addToPastEventsBuffer(
      subscription.sentEvents,
      { ...(result as object) } as T,
      blockNumberOf
    );
  }

  private emitGenericEvent(
    subscription: VirtualSubscription,
    result: any
  ): void {
    const event = subscription.event;
    switch (event.type) {
      case ALCHEMY_PENDING_TRANSACTIONS_EVENT_TYPE:
        this.emit(
          {
            method: AlchemySubscription.PENDING_TRANSACTIONS,
            fromAddress: event.fromAddress,
            toAddress: event.toAddress,
            hashesOnly: event.hashesOnly
          },
          result
        );
        return;
      case ALCHEMY_MINED_TRANSACTIONS_EVENT_TYPE:
        this.emit(
          {
            method: AlchemySubscription.MINED_TRANSACTIONS,
            addresses: event.addresses,
            includeRemoved: event.includeRemoved,
            hashesOnly: event.hashesOnly
          },
          result
        );
        return;
      case 'block':
        this.emit('block', fromHex(result.number));
        return;
      case 'filter':
        if (result.removed == null) {
          result.removed = false;
        }
        this.emit(event.filter, result);
        return;
      default:
        throw new Error('Invalid event type to emit');
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatIntervalId != null) {
      return;
    }
    const timer = setInterval(() => {
      void withTimeout(this.send('net_version'), HEARTBEAT_WAIT_TIME).catch(
        () => {
          this._websocket.reconnect();
        }
      );
    }, HEARTBEAT_INTERVAL);
    const unref = (timer as { unref?: () => void }).unref;
    if (unref) {
      unref.call(timer);
    }
    this.heartbeatIntervalId = timer;
  }

  private _getFilter(filter: Filter): {
    address?: string | string[];
    topics?: Array<string | Array<string> | null>;
  } {
    const result: {
      address?: string | string[];
      topics?: Array<string | Array<string> | null>;
    } = {};
    if (filter.address != null) {
      result.address = filter.address;
    }
    if (filter.topics != null) {
      result.topics = filter.topics;
    }
    return result;
  }
}

interface VirtualSubscription {
  event: SubscriptionEvent;
  virtualId: string;
  physicalId: string;
  method: string;
  params: any[];
  isBackfilling: boolean;
  startingBlockNumber: number;
  sentEvents: any[];
  backfillBuffer: any[];
}

interface NewHeadsSubscription extends VirtualSubscription {
  params: ['newHeads'];
  sentEvents: NewHeadsEvent[];
  backfillBuffer: NewHeadsEvent[];
}

interface LogsSubscription extends VirtualSubscription {
  params: ['logs', LogsSubscriptionFilter?];
  sentEvents: LogsEvent[];
  backfillBuffer: LogsEvent[];
}

function isSubscriptionEvent(message: any): message is {
  params: { subscription: string; result: any };
} {
  return (
    message != null &&
    message.method === 'eth_subscription' &&
    message.params != null
  );
}

function makeCancelToken(): { cancel: () => void; isCancelled: () => boolean } {
  let cancelled = false;
  return {
    cancel: () => {
      cancelled = true;
    },
    isCancelled: () => cancelled
  };
}

async function withBackoffRetries<T>(
  f: () => Promise<T>,
  retryCount: number,
  shouldRetry: (error: unknown) => boolean = () => true
): Promise<T> {
  let nextWaitTime = 0;
  let i = 0;
  while (true) {
    try {
      return await f();
    } catch (error) {
      i++;
      if (i >= retryCount || !shouldRetry(error)) {
        throw error;
      }
      await delay(nextWaitTime);
      nextWaitTime =
        nextWaitTime === 0
          ? MIN_RETRY_DELAY
          : Math.min(MAX_RETRY_DELAY, RETRY_BACKOFF_FACTOR * nextWaitTime);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    )
  ]);
}

function getNewHeadsBlockNumber(event: NewHeadsEvent): number {
  return fromHex(event.number);
}

function getLogsBlockNumber(event: LogsEvent): number {
  return fromHex(event.blockNumber);
}

function addToPastEventsBuffer<T>(
  pastEvents: T[],
  event: T,
  blockNumberOf: (event: T) => number
): void {
  const currentBlockNumber = blockNumberOf(event);
  const firstGoodIndex = pastEvents.findIndex(
    item =>
      blockNumberOf(item) > currentBlockNumber - RETAINED_EVENT_BLOCK_COUNT
  );
  if (firstGoodIndex === -1) {
    pastEvents.length = 0;
  } else {
    pastEvents.splice(0, firstGoodIndex);
  }
  pastEvents.push(event);
}
