/** Simple wallets stay unfundable until a second on-chain method exists. */
export const MIN_ONCHAIN_METHODS_BEFORE_FUNDS = 2;

export function identityMayReceiveFunds(methodCount: number): boolean {
  return Number.isInteger(methodCount) && methodCount >= MIN_ONCHAIN_METHODS_BEFORE_FUNDS;
}
