const forbiddenFetch = (): never => {
  throw new Error('network access is forbidden in unit tests');
};

Object.defineProperty(globalThis, 'fetch', { value: forbiddenFetch, writable: true, configurable: true });

export function assertNetworkForbidden(): void {
  if (!Object.is(globalThis.fetch, forbiddenFetch)) {
    throw new Error('fetch stub was replaced');
  }
}
