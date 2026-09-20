import type { Redis } from 'ioredis';

export interface WalletBalanceCachePort {
  getClient(): Redis;
  warmUp(walletId: string): Promise<void>;
}

export const WALLET_BALANCE_CACHE_PORT = Symbol('WalletBalanceCachePort');
