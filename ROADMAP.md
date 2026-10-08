# Roadmap — NestJS Hexagonal Plugin

Community contribution tracks after the Claude Opus 5.5 / Sonnet 5 model upgrade.
Pick an item, open or claim an issue, and follow [CONTRIBUTING.md](CONTRIBUTING.md).

## Done recently

- [x] Broker-neutral fluent dispatcher, pure entities/events, RxJS publication, NestJS adapters and copied-template/example tests (1.4.0)

- [x] Pin agents to Claude Opus 5.5 / Claude Sonnet 5 (`claude-opus-5-5`, `claude-sonnet-5`)
- [x] Align `create-subdomain` review phase with Opus 5.5 (was incorrectly Sonnet)
- [x] Document contribution paths and good-first-issue tracks
- [x] Rulebook (`hexagonal`, `softtor-conventions`), `nestjs-hexagonal-check` CLI, opt-in hooks (1.2.0, 1.3.0)
- [x] Semantic rules through Jev with a calibration harness and fitted thresholds (1.3.0)
- [x] Rulebook-driven layer agents, checker-first reviewer, three-step `review-subdomain`, lockfile package runner (1.3.0)
- [x] Skill/agent frontmatter, reference and link CI ([#7](https://github.com/Softtor/nestjs-hexagonal/issues/7), 1.3.0)
- [x] `prescan` subcommand and a minimal read-only `explore-agent` on Haiku ([#2](https://github.com/Softtor/nestjs-hexagonal/issues/2), partially: the agent exists and is routed from `using-nestjs-hexagonal`; the "when to use Haiku vs Sonnet 5 vs Opus 5.5" guide and a richer inventory remain open)

## Good first issues

| Track | Why it helps | Effort | Issue |
|---|---|---|---|
| Extra BC example (Inventory / Billing / Notifications) | Newcomers learn from a second vertical slice | Small–Medium | [#6](https://github.com/Softtor/nestjs-hexagonal/issues/6) |
| Skill checklist polish | Catch drift between SKILL.md and references | Small | — |
| Portuguese README section or `docs/pt-BR/` | Broader contributor base | Small | [#8](https://github.com/Softtor/nestjs-hexagonal/issues/8) |
| Argument-hint / trigger phrase audit | Better manual skill discovery | Small | — |
| Shared `.ts.example` for outbox / ACL stubs | Copy-paste starters without new skills | Small | — |

## Persistence & adapters

The following backlog complements the dispatcher and does not block 1.4.0. Prioritize contracts/conformance, then adapters/reactive interfaces, then streaming/benchmarks.

| Track | Description | Issue |
|---|---|---|
| TypeORM repository skill | Same pure-persistence port, TypeORM mapper + in-memory twin | [#1](https://github.com/Softtor/nestjs-hexagonal/issues/1) |
| Drizzle repository adapters | ORM-neutral semantics and infrastructure-only schema | [#21](https://github.com/Softtor/nestjs-hexagonal/issues/21) |
| Repository contracts | Standardize absence/conflict and optional capabilities | [#19](https://github.com/Softtor/nestjs-hexagonal/issues/19) |
| Prisma alignment | Align existing adapters with neutral contracts | [#22](https://github.com/Softtor/nestjs-hexagonal/issues/22) |
| Repository conformance suite | Shared real-database adapter validation | [#20](https://github.com/Softtor/nestjs-hexagonal/issues/20) |
| Optional reactive interfaces | Cold RxJS reads/writes while preserving Promise APIs | [#23](https://github.com/Softtor/nestjs-hexagonal/issues/23) |
| Bounded streaming | Native streams or cursor batches per adapter | [#24](https://github.com/Softtor/nestjs-hexagonal/issues/24) |
| Query/stream benchmarks | Reproducible measured gains and regressions | [#25](https://github.com/Softtor/nestjs-hexagonal/issues/25) |
| Mongo / document mapper patterns | When aggregates map poorly to SQL | — |
| Outbox pattern skill | Reliable event publish after `repo.save` | [#5](https://github.com/Softtor/nestjs-hexagonal/issues/5) |

## Presentation & transport

| Track | Description | Issue |
|---|---|---|
| GraphQL presentation skill | Controllers → resolvers, keep request validation at the edge | [#3](https://github.com/Softtor/nestjs-hexagonal/issues/3) |
| gRPC / microservice transport | Ports for command ingress without REST | — |
| OpenAPI codegen glue | Generate request DTOs from contracts without leaking into domain | — |
| Auth / RBAC presentation patterns | Guards + policies outside use cases | — |

## Messaging & workflows

| Track | Description |
|---|---|
| Kafka / RabbitMQ / SQS bridge skill | Extend bridge listeners beyond Socket.IO + generic broker |
| Saga / process manager skill | Cross-BC orchestration without bloating aggregates |
| Temporal / workflow adapter | Long-running processes behind an application port |
| Idempotent consumer patterns | Safe retries for cross-BC listeners |

## DX & multi-harness

| Track | Description |
|---|---|
| Haiku explore agent | Cheap read-only BC scanner before Opus/Sonnet work; `prescan` and a minimal `explore-agent` shipped in 1.3.0, the model-choice guide is still open | [#2](https://github.com/Softtor/nestjs-hexagonal/issues/2) |
| Optional Fable orchestrator | Long `create-subdomain` runs for large BCs | — |
| Cursor / Copilot agent port | Same skills packaged for other coding agents | — |
| Semantic `deny` in the hooks (gate v1.1) | Only for rules with a fitted `deny` (>= 30/30 golden cases, precision >= 0.95) and false positives measured in a pilot | — |
| Migration skill | Layered NestJS module → hexagonal BC checklist | — |

## Architecture depth (keep YAGNI)

| Track | Description |
|---|---|
| Multi-tenancy patterns | `organizationId` / tenant VO conventions across layers |
| Soft-delete + audit trail | Domain events + projection without repository event dispatch |
| Snapshotting / event sourcing lite | Only if a real BC needs it — optional skill, not default |
| Read-model beyond Redis | Elasticsearch / SQL projections via the same port shape |

## Contribution labels (suggested)

- `good first issue` — docs, examples, checklists
- `skill` — new or extended SKILL.md + references
- `agent` — agent frontmatter / prompt changes
- `example` — bounded context samples under `examples/`
- `infrastructure` — persistence / broker adapters
- `presentation` — HTTP / GraphQL / gRPC surfaces
- `dx` — CI, installers, multi-harness packaging

## Non-goals (for now)

- Generic event relay frameworks
- Forcing CQRS on every read
- NestJS imports in the domain layer
- Use cases for trivial `findById` without RBAC
