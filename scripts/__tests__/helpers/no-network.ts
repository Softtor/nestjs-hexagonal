const forbiddenFetch: typeof fetch = () => {
  throw new Error('network access is forbidden in unit tests');
};

globalThis.fetch = forbiddenFetch;

export function assertNetworkForbidden(): void {
  if (globalThis.fetch !== forbiddenFetch) {
    throw new Error('fetch stub was replaced');
  }
}
