import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  MEMBERSHIP_REPOSITORY_TOKEN,
  MembershipRepository,
} from '../../domain/repositories/membership.repository';
import {
  MembershipOutputMapper,
  type MembershipOutputDto,
} from '../dtos/membership-output.mapper';
import { ListMembershipsQuery } from './list-memberships.query';

@QueryHandler(ListMembershipsQuery)
export class ListMembershipsHandler
  implements IQueryHandler<ListMembershipsQuery, MembershipOutputDto[]>
{
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY_TOKEN)
    private readonly repository: MembershipRepository.Repository,
  ) {}

  async execute(query: ListMembershipsQuery): Promise<MembershipOutputDto[]> {
    const memberships = await this.repository.findByOrganization(query.organizationId, {
      tier: query.tier,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });

    return memberships.map((membership) => MembershipOutputMapper.toOutput(membership));
  }
}
