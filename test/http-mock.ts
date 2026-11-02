import {
  HttpCall,
  HttpResult,
  setHttpTransport
} from '../src/internal/http.js';

interface Handler {
  method: string;
  status: number;
  data: unknown;
  once: boolean;
}

interface HistoryItem {
  params: Record<string, unknown>;
  data?: string;
  url: string;
  method: string;
}

/**
 * Records REST calls the way the old axios mock did, so NFT tests can keep
 * asserting on `history` and `reply` / `replyOnce`.
 */
export class HttpMock {
  history: Record<string, HistoryItem[]> = {
    get: [],
    post: [],
    put: [],
    patch: [],
    delete: []
  };

  private handlers: Handler[] = [];
  private nextMethod = 'GET';

  constructor() {
    setHttpTransport(call => this.handle(call));
  }

  onGet(): this {
    this.nextMethod = 'GET';
    return this;
  }

  onPost(): this {
    this.nextMethod = 'POST';
    return this;
  }

  onPut(): this {
    this.nextMethod = 'PUT';
    return this;
  }

  onPatch(): this {
    this.nextMethod = 'PATCH';
    return this;
  }

  reply(status: number, data: unknown): this {
    this.handlers = this.handlers.filter(
      handler => handler.method !== this.nextMethod || handler.once
    );
    this.handlers.push({
      method: this.nextMethod,
      status,
      data,
      once: false
    });
    return this;
  }

  replyOnce(status: number, data: unknown): this {
    this.handlers.push({
      method: this.nextMethod,
      status,
      data,
      once: true
    });
    return this;
  }

  reset(): void {
    this.handlers = [];
    this.history = {
      get: [],
      post: [],
      put: [],
      patch: [],
      delete: []
    };
  }

  private async handle(call: HttpCall): Promise<HttpResult> {
    const method = call.method.toUpperCase();
    const bucket = method.toLowerCase();
    if (!this.history[bucket]) {
      this.history[bucket] = [];
    }
    this.history[bucket].push({
      params: { ...call.query },
      data: call.body !== undefined ? JSON.stringify(call.body) : undefined,
      url: call.url,
      method
    });

    const index = this.handlers.findIndex(handler => handler.method === method);
    if (index < 0) {
      throw new Error(`Unexpected ${method} ${call.url}`);
    }
    const handler = this.handlers[index];
    if (handler.once) {
      this.handlers.splice(index, 1);
    }
    return { status: handler.status, data: handler.data };
  }
}
