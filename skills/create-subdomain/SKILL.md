---
name: create-subdomain
description: Orchestrates creation of a NestJS bounded context by dispatching specialized agents per layer (domain, application, infrastructure, presentation). Uses Claude Opus 5 for domain modeling and review, Claude Sonnet 5 for execution layers. Compatible with GSD workflow (usable as phase execution). Follows TDD, Hexagonal Architecture, DDD, and CQRS.
argument-hint: Entity name (e.g., "Invoice" or "billing/invoices")
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - Skill
  - AskUserQuestion
---

# create-subdomain

Orchestrator that dispatches specialized agents per architectural layer. Each agent loads its corresponding skill and follows TDD.

> **Agent Dispatch:** The dispatch blocks below are conceptual templates. In Claude Code, dispatch agents using the `Agent` tool with a `prompt` string that includes "Load skill nestjs-hexagonal:<layer> for patterns." The agent's model and tools are defined in the agent `.md` file frontmatter, not in the tool call.

Compatible with GSD: each phase maps to a GSD execution step.

---

## Phase 1 — Requirements Gathering (inline)

Ask the user via `AskUserQuestion`. Collect all answers before dispatching agents.

1. Bounded context name and business purpose?
2. Main entities? Which is the aggregate root?
3. Value objects needed? (money, status, email, document, etc.)
4. Domain events? (created, updated, status-changed, cancelled)
5. Multi-tenant? Field name? (`organizationId` or `companyId`)
6. CQRS pattern? (A: plain UseCase, B: Command/Query, C: Handler as Orchestrator)
7. RBAC guards on endpoints?
8. Sub-modules? (e.g., subscription -> plans, payments, core)
9. Cross-module ports needed? (which existing modules to communicate with)
10. Read model projection in Redis? (CQRS R/W separation)

After answers, create the directory structure:

```
<context>/
├── domain/
│   ├── entities/__tests__/
│   ├── value-objects/__tests__/
│   ├── events/
│   ├── repositories/
│   ├── services/
│   └── testing/helpers/
├── application/
│   ├── dtos/
│   ├── commands/          # Pattern B/C
│   ├── queries/           # Pattern B/C
│   ├── usecases/          # Pattern A/C
│   └── ports/
└── infrastructure/
    ├── <context>.module.ts
    ├── controllers/dtos/
    ├── database/prisma/repositories/
    ├── database/prisma/models/
    ├── database/in-memory/repositories/
    ├── adapters/
    └── listeners/
```

---

## Phase 2 — Domain Layer via `domain-agent` (Claude Opus 5)

Dispatch the domain-agent with context from Phase 1:

```
Agent tool:
  subagent_type: "nestjs-hexagonal:domain-agent"
  model: claude-opus-5
  prompt: |
    Create domain layer for "<context>" at "<path>".
    Entity: <name>, Props: <list>
    VOs: <list>, Events: <list>
    Multi-tenant: <field>
    TDD: tests first. Load skill nestjs-hexagonal:domain.
```

The agent will create: entity + tests, VOs + tests, events, repository interface, data builders. Verify types compile.

**Wait for completion before Phase 3.**

---

## Phase 3 — Application Layer via `application-agent` (Claude Sonnet 5)

```
Agent tool:
  subagent_type: "nestjs-hexagonal:application-agent"
  model: claude-sonnet-5
  prompt: |
    Create application layer for "<context>" at "<path>".
    Pattern: <A/B/C>, Operations: <list>
    Ports: <list>, Read model: <yes/no>
    Domain layer at "<path>/domain/".
    TDD: tests first. Load skill nestjs-hexagonal:application.
```

Creates: DTOs, use cases/handlers, ports, tests.

**Wait for completion before Phase 4.**

---

## Phase 4 — Infrastructure Layer via `infrastructure-agent` (Claude Sonnet 5)

```
Agent tool:
  subagent_type: "nestjs-hexagonal:infrastructure-agent"
  model: claude-sonnet-5
  prompt: |
    Create infrastructure layer for "<context>" at "<path>".
    Pattern: <A/B/C>, Ports to implement: <list>
    Event handlers: <list side effects>
    Load skill nestjs-hexagonal:infrastructure.
```

Creates: Prisma repo, model mapper, in-memory repo, adapters, event handlers, module wiring.

**Wait for completion before Phase 5.**

---

## Phase 5 — Presentation Layer via `presentation-agent` (Claude Sonnet 5)

Skip if no HTTP endpoints needed.

```
Agent tool:
  subagent_type: "nestjs-hexagonal:presentation-agent"
  model: claude-sonnet-5
  prompt: |
    Create presentation layer for "<context>" at "<path>".
    Pattern: <A/B/C>, Endpoints: <CRUD list>
    RBAC: <yes/no>
    Load skill nestjs-hexagonal:presentation.
```

Creates: controller, request DTOs, Swagger, module registration.

**Wait for completion before Phase 6.**

---

## Phase 6 — Verification (inline)

Run directly, no agent needed:

```bash
pnpm check-types
pnpm lint
pnpm test --filter <module-name>
pnpm build
```

All must exit 0. Fix root causes, no suppression.

---

## Phase 7 — Architecture Review via `architecture-reviewer` (Claude Opus 5)

```
Agent tool:
  subagent_type: "nestjs-hexagonal:architecture-reviewer"
  model: claude-opus-5
  prompt: |
    Review bounded context at "<path>".
    Check all 6 dimensions. Produce Pass/Warning/Fail report.
```

Address every FAIL. Report to user: structure, pattern, decisions, deferred warnings.

---

## GSD Compatibility

This workflow maps directly to GSD phases:

| GSD Phase | create-subdomain Phase | Agent |
|---|---|---|
| Research | Phase 1 (requirements) | inline |
| Execute task 1 | Phase 2 (domain) | domain-agent (Opus 5) |
| Execute task 2 | Phase 3 (application) | application-agent (Sonnet 5) |
| Execute task 3 | Phase 4 (infrastructure) | infrastructure-agent (Sonnet 5) |
| Execute task 4 | Phase 5 (presentation) | presentation-agent (Sonnet 5) |
| Verify | Phase 6 (verification) | inline |
| Review | Phase 7 (review) | architecture-reviewer (Opus 5) |

When used within GSD, each phase can be a separate GSD task tracked in the plan.

---

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| Use case for simple `findById` without RBAC | Repository directly in controller |
| `EventPublisher` in UseCase | Only in the CQRS Handler |
| Exporting repositories from module | Export only Port token Symbols |
| `class-validator` in domain VOs | Manual `validate()` with `InvalidArgumentError` |
| Repository dispatching events | Repository is pure persistence |
| Circular module dependencies | Ports in consumer, adapter in provider |
| Mixing patterns A/B/C in one BC | Choose one, apply consistently |
| Creating abstractions for one-time use | YAGNI — 3 lines > premature abstraction |
| `@Injectable` in domain or UseCase | Only in infrastructure + CQRS handlers |
| `Entity.create()` in mapper | Use `Entity.restore()` to avoid event emission |
| `organizationId` from request body | Always from `@CurrentOrganization()` auth context |
| Writing implementation before test | TDD: red -> green -> refactor |

---

## References

| File | Content |
|---|---|
| `references/tdd-workflow.md` | Test templates and TDD sequence per layer |
| `references/checklist.md` | 30+ item delivery checklist grouped by layer |
| `references/bc-organization.md` | When and how to split a BC into sub-modules |
