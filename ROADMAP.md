# Roadmap — NestJS Hexagonal Plugin

Community contribution tracks after the Claude Opus 5 / Sonnet 5 model upgrade.
Pick an item, open or claim an issue, and follow [CONTRIBUTING.md](CONTRIBUTING.md).

## Done recently

- [x] Pin agents to Claude Opus 5 / Claude Sonnet 5 (`claude-opus-5`, `claude-sonnet-5`)
- [x] Align `create-subdomain` review phase with Opus 5 (was incorrectly Sonnet)
- [x] Document contribution paths and good-first-issue tracks

## Good first issues

| Track | Why it helps | Effort |
|---|---|---|
| Extra BC example (Inventory / Billing / Notifications) | Newcomers learn from a second vertical slice | Small–Medium |
| Skill checklist polish | Catch drift between SKILL.md and references | Small |
| Portuguese README section or `docs/pt-BR/` | Broader contributor base | Small |
| Argument-hint / trigger phrase audit | Better manual skill discovery | Small |
| Shared `.ts.example` for outbox / ACL stubs | Copy-paste starters without new skills | Small |

## Persistence & adapters

| Track | Description |
|---|---|
| TypeORM repository skill | Same pure-persistence port, TypeORM mapper + in-memory twin |
| Drizzle / MikroORM adapters | Keep domain untouched; swap infrastructure only |
| Mongo / document mapper patterns | When aggregates map poorly to SQL |
| Outbox pattern skill | Reliable event publish after `repo.save` |

## Presentation & transport

| Track | Description |
|---|---|
| GraphQL presentation skill | Controllers → resolvers, keep request validation at the edge |
| gRPC / microservice transport | Ports for command ingress without REST |
| OpenAPI codegen glue | Generate request DTOs from contracts without leaking into domain |
| Auth / RBAC presentation patterns | Guards + policies outside use cases |

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
| Haiku explore agent | Cheap read-only BC scanner before Opus/Sonnet work |
| Optional Fable orchestrator | Long `create-subdomain` runs for large BCs |
| Cursor / Copilot agent port | Same skills packaged for other coding agents |
| Skill validation CI | Lint frontmatter, links, and required sections on PRs |
| Migration skill | Layered NestJS module → hexagonal BC checklist |

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
- NestJS imports in the domain layer (except `AggregateRoot` / `IEvent`)
- Use cases for trivial `findById` without RBAC
