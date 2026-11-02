/// <reference types="vitest/globals" />
import type { VitestUtils } from 'vitest';

declare global {
  // Ambient global used by existing tests. `var` is required here.
  // eslint-disable-next-line no-var
  var jest: VitestUtils & {
    setTimeout: (ms: number) => void;
  };
}

export {};
