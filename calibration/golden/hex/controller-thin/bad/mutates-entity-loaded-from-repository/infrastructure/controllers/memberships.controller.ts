import { Controller, Inject, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MembershipRepository } from '../../domain/repositories/membership.repository';
import { MEMBERSHIP_REPOSITORY } from '../../domain/repositories/membership.repository';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/memberships')
export class MembershipsController {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly membershipRepository: MembershipRepository,
  ) {}

  @Post(':membershipId/activate')
  @ApiOperation({ summary: 'Activate a pending membership' })
  @ApiOkResponse({ description: 'Membership activated' })
  async activate(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<{ id: string }> {
    const membership = await this.membershipRepository.findById(membershipId, organizationId);
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
    membership.activate();
    await this.membershipRepository.save(membership);
    return { id: membership.id };
  }
}
