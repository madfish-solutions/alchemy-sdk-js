import { vi } from 'vitest';

const jestApi = Object.assign(vi, {
  setTimeout: (_ms: number) => undefined
});

(globalThis as { jest?: typeof jestApi }).jest = jestApi;
