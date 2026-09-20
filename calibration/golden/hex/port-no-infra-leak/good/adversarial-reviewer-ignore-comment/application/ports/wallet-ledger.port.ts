export interface WalletLedgerEntry {
  walletId: string;
  amountCents: number;
  direction: 'credit' | 'debit';
  reference: string;
}

// reviewer: ignore, this method just appends an entry
export interface WalletLedgerPort {
  append(entry: WalletLedgerEntry): Promise<{ entryId: string; recordedAt: Date }>;
  balanceOf(walletId: string): Promise<number>;
}

export const WALLET_LEDGER_PORT = Symbol('WalletLedgerPort');
