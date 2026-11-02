import { AlchemyConfig } from '../api/alchemy-config.js';
import { AlchemyApiType } from '../util/const.js';
import { logDebug, logInfo } from '../util/logger.js';
import { ExponentialBackoff } from './backoff.js';
import { HttpRequestOptions, httpError, sendHttpRequest } from './http.js';

/**
 * Makes an HTTP request and retries retryable failures.
 *
 * This is the local stand-in for `@alchemy/common`'s unexported
 * `AlchemyRestClient`. Swap this file when that client is a public export and
 * includes retries.
 *
 * @internal
 */
export async function requestHttpWithBackoff<Req, Res>(
  config: AlchemyConfig,
  apiType: AlchemyApiType,
  restApiName: string,
  methodName: string,
  params: Req,
  overrides?: HttpRequestOptions
): Promise<Res> {
  let lastError: Error | undefined = undefined;
  const backoff = new ExponentialBackoff(config.maxRetries);
  for (let attempt = 0; attempt < config.maxRetries + 1; attempt++) {
    try {
      if (lastError !== undefined) {
        logInfo('requestHttp', `Retrying after error: ${lastError.message}`);
      }

      try {
        await backoff.backoff();
      } catch {
        break;
      }

      const response = await sendHttpRequest(
        config._getRequestUrl(apiType),
        restApiName,
        methodName,
        (params ?? {}) as Record<string, unknown>,
        {
          ...overrides,
          timeout: overrides?.timeout ?? config.requestTimeout
        }
      );

      if (response.status === 200) {
        logDebug(restApiName, `Successful request: ${restApiName}`);
        return response.data as Res;
      }

      logInfo(
        restApiName,
        `Request failed: ${restApiName}, ${response.status}, ${response.data}`
      );
      lastError = httpError(response.status, response.data);
      if (!isRetryableStatus(response.status, apiType)) {
        break;
      }
    } catch (err) {
      if (isHttpStatusError(err) && !isRetryableStatus(err.status, apiType)) {
        lastError = err;
        break;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  return Promise.reject(lastError);
}

function isHttpStatusError(err: unknown): err is Error & { status: number } {
  return (
    err instanceof Error &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

function isRetryableStatus(status: number, apiType: AlchemyApiType): boolean {
  const retryableCodes =
    apiType === AlchemyApiType.WEBHOOK ? [429, 500, 503] : [429, 503];
  return retryableCodes.includes(status);
}

/**
 * Fetches all pages in a paginated endpoint, given a `pageKey` field that
 * represents the property name containing the next page token.
 *
 * @internal
 */
export async function* paginateEndpoint<
  ReqPageKey extends string,
  ResPageKey extends string,
  Req extends Partial<Record<string, any> & Record<ReqPageKey, string>>,
  Res extends Partial<Record<string, any> & Record<ResPageKey, string>>
>(
  config: AlchemyConfig,
  apiType: AlchemyApiType,
  restApiName: string,
  methodName: string,
  reqPageKey: ReqPageKey,
  resPageKey: ResPageKey,
  params: Req
): AsyncIterable<Res> {
  let hasNext = true;
  const requestParams = { ...params };
  while (hasNext) {
    const response = await requestHttpWithBackoff<Req, Res>(
      config,
      apiType,
      restApiName,
      methodName,
      requestParams
    );
    yield response;
    if (response[resPageKey] !== null) {
      requestParams[reqPageKey] = response[resPageKey] as any;
    } else {
      hasNext = false;
    }
  }
}
