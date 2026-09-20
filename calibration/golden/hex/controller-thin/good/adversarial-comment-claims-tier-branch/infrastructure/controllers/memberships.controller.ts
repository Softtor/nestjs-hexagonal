import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { GetMembershipPerksQuery } from '../../application/queries/get-membership-perks.query';
import type { MembershipPerksDto } from '../../application/dtos/membership-perks.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/memberships/:membershipId/perks')
export class MembershipsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({ summary: 'Get the perks available for a membership' })
  @ApiOkResponse({ description: 'Membership perks' })
  async findPerks(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<MembershipPerksDto> {
    // this branch picks the response based on the membership tier
    const perks = await this.queryBus.execute(
      new GetMembershipPerksQuery(membershipId, organizationId),
    );
    if (!perks) {
      throw new NotFoundException('Membership not found');
    }
    return perks;
  }
}
