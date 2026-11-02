import { FetchError, ServerError } from '@alchemy/common';

import { VERSION } from '../version.js';

export interface HttpCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body?: unknown;
  timeout?: number;
  paramsSerializer?: (params: Record<string, any>) => string;
}

export interface HttpResult {
  status: number;
  data: unknown;
}

export type HttpTransport = (call: HttpCall) => Promise<HttpResult>;

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  data?: unknown;
  paramsSerializer?: (params: Record<string, any>) => string;
  timeout?: number;
}

let transport: HttpTransport = defaultHttpTransport;

/** @internal Test hook. Pass `undefined` to restore `fetch`. */
export function setHttpTransport(next?: HttpTransport): void {
  transport = next ?? defaultHttpTransport;
}

export async function sendHttpRequest(
  baseUrl: string,
  restApiName: string,
  methodName: string,
  query: Record<string, unknown>,
  options?: HttpRequestOptions
): Promise<HttpResult> {
  const method = options?.method ?? 'GET';
  const headers: Record<string, string> = {
    'Alchemy-Sdk-Version': VERSION,
    'Alchemy-Sdk-Method': methodName,
    ...options?.headers
  };
  return transport({
    url: baseUrl + '/' + restApiName,
    method,
    headers,
    query,
    body: options?.data,
    timeout: options?.timeout,
    paramsSerializer: options?.paramsSerializer
  });
}

async function defaultHttpTransport(call: HttpCall): Promise<HttpResult> {
  const query = call.paramsSerializer
    ? call.paramsSerializer(call.query)
    : encodeQuery(call.query);
  const url = query ? `${call.url}?${query}` : call.url;
  const headers = { ...call.headers };
  if (call.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: call.method,
      headers,
      body: call.body !== undefined ? JSON.stringify(call.body) : undefined,
      signal:
        call.timeout && call.timeout > 0
          ? AbortSignal.timeout(call.timeout)
          : undefined
    });
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new FetchError(call.url, call.method, cause);
  }

  const text = await response.text();
  let data: unknown = text;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data };
}

function encodeQuery(query: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}

export function httpError(
  status: number,
  data: unknown
): ServerError & {
  status: number;
} {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  const error = new ServerError(body, status) as ServerError & {
    status: number;
  };
  error.status = status;
  return error;
}
