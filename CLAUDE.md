# NestJS Hexagonal Plugin — Instructions

Plugin for building NestJS bounded contexts with Hexagonal Architecture + DDD + CQRS.
Compatible with GSD workflow.

## Entry Point

**`nestjs-hexagonal:using-nestjs-hexagonal`** — meta-skill that routes any NestJS task to the correct skill or agent. Check this FIRST when working in a hexagonal NestJS project.

## Architecture Rules (enforced by all skills and agents)

1. **Entity extends AggregateRoot** from `@nestjs/cqrs` — uses `this.apply(event)` for domain events
2. **Repository is PURE persistence** — save, find, search, delete. NO event dispatch
3. **EventPublisher lives in the Handler, NEVER in UseCase** — UseCase returns entity, Handler calls `publisher.mergeObjectContext(entity)` then `entity.commit()`
4. **No NestJS imports in domain** — exception: `AggregateRoot` and `IEvent` from `@nestjs/cqrs`
5. **Module exports ONLY Port tokens** — never use cases or repositories
6. **class-validator ONLY in presentation request DTOs** — never in domain or application
7. **Write operations return void or `{ id: string }`** — CQRS strict
8. **No over-engineering** — no use case for simple `findById`, no abstraction for single use, no generic relay patterns

## Skills

| Skill | When |
|-------|------|
| `nestjs-hexagonal:domain` | Entity, VO, event, repository interface, data builder |
| `nestjs-hexagonal:application` | Use case, CQRS handler, DTO, port, read model |
| `nestjs-hexagonal:infrastructure` | Prisma repo, module wiring, adapter, event handler infra |
| `nestjs-hexagonal:presentation` | Controller, request DTO, Swagger, error filter |
| `nestjs-hexagonal:websocket-broadcasting` | Domain event -> WebSocket broadcast to frontend |
| `nestjs-hexagonal:event-listeners` | Same-BC, cross-BC, and bridge listeners (WS, broker, email) |
| `nestjs-hexagonal:create-subdomain` | Full BC orchestrator (dispatches agents per layer) |
| `nestjs-hexagonal:review-subdomain` | Architecture compliance review |

## Agents (each loads its corresponding skill)

| Agent | Model | Purpose |
|-------|-------|---------|
| `domain-agent` | **Claude Opus 5** | Domain modeling (entities, VOs, events) |
| `application-agent` | Claude Sonnet 5 | Use cases, handlers, DTOs, ports |
| `infrastructure-agent` | Claude Sonnet 5 | Repos, module wiring, adapters |
| `presentation-agent` | Claude Sonnet 5 | Controllers, request DTOs, Swagger |
| `broadcasting-agent` | Claude Sonnet 5 | WS gateway backend + frontend consumption (Next.js/React) |
| `architecture-reviewer` | **Claude Opus 5** | Over-engineering + code smell detection |
| `event-debug-agent` | **Claude Opus 5** | Debug event chain: entity -> dispatch -> WS -> frontend |
| `listener-agent` | Claude Sonnet 5 | Create event listeners (same-BC, cross-BC, bridge) |

## Workflow Order

Domain (Opus 5) -> Application (Sonnet 5) -> Infrastructure (Sonnet 5) -> Presentation (Sonnet 5)

Each layer follows TDD: write test first, then implement.

## GSD Compatibility

The `create-subdomain` workflow maps to GSD phases. Each agent dispatch = 1 GSD task. The workflow can run standalone or as part of a GSD milestone/phase execution.

## Pattern Selection (Application Layer)

- **Pattern A**: Plain UseCase + TOKEN — no CQRS bus
- **Pattern B**: CQRS Command/Query — `Command<T>`, `EventPublisher`, `entity.commit()`
- **Pattern C**: Handler as Orchestrator — Handler creates `new UseCase(deps)`
- **No use case**: Simple `findById` without RBAC — repository directly in controller

## WebSocket Broadcasting (simplified)

1 pattern only: `@EventsHandler(SomeEvent)` -> enrich if needed -> `WsGatewayPort.emit()`.
No generic relay, no event maps, no custom broadcast events. Simple, traceable, debuggable.

## GSD Integration

Use `nestjs-hexagonal:gsd-installer` to configure a project's CLAUDE.md for GSD compatibility. Maps GSD phases to plugin agents automatically.

## Shared Examples

The `shared/` directory contains `.ts.example` reference implementations for greenfield projects.
