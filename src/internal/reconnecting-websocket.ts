import { createRequire } from 'node:module';

type SocketEvent = 'message' | 'reopen' | 'down';

type SocketListener = (event: { data?: string }) => void;

/**
 * A small reconnecting WebSocket. Node uses the `ws` package. Browsers and
 * tests can inject a constructor.
 *
 * @internal
 */
export class ReconnectingWebSocket {
  readonly url: string;
  readonly listeners: Record<string, SocketListener[]> = {};

  private socket: any;
  private closed = false;
  private opened = false;
  private readonly queue: string[] = [];
  private readonly protocols?: string;
  private readonly wsConstructor: new (url: string, protocols?: string) => any;

  constructor(
    url: string,
    protocols: string | undefined,
    wsConstructor: new (url: string, protocols?: string) => any
  ) {
    this.url = url;
    this.protocols = protocols;
    this.wsConstructor = wsConstructor;
    this.open(false);
  }

  send(data: string): void {
    if (this.opened) {
      this.socket.send(data);
      return;
    }
    this.queue.push(data);
  }

  close(): void {
    this.closed = true;
    this.socket.close();
  }

  reconnect(): void {
    try {
      this.socket.close();
    } catch {
      // The close handler reconnects unless `close()` was called.
    }
  }

  addEventListener(type: SocketEvent, listener: SocketListener): void {
    const bucket = this.listeners[type] ?? [];
    bucket.push(listener);
    this.listeners[type] = bucket;
  }

  removeEventListener(type: SocketEvent, listener: SocketListener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      item => item !== listener
    );
  }

  private open(isReconnect: boolean): void {
    this.opened = false;
    const SocketCtor = this.wsConstructor;
    this.socket = this.protocols
      ? new SocketCtor(this.url, this.protocols)
      : new SocketCtor(this.url);
    this.attach(this.socket, isReconnect);
  }

  private attach(socket: any, isReconnect: boolean): void {
    const onOpen = () => {
      this.opened = true;
      const pending = this.queue.splice(0, this.queue.length);
      for (const message of pending) {
        socket.send(message);
      }
      if (isReconnect) {
        this.dispatch('reopen', {});
      }
    };
    const onMessage = (event: any) => {
      const data =
        typeof event === 'string'
          ? event
          : typeof event?.data === 'string'
          ? event.data
          : event?.data?.toString?.() ?? String(event);
      this.dispatch('message', { data });
    };
    const onClose = () => {
      if (this.closed) {
        return;
      }
      this.dispatch('down', {});
      setTimeout(() => {
        if (!this.closed) {
          this.open(true);
        }
      }, 0);
    };
    const onError = () => {
      // Connection failures are surfaced as close/down. Ignore the error
      // event so Node does not treat it as unhandled.
    };

    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('open', onOpen);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onError);
      return;
    }
    socket.on('open', onOpen);
    socket.on('message', onMessage);
    socket.on('close', onClose);
    socket.on('error', onError);
  }

  private dispatch(type: SocketEvent, event: { data?: string }): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }
}

export function defaultWebSocketConstructor(): new (
  url: string,
  protocols?: string
) => any {
  if (!isNodeEnvironment()) {
    return WebSocket as unknown as new (url: string, protocols?: string) => any;
  }
  const nodeRequire = createRequire(import.meta.url);
  const ws = nodeRequire('ws');
  return ws.WebSocket ?? ws;
}

function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    process != null &&
    process.versions != null &&
    process.versions.node != null
  );
}
