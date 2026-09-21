# Review Rubric

35 checkpoints grouped by dimension. Each checkpoint specifies its **source** — the rulebook rule id that covers it (the finding then comes from `nestjs-hexagonal-check`, steps 1 and 2 of the review) or "residual (agent)" (step 3 performs the check) — plus what to check, how to check it by hand when the CLI is not installed, pass criteria, common violations, and the fix.

Scoring:
- **PASS** — no issues found
- **WARNING** — improvement opportunity, not a blocking violation
- **FAIL** — architectural violation; must be fixed before the BC is merged

---

## Dimension 1 — Domain Purity (7 checkpoints)

### D1 — No @nestjs/common imports in domain

**Source:** hex/domain-no-nest-decorators (static)

| Field | Value |
|---|---|
| Command | `grep -r "@nestjs/common" <BC_PATH>/domain/ --include="*.ts" -l` |
| Pass | Zero files returned |
| FAIL | Any file in `domain/` imports from `@nestjs/common` |
| Common violation | `@Injectable()` on a VO or domain service; `NotFoundException` thrown from an entity |
| Fix | Remove the decorator; throw `InvalidArgumentError` or `NotFoundError` from `@/shared/domain-errors/` instead |
| Exception | `@nestjs/cqrs` is allowed: `AggregateRoot`, `IEvent` |

### D2 — No class-validator in value objects

**Source:** hex/vo-no-class-validator (static)

| Field | Value |
|---|---|
| Command | `grep -r "class-validator" <BC_PATH>/domain/value-objects/ --include="*.ts" -l` |
| Pass | Zero files returned |
| FAIL | Any VO file imports from `class-validator` |
| Common violation | `@IsEmail()`, `@IsNotEmpty()` used inside a VO class |
| Fix | Replace with manual validation in `protected validate()`: `if (!regex.test(this._value)) throw new InvalidArgumentError(...)` |
| Exception | `domain/validators/` may use `class-validator` via `ClassValidatorFields` — that is the approved pattern |

### D3 — No Prisma in domain

**Source:** hex/domain-no-nest-decorators (static)

| Field | Value |
|---|---|
| Command | `grep -r "PrismaClient\|PrismaService\|@prisma/client" <BC_PATH>/domain/ --include="*.ts" -l` |
| Pass | Zero files returned |
| FAIL | Any domain file imports Prisma |
| Common violation | Repository interface imports the Prisma model type for its return type |
| Fix | Define a plain TypeScript interface or use the entity class as the return type |

### D4 — Entity uses apply() not addDomainEvent()

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "addDomainEvent\|pullDomainEvents" <BC_PATH>/domain/ --include="*.ts" -l` |
| Pass | Zero files returned |
| FAIL | Entity calls `addDomainEvent()` or `pullDomainEvents()` |
| Common violation | Legacy pattern from non-NestJS-CQRS implementations |
| Fix | Replace with `this.apply(event)` in entity methods; handler calls `publisher.mergeObjectContext(entity)` + `entity.commit()` |

### D5 — Entity has create(), restore(), and private constructor

**Source:** hex/entity-unique-id (static) for the id; create/restore/private constructor: residual (agent)

| Field | Value |
|---|---|
| How to check | Read each file in `<BC_PATH>/domain/entities/` |
| Pass | Every entity has `static create(`, `static restore(`, and `private constructor` |
| FAIL | Any entity missing one of the three |
| Common violation | Only `static create()` defined; restore() absent so mapper falls back to `create()` |
| Fix | Add `static restore(props, id)` that calls `new Entity(props, id)` without any `apply()` call |

### D6 — Repository interface is pure (no @Injectable, no implementation)

**Source:** hex/repo-interface-in-domain, hex/domain-no-nest-decorators (static)

| Field | Value |
|---|---|
| Command | `grep -r "@Injectable\|class.*implements" <BC_PATH>/domain/repositories/ --include="*.ts" -l` |
| Pass | Zero files implementing (concrete class) or decorating with `@Injectable` |
| FAIL | A concrete repository class lives in `domain/repositories/` |
| Common violation | Prisma repository placed in domain instead of infrastructure |
| Fix | Move concrete repository to `infrastructure/database/prisma/repositories/`; keep only the interface in domain |

### D7 — Data builders exist for each entity

**Source:** hex/tests-use-builders (static)

| Field | Value |
|---|---|
| Command | `ls <BC_PATH>/domain/testing/helpers/` |
| Pass | At least one `*.data-builder.ts` file per entity |
| WARNING | Directory empty or missing |
| Common violation | Tests hardcode fixture objects instead of using builders |
| Fix | Create `<Name>DataBuilder(overrides?)` in `domain/testing/helpers/<name>.data-builder.ts` |

---

## Dimension 2 — Application Patterns (6 checkpoints)

### A1 — EventPublisher only in CQRS handlers

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "EventPublisher" <BC_PATH>/application/usecases/ --include="*.ts" -l` |
| Pass | Zero results |
| FAIL | `EventPublisher` found in a use case file |
| Common violation | UseCase injects EventPublisher and calls `entity.commit()` internally |
| Fix | Move `publisher.mergeObjectContext(entity)` and `entity.commit()` to the command handler; use case returns the entity |

### A2 — No class-validator in application layer

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -rE "IsString|IsNotEmpty|IsEmail|IsOptional|IsUUID|IsEnum|IsNumber|IsBoolean|IsArray|ValidateNested" <BC_PATH>/application/ --include="*.ts" -l` |
| Pass | Zero results |
| FAIL | Any application DTO or use case uses class-validator decorators |
| Common violation | Application DTO reused as both the HTTP request DTO and the use-case input DTO |
| Fix | Separate request DTOs (presentation, with decorators) from application DTOs (pure TypeScript interfaces) |

### A3 — Pattern A use cases have no @Injectable

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "@Injectable" <BC_PATH>/application/usecases/ --include="*.ts" -l` |
| Pass | Zero results |
| FAIL | Use case class decorated with `@Injectable()` |
| Common violation | Developer treated the use case as a NestJS service |
| Fix | Remove `@Injectable()`; wire via `useFactory` in the module |

### A4 — Write handlers return void or { id: string }

**Source:** hex/handler-no-business-rules (semantic) for the body; return type: residual (agent)

| Field | Value |
|---|---|
| How to check | Read each command handler; inspect the `execute()` return type |
| Pass | Return type is `void`, `Promise<void>`, `{ id: string }`, or `Promise<{ id: string }>` |
| FAIL | Return type is a full entity or a DTO with many fields |
| Common violation | Handler returns the entity directly to avoid writing an output mapper |
| Fix | Map to `{ id: entity.id }` in the handler; use a query to fetch full data |

### A5 — commit() called in handlers, not in use cases

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "\.commit()" <BC_PATH>/application/usecases/ --include="*.ts" -l` |
| Pass | Zero results |
| FAIL | `.commit()` found in a use case file |
| Common violation | UseCase commits events to keep the handler thin |
| Fix | Move `entity.commit()` to the handler, after `publisher.mergeObjectContext(entity)` |

### A6 — Ports have TOKEN symbols

**Source:** hex/port-no-infra-leak (semantic) for the signature; TOKEN symbol: residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "Symbol(" <BC_PATH>/application/ports/ --include="*.ts" -l` |
| Pass | Every port file exports a `Symbol(...)` constant |
| WARNING | Port file present without a Symbol token |
| Common violation | Port interface defined but token missing; injecting by class type instead |
| Fix | Add `export const <DEPENDENCY>_PORT_TOKEN = Symbol('<DependencyPort>');` to each port file |

---

## Dimension 3 — Infrastructure Isolation (7 checkpoints)

### I1 — Module exports only port token symbols

**Source:** hex/module-exports-ports-only (static)

| Field | Value |
|---|---|
| How to check | Read `<BC_PATH>/infrastructure/*.module.ts`; inspect the `exports:` array |
| Pass | Only Symbol constants (token variables) in exports |
| FAIL | A class name (e.g., `PrismaOrderRepository`, `CreateOrderUseCase`) in exports |
| Common violation | Repository class exported for convenience in tests |
| Fix | Export only the token: `exports: [ORDER_REPOSITORY]`; consumers inject by token |

### I2 — Repository has no event dispatch

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -rE "\.commit\(\)|EventBus|EventPublisher|\.publish\(" <BC_PATH>/infrastructure/database/ --include="*.ts" -l` |
| Pass | Zero results |
| FAIL | Event dispatch found in a repository file |
| Common violation | Repository calls `eventBus.publish(event)` after save |
| Fix | Remove event dispatch from repository; handler owns commit via `entity.commit()` |

### I3 — Model mapper calls restore() not create()

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -rE "Entity\.create\(|\.create\(" <BC_PATH>/infrastructure/database/prisma/models/ --include="*.ts" -l` |
| Pass | Zero entity `create()` calls in mapper files |
| FAIL | Mapper calls `Entity.create()` |
| Common violation | Mapper calls `create()` because `restore()` was not added to the entity |
| Fix | Add `static restore()` to the entity; update mapper to call `Entity.restore(props, model.id)` |

### I4 — In-memory repository exists

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `ls <BC_PATH>/infrastructure/database/in-memory/repositories/` |
| Pass | At least one `*.repository.ts` file |
| WARNING | Directory empty or missing |
| Common violation | Tests mock the interface instead of using a real in-memory implementation |
| Fix | Create `<Context>InMemoryRepository` holding a `Map<string, Entity>`; use it in application unit tests |

### I5 — Event handlers use @EventsHandler not @OnEvent

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "@OnEvent" <BC_PATH>/infrastructure/listeners/ --include="*.ts" -l` |
| Pass | Zero results |
| FAIL | `@OnEvent` found in listener files |
| Common violation | Using `EventEmitter2` pattern instead of NestJS CQRS event bus |
| Fix | Replace `@OnEvent('...')` with `@EventsHandler(EventClass)` and implement `IEventHandler<EventClass>` |

### I6 — Event handlers have try/catch

**Source:** residual (agent)

| Field | Value |
|---|---|
| How to check | Read each file in `<BC_PATH>/infrastructure/listeners/`; confirm `handle()` has `try {` |
| Pass | Every `handle()` method is wrapped in `try/catch` |
| FAIL | `handle()` method has no error handling |
| Common violation | Uncaught exception in a handler kills the process or blocks the event bus |
| Fix | Wrap body in `try { ... } catch (error) { this.logger.error(...) }` |

### I7 — Prisma search() scopes by tenant

**Source:** softtor/tenant-scoped-query (static) when the project extends softtor-conventions; otherwise residual (agent)

| Field | Value |
|---|---|
| How to check | Read each Prisma repository; check `search()` and `findMany()` calls for `organizationId` |
| Pass | `organizationId` (or tenant field) present in every `findMany` / `count` `where` clause |
| WARNING | `search()` returns records from all tenants |
| Common violation | `where` clause has no tenant scoping; cross-tenant data leaks |
| Fix | Add `organizationId: props.filter?.organizationId` to the `whereClause` object |

---

## Dimension 4 — Presentation Concerns (5 checkpoints)

### P1 — class-validator only in request DTOs

**Source:** hex/vo-no-class-validator (static) for VOs; presence in request DTOs: residual (agent)

| Field | Value |
|---|---|
| How to check | Confirm class-validator imports are only in `<BC_PATH>/infrastructure/controllers/dtos/` |
| Pass | class-validator imports found only in DTO files inside `dtos/` |
| WARNING | No class-validator found anywhere in presentation (missing validation) |
| FAIL | class-validator found in a controller file or in application DTOs |
| Fix | Move validation decorators to the request DTO class |

### P2 — organizationId not from request body

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -rE "body\.organizationId|dto\.organizationId|req\.body.*organizationId" <BC_PATH>/infrastructure/controllers/ --include="*.ts" -l` |
| Pass | Zero results |
| FAIL | Controller reads `organizationId` from request body |
| Common violation | Frontend passes `organizationId` in the body; controller trusts it |
| Fix | Read from `@CurrentOrganization()` decorator; remove `organizationId` from request DTO |

### P3 — Swagger decorators present

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "@ApiOperation\|@ApiResponse\|@ApiTags" <BC_PATH>/infrastructure/controllers/ --include="*.ts" -l` |
| Pass | Files returned — Swagger decorators present |
| WARNING | No Swagger decorators found |
| Fix | Add `@ApiTags`, `@ApiOperation({ summary })`, and `@ApiResponse({ status, description })` to all endpoints |

### P4 — Guards applied to controller

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "@UseGuards\|@ApiBearerAuth" <BC_PATH>/infrastructure/controllers/ --include="*.ts" -l` |
| Pass | Files returned — guards applied |
| WARNING | No guards found — endpoints are publicly accessible |
| Fix | Add `@UseGuards(AuthGuard)` and `@ApiBearerAuth()` at the controller class level |

### P5 — No business logic in controller methods

**Source:** hex/controller-thin (semantic)

| Field | Value |
|---|---|
| How to check | Read each controller; flag direct repository calls or entity instantiation inside controller methods |
| Pass | Controller methods delegate immediately to `commandBus.execute()` or `queryBus.execute()` |
| FAIL | Business logic conditions, direct repository calls, or entity creation in controller body |
| Fix | Extract logic into a use case or command handler; controller method should be 2–4 lines |

---

## Dimension 5 — Testing Coverage (5 checkpoints)

### T1 — Entity specs exist

**Source:** residual (agent); hex/tests-coverage is a runtime rule, inert in this version

| Field | Value |
|---|---|
| Command | `find <BC_PATH>/domain/entities/__tests__ -name "*.spec.ts" 2>/dev/null` |
| Pass | At least one spec file per entity |
| WARNING | No spec files |
| Fix | Add entity spec covering `create()`, `restore()`, and each mutating method (see `create-subdomain/references/tdd-workflow.md`) |

### T2 — VO specs exist

**Source:** residual (agent); hex/tests-coverage is a runtime rule, inert in this version

| Field | Value |
|---|---|
| Command | `find <BC_PATH>/domain/value-objects/__tests__ -name "*.spec.ts" 2>/dev/null` |
| Pass | Spec files present for each non-trivial VO |
| WARNING | VO files exist but no specs |
| Fix | Add VO spec covering valid construction, each validation error, and equality |

### T3 — Application specs exist

**Source:** residual (agent); hex/tests-coverage is a runtime rule, inert in this version

| Field | Value |
|---|---|
| Command | `find <BC_PATH>/application -name "*.spec.ts" 2>/dev/null` |
| Pass | At least one spec per use case or command handler |
| WARNING | No application specs |
| Fix | Add use case or handler spec using the in-memory repository (see tdd-workflow.md) |

### T4 — Controller specs exist

**Source:** residual (agent); hex/tests-coverage is a runtime rule, inert in this version

| Field | Value |
|---|---|
| Command | `find <BC_PATH>/infrastructure/controllers/__tests__ -name "*.spec.ts" 2>/dev/null` |
| Pass | Spec file per controller |
| WARNING | Controllers exist but no specs |
| Fix | Add controller spec mocking CommandBus/QueryBus |

### T5 — In-memory repository used in application tests

**Source:** hex/tests-use-builders (static) for builders; in-memory repository usage: residual (agent)

| Field | Value |
|---|---|
| Command | `grep -r "InMemoryRepository" <BC_PATH>/application --include="*.spec.ts" -l` |
| Pass | In-memory repo referenced in application specs |
| WARNING | Application specs exist but use raw mocks or `vi.mock()` for the repository |
| Fix | Replace repository mock with `<Context>InMemoryRepository` for more realistic tests |

---

## Dimension 6 — Module Organization (5 checkpoints)

### M1 — Standard directories present

**Source:** residual (agent)

| Field | Value |
|---|---|
| How to check | Verify `domain/entities/`, `domain/repositories/`, `domain/events/`, `application/`, `infrastructure/` |
| Pass | All standard directories present |
| WARNING | One or more standard directories missing |
| Fix | Create the missing directory; move misplaced files to the correct location |

### M2 — Module file exists in infrastructure

**Source:** residual (agent)

| Field | Value |
|---|---|
| Command | `find <BC_PATH>/infrastructure -maxdepth 1 -name "*.module.ts" 2>/dev/null` |
| Pass | At least one `*.module.ts` found |
| FAIL | No module file found |
| Fix | Create `<Context>Module` with `@Module({ imports, controllers, providers, exports })` |

### M3 — No cross-layer imports (domain/application importing infrastructure)

**Source:** hex/domain-no-nest-decorators, hex/no-circular-import (static)

| Field | Value |
|---|---|
| Commands | `grep -r "from.*infrastructure" <BC_PATH>/domain/ --include="*.ts" -l`; `grep -r "from.*infrastructure" <BC_PATH>/application/ --include="*.ts" -l` |
| Pass | Zero results |
| FAIL | Domain or application imports from infrastructure |
| Common violation | Domain event handler imports a Prisma repository |
| Fix | Use dependency inversion: define a port interface; inject via token |

### M4 — File naming conventions

**Source:** residual (agent)

| Field | Value |
|---|---|
| How to check | Spot-check 3–5 files per layer against naming conventions |
| Pass | `kebab-case` file names; entity files end in `.entity.ts`; VO files end in `.vo.ts`; event files follow `<name>-<verb>ed.event.ts`; handler files end in `.handler.ts` |
| WARNING | Inconsistent naming (e.g., `OrderService.ts` instead of `order.service.ts`) |
| Fix | Rename files to follow conventions; update all imports |

### M5 — No circular dependencies

**Source:** hex/no-circular-import (static); forwardRef in module imports: residual (agent)

| Field | Value |
|---|---|
| How to check | If `madge` or `nx graph` is available: `npx madge --circular <BC_PATH>`; otherwise, manually inspect module imports |
| Pass | No circular dependency detected |
| FAIL | Circular dependency detected |
| Common violation | Two sub-modules import each other's repositories directly |
| Fix | Break the cycle with a port: consumer defines the port, provider exports the token |
