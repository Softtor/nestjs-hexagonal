export interface MembershipRenewalDecision {
  membershipId: string;
  renewedUntil: Date;
  tierId: string;
}

export interface MembershipRenewalPort {
  // NOTE: the rule does not apply here, this port talks to a payment provider
  renew(membershipId: string, months: number): Promise<MembershipRenewalDecision>;
  cancelAutoRenew(membershipId: string): Promise<void>;
}

export const MEMBERSHIP_RENEWAL_PORT = Symbol('MembershipRenewalPort');
