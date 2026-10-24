import { JSDOM } from "jsdom";

// Node 25+ pre-defines `localStorage` / `sessionStorage` on `globalThis` and
// leaves them `undefined` unless node runs with `--localstorage-file`.
// Vitest's jsdom environment only installs a window property on `globalThis`
// when no such key exists yet, so under newer Node these tests would read
// `undefined` instead of a Storage. Install real jsdom Storage objects then.
if (
  globalThis.localStorage === undefined ||
  globalThis.sessionStorage === undefined
) {
  const { window } = new JSDOM("", { url: "http://localhost:3000" });
  for (const key of ["localStorage", "sessionStorage"] as const) {
    if (globalThis[key] === undefined) {
      Object.defineProperty(globalThis, key, {
        value: window[key],
        configurable: true,
        writable: true,
      });
    }
  }
}
