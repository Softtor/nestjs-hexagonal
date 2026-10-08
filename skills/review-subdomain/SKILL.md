---
name: review-subdomain
description: Reviews a NestJS bounded context for Hexagonal Architecture + DDD + CQRS compliance in three steps — static rulebook via nestjs-hexagonal-check, semantic rulebook via Jev (one batch per file, skipped without a key) and a residual review by the architecture-reviewer agent for what the rulebook cannot decide. Produces a structured Pass/Warning/Fail report where every finding cites its rule id or "residual".
argument-hint: Path to the bounded context directory (e.g., "src/enterprise/billing/invoices")
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# review-subdomain

Review a bounded context for architectural compliance. Accept the BC path as the argument (e.g., `src/enterprise/billing/invoices`). The rulebook decides everything it can decide; the agent reviews only the rest. Produce the structured report at the end.

The rubric in `references/review-rubric.md` lists the 35 checks; each one is marked with the rule id that covers it or with "residual (agent)".

---

## Setup

Resolve the target directory from the argument. If no argument is given, ask the user for the path.

```bash
ls <bc-path>
```

If the directory does not exist, stop and report an error. Set `BC_PATH` to the resolved path relative to the project root (the CLI reports paths relative to the current directory). Locate the checker:

```bash
bunx nestjs-hexagonal-check --help >/dev/null 2>&1 && echo bunx || ls node_modules/.bin/nestjs-hexagonal-check
```

If neither works, the plugin is not installed in this project: skip steps 1 and 2, run the whole rubric by hand in step 3, and say in the report that the rulebook did not run.

---

## Step 1 — Static rulebook (offline)

```bash
bunx nestjs-hexagonal-check --rulebook hexagonal --files '<BC_PATH>/**/*.ts' --classes static --format json > /tmp/review-static.json
```

- Drop `--rulebook hexagonal` when the project has `.claude/rulebook.yaml` (the project rulebook is picked up by default; `--project-rulebook <path>` points at another file). The project rulebook adds its own rules and overrides and decides whether `softtor-conventions` (tenant scoping, no emoji, English identifiers) applies.
- Every finding carries `ruleId`, `severity` (`FAIL`/`WARN`), `path`, `line`, `evidence` and `fix`. Static FAILs are blocking and are reported verbatim; do not re-check them by hand.
- `warnings` lists composition problems (a stale sha256 stamp marks the run `uncalibrated`; an `external` check without executor is skipped).

## Step 2 — Semantic rulebook (Jev, one batch per file)

```bash
bunx nestjs-hexagonal-check --rulebook hexagonal --files '<BC_PATH>/**/*.ts' --classes semantic --format json > /tmp/review-semantic.json
```

- The engine sends one request per file and state slice with every semantic rule that applies to that file (`hex/handler-no-business-rules`, `hex/port-no-infra-leak`, `hex/entity-not-anemic`, `hex/controller-thin`, `hex/no-overengineering`). Add `--explain` to see the questions and the slice sent.
- Without `TYPESAFE_API_KEY` (or the plugin's `TYPESAFE_API_KEY` option) the CLI prints `TYPESAFE_API_KEY is not set; skipped N semantic rule(s)` and `skipped.semantic` lists the rule ids. Say so in the report; those checks then fall to step 3.
- Each semantic finding carries a `decision`: `deny` (only with fitted thresholds; `--strict` would exit 1), `ask`, `advise`, `uncertain` (probability inside the abstention band or low confidence) or `uncalibrated` (model differs from the pin or a stamp mismatch). `semantic.undecided` lists batches Jev could not answer (timeout, HTTP error). Nothing semantic blocks in this version.

## Step 3 — Residual review (agent)

Dispatch `nestjs-hexagonal:architecture-reviewer` (Claude Opus 5.5) with `BC_PATH` and the two JSON files. Its judgment covers only:

1. semantic outcomes `uncertain`, `uncalibrated` and the `undecided` batches, plus the semantic rules skipped for lack of a key;
2. semantic findings with severity WARN (`advise`/`ask`): confirm or dismiss with evidence;
3. the rubric checks marked "residual (agent)" in `references/review-rubric.md` (D4, D5 factories, A1-A3, A5, I2-I6, P1-P4, T1-T4, M1, M2, M4, tenant scoping when `softtor-conventions` is not extended) and cross-file concerns the rulebook cannot decide from one file: multi-hop tenant scoping, empty directories, event mapping tables with fewer than 5 entries.

When the checker is not installed, the agent runs the full rubric instead and tags every finding `residual`.

---

## Rubric reference

The dimensions below are the checks the report is organised by. For each check the rubric names the rule id that covers it (then the finding comes from step 1 or 2, quoted with its id) or "residual (agent)" (then step 3 performs the check). The commands are kept as the manual fallback for a project without the CLI.

## Dimension 1 — Domain Purity

**Purpose:** Confirm the domain layer has zero framework or infrastructure dependencies.

Run the following checks against `<BC_PATH>/domain/`:

**Check D1 — No NestJS common imports in domain:**
```bash
grep -r "@nestjs/common" <BC_PATH>/domain/ --include="*.ts" -l
```
FAIL if any files are returned. Exception: `@nestjs/cqrs` is allowed (for `AggregateRoot`, `IEvent`).

**Check D2 — No class-validator in VOs:**
```bash
grep -r "class-validator" <BC_PATH>/domain/value-objects/ --include="*.ts" -l
```
FAIL if any files are returned. `class-validator` is allowed in `domain/validators/` only.

**Check D3 — No Prisma imports in domain:**
```bash
grep -r "PrismaClient\|PrismaService\|@prisma/client" <BC_PATH>/domain/ --include="*.ts" -l
```
FAIL if any files are returned.

**Check D4 — Entity uses apply() not addDomainEvent():**
```bash
grep -r "addDomainEvent\|pullDomainEvents" <BC_PATH>/domain/ --include="*.ts" -l
```
FAIL if any files are returned. Entities must use `this.apply(event)`.

**Check D5 — Entity has create() and restore() factories:**

For each entity file found in `<BC_PATH>/domain/entities/`:
- Read the file
- Confirm `static create(` is present
- Confirm `static restore(` is present
- Confirm `private constructor` is present

FAIL if any entity is missing one of these.

**Check D6 — Repository interface is a pure interface (no @Injectable):**
```bash
grep -r "@Injectable" <BC_PATH>/domain/repositories/ --include="*.ts" -l
```
FAIL if any files are returned.

**Check D7 — Data builders exist:**
```bash
ls <BC_PATH>/domain/testing/helpers/
```
WARNING if the directory is empty or does not exist.

---

## Dimension 2 — Application Patterns

**Purpose:** Confirm the application layer follows the chosen pattern correctly and does not hold framework concerns.

**Check A1 — EventPublisher not in use cases:**
```bash
grep -r "EventPublisher" <BC_PATH>/application/ --include="*.ts" -l
```
FAIL if `EventPublisher` appears in `application/usecases/` or `application/dtos/`. It is allowed in `application/commands/` (Pattern B/C handlers).

**Check A2 — No class-validator in application DTOs:**
```bash
grep -r "IsString\|IsNotEmpty\|IsEmail\|IsOptional\|IsUUID\|IsEnum\|IsNumber\|IsBoolean\|IsArray\|ValidateNested" <BC_PATH>/application/ --include="*.ts" -l
```
FAIL if any files are returned. `class-validator` belongs only in presentation request DTOs.

**Check A3 — Pattern A use cases have no @Injectable:**

Find files matching `<BC_PATH>/application/usecases/*.usecase.ts`:
```bash
grep -r "@Injectable" <BC_PATH>/application/usecases/ --include="*.ts" -l
```
FAIL if `@Injectable` appears in use case files.

**Check A4 — Write handlers return void or { id: string }:**

Read each command handler in `<BC_PATH>/application/commands/`:
- Check the return type annotation on `execute()`
- FAIL if return type is an entity class or a full output DTO with many fields
- PASS if return type is `void`, `Promise<void>`, `{ id: string }`, or `Promise<{ id: string }>`

**Check A5 — commit() called in handlers, not in use cases:**
```bash
grep -r "\.commit()" <BC_PATH>/application/usecases/ --include="*.ts" -l
```
FAIL if `.commit()` appears in use case files.

**Check A6 — Ports defined in application/ports/ with TOKEN symbol:**

Find files in `<BC_PATH>/application/ports/`:
- Each port file should export a `Symbol` token
```bash
grep -r "Symbol(" <BC_PATH>/application/ports/ --include="*.ts" -l
```
WARNING if port files exist without a `Symbol(` token export.

---

## Dimension 3 — Infrastructure Isolation

**Purpose:** Confirm infrastructure wires domain to the outside world without leaking domain logic.

**Check I1 — Module exports only tokens:**

Read `<BC_PATH>/infrastructure/*.module.ts`:
- Find the `exports:` array
- FAIL if any class name (not a Symbol constant) appears in the exports array
- PASS if exports contains only token constants (e.g., `<NAME>_REPOSITORY`, `<DEPENDENCY>_PORT_TOKEN`)

**Check I2 — Repository has no event dispatch:**
```bash
grep -r "\.commit()\|EventBus\|EventPublisher\|publish(" <BC_PATH>/infrastructure/database/ --include="*.ts" -l
```
FAIL if any of these appear in repository files.

**Check I3 — Mapper uses restore() not create():**
```bash
grep -r "Entity\.create\|\.create(" <BC_PATH>/infrastructure/database/prisma/models/ --include="*.ts" -l
```
FAIL if entity `create()` is called inside a mapper. Mappers must call `restore()`.

**Check I4 — In-memory repository exists:**
```bash
ls <BC_PATH>/infrastructure/database/in-memory/repositories/
```
WARNING if directory is empty or missing.

**Check I5 — Event handlers use @EventsHandler not @OnEvent:**
```bash
grep -r "@OnEvent" <BC_PATH>/infrastructure/listeners/ --include="*.ts" -l
```
FAIL if `@OnEvent` is used in listeners. All new domain event handlers must use `@EventsHandler`.

**Check I6 — Event handlers have try/catch:**

Read each file in `<BC_PATH>/infrastructure/listeners/`:
- FAIL if `handle()` method does not contain a `try {` block

**Check I7 — organizationId (or tenant id) in all Prisma queries:**

Read each Prisma repository file in `<BC_PATH>/infrastructure/database/prisma/repositories/`:
- Check `search()` has `organizationId` (or tenant field) in `whereClause`
- WARNING if `search()` does not scope by tenant

---

## Dimension 4 — Presentation Concerns

**Purpose:** Confirm controllers are thin HTTP adapters and request DTOs hold all input validation.

**Check P1 — class-validator used only in request DTOs:**
```bash
grep -r "IsString\|IsNotEmpty\|IsEmail\|IsOptional\|IsUUID\|IsEnum\|ValidateNested" <BC_PATH>/infrastructure/controllers/dtos/ --include="*.ts" -l
```
This should return files. If no files returned: WARNING (validation may be missing).
```bash
grep -r "IsString\|IsNotEmpty\|IsEmail\|IsOptional\|IsUUID\|IsEnum\|ValidateNested" <BC_PATH>/infrastructure/controllers/ --include="*.ts" -l
```
Cross-check: all results should be inside `dtos/`, not in the controller itself.

**Check P2 — organizationId not taken from request body:**
```bash
grep -r "body\.organizationId\|dto\.organizationId\|req\.body.*organizationId" <BC_PATH>/infrastructure/controllers/ --include="*.ts" -l
```
FAIL if `organizationId` is read from the request body in a controller. Must come from `@CurrentOrganization()`.

**Check P3 — Swagger decorators present:**
```bash
grep -r "@ApiOperation\|@ApiResponse\|@ApiTags" <BC_PATH>/infrastructure/controllers/ --include="*.ts" -l
```
WARNING if no Swagger decorators found in controller files.

**Check P4 — Guards applied:**
```bash
grep -r "@UseGuards\|@ApiBearerAuth" <BC_PATH>/infrastructure/controllers/ --include="*.ts" -l
```
WARNING if no guards found on any controller.

**Check P5 — No business logic in controllers:**

Read each controller file. Flag as FAIL if any of these patterns appear directly in a controller method (not in a called service):
- Direct repository calls (`this.repository.findById`)
- Domain entity instantiation (`XxxEntity.create`)
- Business rule conditions beyond simple null checks

---

## Dimension 5 — Testing Coverage

**Purpose:** Confirm test files exist and follow the test-first structure.

**Check T1 — Entity spec files exist:**
```bash
find <BC_PATH>/domain/entities/__tests__ -name "*.spec.ts" 2>/dev/null
```
WARNING if no spec files found.

**Check T2 — VO spec files exist:**
```bash
find <BC_PATH>/domain/value-objects/__tests__ -name "*.spec.ts" 2>/dev/null
```
WARNING if VO files exist but no specs.

**Check T3 — Application spec files exist:**
```bash
find <BC_PATH>/application -name "*.spec.ts" 2>/dev/null
```
WARNING if application layer has no specs.

**Check T4 — Controller spec files exist:**
```bash
find <BC_PATH>/infrastructure/controllers/__tests__ -name "*.spec.ts" 2>/dev/null
```
WARNING if controllers exist but no specs.

**Check T5 — In-memory repository used in application tests:**
```bash
grep -r "InMemoryRepository" <BC_PATH>/application --include="*.spec.ts" -l
```
WARNING if application specs exist but none use the in-memory repository.

---

## Dimension 6 — Module Organization

**Purpose:** Confirm the directory structure and naming conventions are correct.

**Check M1 — Standard directories present:**

Verify these paths exist under `BC_PATH`:
- `domain/entities/`
- `domain/repositories/`
- `domain/events/`
- `application/`
- `infrastructure/`

WARNING for each missing standard directory.

**Check M2 — Module file exists:**
```bash
find <BC_PATH>/infrastructure -maxdepth 1 -name "*.module.ts" 2>/dev/null
```
FAIL if no module file found.

**Check M3 — No cross-layer imports (domain importing infrastructure):**
```bash
grep -r "from.*infrastructure\|require.*infrastructure" <BC_PATH>/domain/ --include="*.ts" -l
grep -r "from.*infrastructure\|require.*infrastructure" <BC_PATH>/application/ --include="*.ts" -l
```
FAIL if domain or application imports from infrastructure.

**Check M4 — File naming conventions:**

Spot-check a few files:
- Entity files: `<name>.entity.ts`
- VO files: `<name>.vo.ts`
- Event files: `<name>-<verb>ed.event.ts`
- Handler files: `<name>.handler.ts` or `<name>-<verb>ed.handler.ts`
- Repository files: `<name>.repository.ts`, `prisma-<name>.repository.ts`

WARNING if files deviate significantly from these naming conventions.

---

## Report Format

Produce a structured markdown report from the two JSON files plus the residual review. A dimension is FAIL when any static FAIL or semantic `deny` maps to it, WARNING when only WARN findings, `advise`/`ask` decisions or residual warnings map to it, PASS otherwise. Every finding cites its source: the rule id for steps 1 and 2, `residual` for step 3.

```
# Architecture Review: <BC_PATH>

## Rulebook run

- Rulebook: <id> <version> (uncalibrated: yes/no); static: X FAIL, Y WARN; semantic: N deny, N ask, N advise, N uncertain, N uncalibrated, N undecided (or "skipped: no key" / "CLI not installed")

## Summary

| Dimension | Status |
|---|---|
| Domain Purity | PASS / FAIL |
| Application Patterns | PASS / FAIL |
| Infrastructure Isolation | PASS / FAIL |
| Presentation Concerns | PASS / WARNING |
| Testing Coverage | PASS / WARNING |
| Module Organization | PASS / FAIL |

Overall: PASS / NEEDS WORK

---

## Findings

### FAIL Items (must fix before merge)

- **[D1 · hex/domain-no-nest-decorators] Domain has no framework or infrastructure imports:** `domain/entities/order.entity.ts:3` — evidence: `import { Injectable } from '@nestjs/common'`
  Fix: <the rule's fix text>

- **[I1 · hex/module-exports-ports-only] Module exports only tokens:** `infrastructure/orders.module.ts:41` — evidence: `PrismaOrderRepository` in exports
  Fix: Change to `exports: [ORDER_REPOSITORY]`.

### WARNING Items (recommended improvements)

- **[P5 · hex/controller-thin · advise 0.71] Controller method contains logic:** `infrastructure/controllers/orders.controller.ts:52`
  Residual judgment: confirmed — the method branches on `order.status` before dispatching.

- **[T1 · residual] Entity spec files:** No spec files found in `domain/entities/__tests__/`
  Recommendation: Add entity unit tests covering `create()`, `restore()`, and each mutating method.

### Undecided by the rulebook (resolved by hand)

- **[A4 · hex/handler-no-business-rules · uncertain 0.48]** `application/commands/cancel-order.handler.ts` — judged OK: the branch only maps an error to a result.

### PASS Items

- Domain purity: no static findings for hex/domain-no-nest-decorators
- Application DTOs: no class-validator found (residual)
- Mapper uses restore(): confirmed in `order-model.mapper.ts` (residual)
- Module exports: no findings for hex/module-exports-ports-only
```

---

## After the Report

- FAIL items are blocking — the BC is not ready to merge until all FAILs are resolved. A static FAIL is also what the plugin hooks deny and block on, so a BC with static FAILs will not get through `create-subdomain` either.
- WARNING items are advisory — present them to the user and ask whether to address now or log as tech debt.
- If all items are PASS or WARNING: report the BC as architecture-compliant.

Suggest specific fixes for each FAIL item: the rule's own `fix` text first, then the relevant layer skill (`nestjs-hexagonal:domain`, `nestjs-hexagonal:application`, etc.) for implementation guidance. A rule that keeps producing false positives on this project is a candidate for an override in `.claude/rulebook.yaml` (`disabled`, `severity`, `scope`), or for recalibration through `nestjs-hexagonal:jev-eval` when it is semantic.
