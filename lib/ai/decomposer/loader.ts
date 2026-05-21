// Singleton WASM module loader for the Bobgy decomposer.
//
// The compiled `dist/strategy.js` is an ES6 module factory (MODULARIZE=1
// + EXPORT_ES6=1). Calling the factory returns a Promise that resolves
// to the instantiated module; the .wasm file is loaded automatically via
// `locateFile`.
//
// We cache the promise so concurrent callers all await the same load.
// Subsequent `getCppModule()` calls reuse the already-resolved instance.

// @ts-expect-error — generated JS has no .d.ts; we type the resolved shape
// via CppModule below.
import factory from './dist/strategy.js';

export interface StrategyResult {
  minHands: number;
  solutions: {
    size(): number;
    get(i: number): string;
    delete?(): void;
  };
}

export interface CppModule {
  calc(cards: string, mainRank: number, useOverallValueEstimator: boolean): StrategyResult;
}

let modulePromise: Promise<CppModule> | null = null;

export function getCppModule(): Promise<CppModule> {
  if (!modulePromise) {
    modulePromise = factory({
      // Tell Emscripten where to find the .wasm sibling file. In Node we
      // resolve relative to the dist/ directory; in browsers, Vite serves
      // the path as-is (bundler-aware loaders rewrite import URLs).
      locateFile: (path: string): string => {
        if (typeof window === 'undefined') {
          return new URL(`./dist/${path}`, import.meta.url).pathname;
        }
        return path;
      },
    }) as Promise<CppModule>;
  }
  return modulePromise;
}

/** Test helper — reset the singleton (e.g., between test files). */
export function _resetCppModuleForTests(): void {
  modulePromise = null;
}
