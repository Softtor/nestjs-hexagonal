# NestJS Hexagonal Architecture Plugin

> Claude Code plugin for building NestJS bounded contexts with Hexagonal Architecture, DDD, and CQRS patterns.

## Overview

This plugin provides layer-specific skills, specialized agents, and workflow orchestrators for creating well-structured NestJS bounded contexts. It codifies Ports & Adapters architecture combined with Domain-Driven Design and the `@nestjs/cqrs` module.

**Who it's for:** Teams building NestJS applications that follow clean architecture and want consistent, reviewable code.

**Key patterns:**
- Entity modeling with `AggregateRoot`, domain events via `entity.commit()`, and `EventBus`
- Value Objects (scalar, composed, enum, state machine)
- Repository interfaces as ports with Prisma and in-memory implementations
- Three application patterns (plain UseCase, CQRS Command/Query, Handler-as-Orchestrator)
- WebSocket broadcasting via `WsGatewayPort` abstraction
- NestJS module wiring that exports only port tokens

**Compatible with GSD workflow** (usable as phase execution within milestones).

## Installation

### From GitHub

```bash
# 1. Add the marketplace (one time)
/plugin marketplace add softtor/nestjs-hexagonal

# 2. Install the plugin
/plugin install nestjs-hexagonal
```

### Local development

```bash
claude --plugin-dir /path/to/nestjs-hexagonal
```

## Skills

### Layer Skills

| Skill | Trigger examples | What it does |
|---|---|---|
| `nestjs-hexagonal:domain` | "create entity", "new value object" | Entity (AggregateRoot), VOs, events, repo interfaces, data builders |
| `nestjs-hexagonal:application` | "create use case", "cqrs handler" | Use cases, handlers, DTOs, ports, read models |
| `nestjs-hexagonal:infrastructure` | "prisma repo", "module wiring" | Prisma repos, mappers, adapters, NestJS modules |
| `nestjs-hexagonal:presentation` | "create controller", "request dto" | Controllers, request DTOs, Swagger, error filters |
| `nestjs-hexagonal:websocket-broadcasting` | "broadcast event", "ws gateway" | Domain event -> WebSocket broadcast to frontend |

### Workflow Skills

| Skill | What it does |
|---|---|
| `nestjs-hexagonal:create-subdomain` | Orchestrates full BC creation by dispatching agents per layer |
| `nestjs-hexagonal:review-subdomain` | Architecture compliance + over-engineering + code smell review |

## Agents

Each agent loads its corresponding skill and specializes in one concern.

| Agent | Model | Purpose |
|---|---|---|
| `domain-agent` | **Claude Opus 5** (`claude-opus-5`) | Domain modeling — entities, VOs, events, repo interfaces |
| `application-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | Use cases, CQRS handlers, DTOs, ports |
| `infrastructure-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | Prisma repos, module wiring, adapters |
| `presentation-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | Controllers, request DTOs, Swagger |
| `broadcasting-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | WS gateway (backend) + event consumption (Next.js/React frontend) |
| `listener-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | Creates event listeners (same-BC projections, cross-BC reactions, bridge) |
| `architecture-reviewer` | **Claude Opus 5** (`claude-opus-5`) | Over-engineering detection + code smell identification |
| `event-debug-agent` | **Claude Opus 5** (`claude-opus-5`) | Debug full event chain: entity -> dispatch -> WS -> frontend |

**Why Opus 5 for domain, review, and debug?** Domain modeling requires critical decisions. Review requires deep judgment to distinguish necessary from unnecessary complexity. Event debugging requires tracing across 6 layers systematically.

**Model pins:** Agents use full IDs (`claude-opus-5`, `claude-sonnet-5`) so resolution does not fall back to legacy 4.x aliases on some providers. Requires Claude Code **v2.1.219+** (Opus 5) and **v2.1.197+** (Sonnet 5) — run `claude update` if needed.

## Architecture Overview

### Event Flow (CQRS)

```
UseCase
  -> entity = Entity.create(props)    # entity.apply(event) queues internally
  -> repo.save(entity)                # repo is PURE persistence
  -> return entity                    # UseCase returns entity to Handler

Handler
  -> publisher.mergeObjectContext(entity)   # Handler wraps entity
  -> entity.commit()                       # Handler dispatches via EventBus
  -> return { id: entity.id }

EventBus -> @EventsHandler             # Side effects, projections, WS broadcast
```

**Critical rule:** `EventPublisher` lives in the Handler, NEVER in the UseCase.

### Pattern Selection (Application Layer)

| Scenario | Pattern |
|---|---|
| Simple CRUD without side effects | **A**: Plain UseCase + TOKEN |
| Module uses CQRS | **B**: Command/Query handlers |
| Complex orchestration with multiple services | **C**: Handler as Orchestrator |
| Simple `findById` without RBAC | No use case — repo directly in controller |

### Validation Layers

| Layer | Where | Tool | Responsibility |
|---|---|---|---|
| Request DTO | presentation | `class-validator` | Format, presence, types |
| Application DTO | application | TypeScript interfaces | Layer contract |
| Domain VO | domain | Manual `validate()` | Business invariants |
| Queue Schema | integration | Zod | Inter-service contract |

### WebSocket Broadcasting (simplified)

One pattern only: `@EventsHandler` -> enrich if needed -> `WsGatewayPort.emit()`.

No generic relay, no event maps, no custom broadcast events. Each event that needs to reach the frontend has its own explicit handler.

## Shared Examples

The `shared/` directory contains `.ts.example` reference implementations for projects that don't yet have base classes.

| File | What it provides |
|---|---|
| `entity.ts.example` | Entity extending AggregateRoot with `apply()` |
| `value-object.ts.example` | Abstract ValueObject with validation |
| `unique-entity-id.ts.example` | UUID-based entity ID |
| `domain-event.ts.example` | IEvent implementation |
| `repository-contracts.ts.example` | Pure persistence interface |
| `searchable-repository.ts.example` | SearchParams + SearchResult + SearchableRepositoryInterface |
| `in-memory-searchable.ts.example` | In-memory repo for unit tests |
| `domain-error-filter.ts.example` | DomainError -> HTTP status mapping |
| `env-config.service.ts.example` | EnvConfigService with typed getters |
| `define-data-builder.ts.example` | Base builder class with faker |
| `data-builder-example.ts.example` | Concrete builder example |
| `errors.ts.example` | Full domain error hierarchy |
| `ws-gateway-port.ts.example` | WsGatewayPort interface + TOKEN |

## Principles

- **CQRS-friendly, not CQRS-mandatory** — simple reads skip the bus
- **Event-friendly, not event-mandatory** — events only for side effects
- **No over-engineering** — 3 lines of code beats a premature abstraction
- **Test-friendly** — data builders, in-memory repos, real integration tests
- **Framework-agnostic domain/application** — exportable to other frameworks
- **Microservice-friendly** — event-driven patterns enable future extraction

## GSD Compatibility

The `create-subdomain` workflow maps directly to GSD phases. Each agent dispatch equals one GSD task.

**Setup:** Run `nestjs-hexagonal:gsd-installer` to configure your project's CLAUDE.md with skill mappings and phase templates for GSD.

The installer adds:
- Skill-to-agent mapping table for GSD executor agents
- Architecture rules that GSD enforces during execution
- Phase template for bounded context creation

## Contributing

Community contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [ROADMAP](ROADMAP.md) for open feature tracks and good first issues.

1. Fork the repository
2. Create a feature branch
3. Follow the existing skill structure (SKILL.md + references/)
4. Submit a pull request

## License

MIT
