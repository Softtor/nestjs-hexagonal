---
name: using-nestjs-hexagonal
description: Meta-skill that routes NestJS development tasks to the correct nestjs-hexagonal skill or agent. Activates when working on NestJS projects with hexagonal architecture, DDD, CQRS, bounded contexts, entities, value objects, repositories, event listeners, WebSocket broadcasting, or any architectural task in a NestJS codebase. This skill should be checked FIRST before any implementation in a NestJS hexagonal project.
argument-hint: What you want to do (e.g., "create entity", "review module", "debug event")
---

# Using NestJS Hexagonal

This is a routing skill. When working in a NestJS project that follows hexagonal architecture, check this skill FIRST to find the right tool for the job.

---

## Detection — When Does This Plugin Apply?

This plugin applies when ANY of these are true:
- Project has `@nestjs/core` and `@nestjs/cqrs` in dependencies
- Project structure has `domain/`, `application/`, `infrastructure/` layers
- Files contain `AggregateRoot`, `@EventsHandler`, `@CommandHandler`, `@QueryHandler`
- User mentions: entity, value object, bounded context, CQRS, hexagonal, DDD, aggregate
- CLAUDE.md references `nestjs-hexagonal` skills

If detected, route ALL architectural tasks through this plugin's skills and agents.

---

## Routing Table — What Are You Doing?

### Creating or Modifying Code

| Task | Route to | Type |
|------|----------|------|
| Create new bounded context / module | `nestjs-hexagonal:create-subdomain` | Skill (orchestrator) |
| Create entity (AggregateRoot) | `nestjs-hexagonal:domain-agent` | Agent (Opus) |
| Create value object | `nestjs-hexagonal:domain` | Skill |
| Create domain event | `nestjs-hexagonal:domain` | Skill |
| Create repository interface | `nestjs-hexagonal:domain` | Skill |
| Create data builder (testing) | `nestjs-hexagonal:domain` | Skill |
| Create use case | `nestjs-hexagonal:application` | Skill |
| Create CQRS command/query handler | `nestjs-hexagonal:application` | Skill |
| Create DTO | `nestjs-hexagonal:application` | Skill |
| Create port (cross-module interface) | `nestjs-hexagonal:application` | Skill |
| Create Prisma repository | `nestjs-hexagonal:infrastructure` | Skill |
| Wire NestJS module | `nestjs-hexagonal:infrastructure` | Skill |
| Create adapter (port implementation) | `nestjs-hexagonal:infrastructure` | Skill |
| Create controller | `nestjs-hexagonal:presentation` | Skill |
| Create request DTO (class-validator) | `nestjs-hexagonal:presentation` | Skill |
| Create event listener (same-BC) | `nestjs-hexagonal:event-listeners` | Skill |
| Create event listener (cross-BC) | `nestjs-hexagonal:event-listeners` | Skill |
| Create WebSocket broadcast | `nestjs-hexagonal:websocket-broadcasting` | Skill |
| Create WS gateway | `nestjs-hexagonal:websocket-broadcasting` | Skill |
| Create frontend event consumer | `nestjs-hexagonal:broadcasting-agent` | Agent (Sonnet) |

### Reviewing or Debugging

| Task | Route to | Type |
|------|----------|------|
| Review bounded context | `nestjs-hexagonal:architecture-reviewer` | Agent (Opus) |
| Check for over-engineering | `nestjs-hexagonal:architecture-reviewer` | Agent (Opus) |
| Debug event not reaching frontend | `nestjs-hexagonal:event-debug-agent` | Agent (Opus) |
| Debug event not being consumed | `nestjs-hexagonal:event-debug-agent` | Agent (Opus) |

### Setting Up

| Task | Route to | Type |
|------|----------|------|
| Configure GSD to use this plugin | `nestjs-hexagonal:gsd-installer` | Skill |
| Review all available patterns | Read `CLAUDE.md` at plugin root | Reference |

---

## Agent Selection by Model

| Decision Type | Agent | Model | Why |
|---|---|---|---|
| Domain modeling (what entities, VOs, events) | `domain-agent` | **Opus** | Critical architectural decisions |
| Architecture review | `architecture-reviewer` | **Opus** | Deep judgment for smells + over-engineering |
| Event chain debugging | `event-debug-agent` | **Opus** | 6-layer systematic tracing |
| Application layer (use cases, handlers) | `application-agent` | Sonnet | Follows established patterns |
| Infrastructure (repos, modules) | `infrastructure-agent` | Sonnet | Mechanical pattern application |
| Presentation (controllers, DTOs) | `presentation-agent` | Sonnet | Mechanical pattern application |
| WebSocket + frontend | `broadcasting-agent` | Sonnet | Follows WS skill patterns |
| Event listeners | `listener-agent` | Sonnet | Follows listener skill patterns |

**Rule:** Use Opus for DECISIONS (what to build), Sonnet for EXECUTION (how to build it).

---

## Architecture Rules (always enforce)

These rules apply to ALL tasks routed through this plugin:

1. **Entity extends AggregateRoot** — uses `this.apply(event)` to queue events
2. **Repository is PURE persistence** — no event dispatch, no domain logic
3. **EventPublisher in Handler ONLY** — UseCase returns entity, Handler commits events
4. **Module exports ONLY Port tokens** — never use cases, never repositories
5. **class-validator ONLY in presentation** — never in domain or application
6. **Write returns void or ID** — CQRS strict, no full objects on command side
7. **No over-engineering** — no use case for trivial findById, no abstractions for single use
8. **Listeners in CONSUMING BC** — cross-BC listeners live where they're consumed, not emitted
9. **try/catch in all listeners** — listener failure never breaks the event chain

---

## Workflow Order (when building a full BC)

```
1. Domain (Opus)     → entities, VOs, events, repo interface, data builders
2. Application       → use cases / handlers, DTOs, ports
3. Infrastructure    → Prisma repo, module wiring, adapters, listeners
4. Presentation      → controllers, request DTOs, Swagger
5. Broadcasting      → WS gateway + frontend hooks (if real-time needed)
6. Verification      → lint, types, tests, build
7. Review (Opus)     → architecture compliance + over-engineering audit
```

Use `nestjs-hexagonal:create-subdomain` to orchestrate this automatically.

---

## Pattern Quick Reference

### Application Layer — Which Pattern?

| Scenario | Pattern |
|---|---|
| Simple CRUD, no events needed | **A** — Plain UseCase + TOKEN |
| Module uses CQRS, events on write | **B** — Command/Query handlers |
| Complex orchestration, multiple ports | **C** — Handler as Orchestrator |
| Trivial findById, no RBAC | **No pattern** — repo directly in controller |

### Event Listeners — Which Type?

| Scenario | Type |
|---|---|
| Update Redis projection after event | Same-BC listener |
| Another BC reacts to this event | Cross-BC listener |
| Frontend needs real-time update | Bridge listener (WS) |
| External service needs notification | Bridge listener (broker/email/webhook) |
| 3+ consumers sharing pre-processing | Strategy + Gateway pattern |
| Simple side effect, single consumer | Put it in the command handler directly |

---

## Red Flags — Stop and Route

If you catch yourself doing any of these, STOP and invoke the correct skill:

| What you're about to do | Problem | Route to |
|---|---|---|
| Adding `@Injectable` to a domain class | Framework leak into domain | `nestjs-hexagonal:domain` |
| Putting `EventPublisher` in a UseCase | UseCase must be framework-agnostic | `nestjs-hexagonal:application` |
| Exporting a repository from a module | Only Port tokens should be exported | `nestjs-hexagonal:infrastructure` |
| Adding `class-validator` to a VO | Validation layers are separate | `nestjs-hexagonal:domain` |
| Making repository dispatch events | Repository is pure persistence | `nestjs-hexagonal:infrastructure` |
| Creating use case for simple findById | Over-engineering | Check architecture-reviewer criteria |
| Importing a service from another BC | Use ports instead | `nestjs-hexagonal:application` (ports) |
| Creating generic event relay | Over-engineering | `nestjs-hexagonal:event-listeners` |
