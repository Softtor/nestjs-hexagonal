import { describe, expect, it } from 'vitest';
import { MoneyVO } from '../money.vo';

describe('MoneyVO', () => {
  it('adds amounts of the same currency', () => {
    expect(MoneyVO.of(10, 'USD').add(MoneyVO.of(5, 'USD')).amount).toBe(15);
  });
});
