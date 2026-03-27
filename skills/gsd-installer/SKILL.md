---
name: gsd-installer
description: Configures a NestJS project to use the nestjs-hexagonal plugin with GSD workflow. Adds skill references to CLAUDE.md, creates GSD-compatible phase templates, and maps GSD phases to plugin agents. Use when setting up a new project with GSD + hexagonal architecture, or when asked to "install hexagonal for GSD", "configure GSD with hexagonal", or "setup nestjs-hexagonal".
argument-hint: (no arguments needed)
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - AskUserQuestion
---

# GSD Installer for nestjs-hexagonal

Configures a NestJS project so that GSD workflows automatically leverage the nestjs-hexagonal plugin's skills and agents.

## What This Does

1. Adds a **skill mapping section** to the project's `CLAUDE.md` so GSD executor agents know which skills to invoke
2. Creates a **GSD roadmap template** with phases that map to plugin agents
3. Optionally updates `.planning/PROJECT.md` if GSD is already initialized

## Step 1: Detect Project State

Check what exists:

```bash
# GSD initialized?
ls .planning/PROJECT.md 2>/dev/null

# CLAUDE.md exists?
ls CLAUDE.md 2>/dev/null

# NestJS project?
ls nest-cli.json 2>/dev/null || ls apps/*/nest-cli.json 2>/dev/null

# Plugin installed?
ls .claude-plugin/plugin.json 2>/dev/null || grep -r "nestjs-hexagonal" ~/.claude/plugins/ 2>/dev/null
```

## Step 2: Add Skill Mapping to CLAUDE.md

Append this section to the project's `CLAUDE.md` (create if not exists):

```markdown
## NestJS Hexagonal Architecture (nestjs-hexagonal plugin)

### Skill Mapping for GSD Phases

When executing GSD phases that involve creating or modifying bounded contexts, use these skills and agents:

| Task | Skill / Agent | Model |
|------|---------------|-------|
| Domain modeling (entities, VOs, events) | `nestjs-hexagonal:domain-agent` | Opus |
| Application layer (use cases, handlers) | `nestjs-hexagonal:application-agent` | Sonnet |
| Infrastructure (repos, modules, adapters) | `nestjs-hexagonal:infrastructure-agent` | Sonnet |
| Presentation (controllers, DTOs, Swagger) | `nestjs-hexagonal:presentation-agent` | Sonnet |
| WebSocket broadcasting | `nestjs-hexagonal:broadcasting-agent` | Sonnet |
| Architecture review | `nestjs-hexagonal:architecture-reviewer` | Opus |
| Full BC scaffold | `nestjs-hexagonal:create-subdomain` | Orchestrator |
| Event chain debugging | `nestjs-hexagonal:event-debug-agent` | Opus |

### Architecture Rules (enforced)

1. Entity extends `AggregateRoot` from `@nestjs/cqrs`
2. Repository is PURE persistence — no event dispatch
3. EventPublisher in Handler only, NEVER in UseCase
4. Module exports ONLY Port tokens
5. class-validator ONLY in presentation request DTOs
6. Write returns void or `{ id: string }`

### GSD Phase Template for Bounded Context

When creating a new bounded context via GSD, use this phase structure:

Phase X: <BC Name> Domain + Application
  - Task 1: Domain modeling (dispatch domain-agent, Opus)
  - Task 2: Application layer (dispatch application-agent, Sonnet)

Phase X+1: <BC Name> Infrastructure + Presentation
  - Task 1: Infrastructure wiring (dispatch infrastructure-agent, Sonnet)
  - Task 2: Presentation layer (dispatch presentation-agent, Sonnet)
  - Task 3: Architecture review (dispatch architecture-reviewer, Opus)
```

## Step 3: Ask About GSD State

If `.planning/PROJECT.md` exists, ask the user:

> "GSD is already initialized. Do you want me to add hexagonal architecture phases to the existing roadmap?"

If yes, read the current `ROADMAP.md` and suggest new phases for bounded context creation.

If GSD is NOT initialized, inform the user:

> "GSD is not initialized yet. Run `/gsd:new-project` first, then re-run this installer to add hexagonal phases."

## Step 4: Verify Installation

After configuration, verify:

```bash
# CLAUDE.md has skill mapping
grep "nestjs-hexagonal" CLAUDE.md

# Plugin is accessible
# (user should test: ask Claude "create an entity for Invoice" and verify domain skill activates)
```

Report what was configured:
- CLAUDE.md updated with skill mapping and architecture rules
- GSD phase template added (if applicable)
- Next steps: run `/gsd:plan-phase` or `/nestjs-hexagonal:create-subdomain`
