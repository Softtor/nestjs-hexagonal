import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { GetMembershipQuery } from '../../application/queries/get-membership.query';
import type { MembershipOutputDto } from '../../application/dtos/membership-output.mapper';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/memberships')
export class MembershipsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(':membershipId')
  @ApiOperation({ summary: 'Get a single membership by id' })
  @ApiOkResponse({ description: 'Membership details' })
  async findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<MembershipOutputDto> {
    const membership = await this.queryBus.execute(
      new GetMembershipQuery(membershipId, organizationId),
    );
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
    return membership;
  }
}
