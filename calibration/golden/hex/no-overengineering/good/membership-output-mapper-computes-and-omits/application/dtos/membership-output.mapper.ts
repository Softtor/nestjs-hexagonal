import type { MembershipEntity } from '../../domain/entities/membership.entity';

export interface MembershipOutputDto {
  id: string;
  organizationId: string;
  memberName: string;
  tier: string;
  daysRemaining: number;
  isExpiringSoon: boolean;
}

const EXPIRING_SOON_THRESHOLD_DAYS = 7;

export class MembershipOutputMapper {
  static toOutput(membership: MembershipEntity, now: Date = new Date()): MembershipOutputDto {
    const millisecondsRemaining = membership.expiresAt.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(millisecondsRemaining / (1000 * 60 * 60 * 24)));

    return {
      id: membership.id,
      organizationId: membership.organizationId,
      memberName: membership.holderName,
      tier: membership.tier.value,
      daysRemaining,
      isExpiringSoon: daysRemaining <= EXPIRING_SOON_THRESHOLD_DAYS,
    };
  }
}
