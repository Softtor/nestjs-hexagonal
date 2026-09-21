# Delivery Checklist

Run this checklist before declaring the bounded context complete. Every item must pass. FAIL items are blocking; WARNING items are advisory. `<runner>` is the package runner resolved from the lockfile (see "Package runner" in `nestjs-hexagonal:using-nestjs-hexagonal`).

---

## Domain Layer

- [ ] Entity class extends `Entity<Props>` (which extends `AggregateRoot` from `@nestjs/cqrs`)
- [ ] Entity has `private constructor` — instantiation only via `static create()` and `static restore()`
- [ ] `create()` calls `this.apply(new <Name>CreatedEvent(...))` — always, without exception
- [ ] `restore()` does NOT call `this.apply()` — no events emitted on hydration
- [ ] All mutating methods call `this.touch()` and then `this.apply(new <Name>UpdatedEvent(...))`
- [ ] Entity has no `@Injectable`, `@Inject`, or any `@nestjs/common` import
- [ ] Entity has no Prisma imports
- [ ] VOs extend `ValueObject<T>`, have a `private constructor`, and a `protected validate()` method
- [ ] `validate()` in VOs throws `InvalidArgumentError` (not `BadRequestException` or any HTTP exception)
- [ ] VOs are immutable: mutating methods return a new VO instance
- [ ] State machine VOs validate transitions in `transitionTo()` using an `ALLOWED_TRANSITIONS` map
- [ ] Enum VOs provide named static factories (`static pending()`) — callers never pass raw strings directly
- [ ] Repository interface lives in `domain/repositories/` with namespace, TOKEN symbol, and interface only
- [ ] Repository interface has no `@Injectable` or Prisma imports
- [ ] Domain events implement `IEvent` from `@nestjs/cqrs`
- [ ] Domain events contain all data handlers will need (no re-fetching in handlers)
- [ ] Data builders exist in `domain/testing/helpers/` with faker defaults for every required field
- [ ] Entity unit tests pass: `<runner> test` scoped to `domain/entities`
- [ ] VO unit tests pass: `<runner> test` scoped to `domain/value-objects`

---

## Application Layer

- [ ] Correct pattern chosen (A, B, or C) and applied consistently across all operations
- [ ] Pattern A use cases: no `@Injectable`, no NestJS imports, export `TOKEN = Symbol(...)`
- [ ] Pattern B/C handlers: use `@CommandHandler`/`@QueryHandler`, inject `EventPublisher`
- [ ] `EventPublisher` is injected ONLY in CQRS handlers — never in use cases, never in repositories
- [ ] `publisher.mergeObjectContext(entity)` and `entity.commit()` called in handler, after `repo.save()`
- [ ] Write operations return `void` or `{ id: string }` — never the full entity or aggregate
- [ ] DTOs use namespace pattern: `namespace <Op><Context>Dto { Input; Output }`
- [ ] No `class-validator` decorators in DTOs (`application/dtos/`) — TypeScript interfaces only
- [ ] Ports defined in consumer's `application/ports/` with `SYMBOL_TOKEN` exported
- [ ] Application services (`application/services/`) exist only when logic is shared by 2+ handlers
- [ ] Application unit tests pass: `<runner> test` scoped to `application`

---

## Infrastructure Layer

- [ ] Prisma repository is `@Injectable()` and implements the domain repository interface
- [ ] `save()` in Prisma repository checks for existence before deciding create vs update (no bare `upsert`)
- [ ] `search()` always scopes by `organizationId` (or tenant identifier) in `whereClause`
- [ ] `delete()` scopes by both `id` AND the tenant identifier
- [ ] Prisma repository has NO event dispatch — no `entity.commit()`, no `EventBus.publish()`
- [ ] Model mapper `toEntity()` calls `Entity.restore()` — NEVER `Entity.create()`
- [ ] Model mapper `toModel()` returns plain data (no entity methods or prototype chain)
- [ ] In-memory repository exists in `infrastructure/database/in-memory/repositories/`
- [ ] In-memory repository holds state in a `Map<string, Entity>`, no external dependencies
- [ ] Module `imports`: `CqrsModule`, `DatabaseModule`, external modules for ports
- [ ] Module `providers`: Prisma repo class + token alias + handlers + event handlers + adapters + token aliases
- [ ] Module `exports`: ONLY port token Symbols — no use cases, no Prisma classes
- [ ] Adapters implement the port interface from the consumer BC's `application/ports/`
- [ ] Adapters registered with `{ provide: PORT_TOKEN, useExisting: AdapterClass }`
- [ ] Event handlers use `@EventsHandler` + `IEventHandler` — no `@OnEvent` for new code
- [ ] Event handlers wrap `handle()` body in `try/catch` with `Logger.error(...)` — never re-throw
- [ ] `organizationId` present in every Prisma query (multi-tenant isolation enforced at repo level)
- [ ] Infrastructure lint passes: `<runner> lint`
- [ ] Types compile: `<runner> check-types`

---

## Presentation Layer

- [ ] Controller has `@ApiTags`, `@Controller`, `@UseGuards(AuthGuard)`, `@ApiBearerAuth()`
- [ ] Organization context read from `@CurrentOrganization()` decorator — NEVER from request body or params
- [ ] Controller methods contain no business logic — immediate delegation to bus or use case
- [ ] Simple `findById` with no RBAC uses repository directly — no use case needed
- [ ] Request DTOs use `class-validator` decorators: `@IsString()`, `@IsNotEmpty()`, `@IsOptional()`, etc.
- [ ] Request DTOs have `@ApiProperty` (required) and `@ApiPropertyOptional` (optional)
- [ ] `@IsOptional()` appears before other decorators for optional fields
- [ ] Nested DTOs use `@ValidateNested()` + `@Type(() => NestedDto)` (needs `class-transformer`)
- [ ] Array fields use `@IsArray()` + `@ValidateNested({ each: true })` + `@Type(() => ItemDto)`
- [ ] All endpoints have `@ApiOperation({ summary: '...' })` and `@ApiResponse` for each status code
- [ ] Error filter registered: domain `NotFoundError` → 404, `BusinessRuleViolationError` → 422, `ConflictError` → 409
- [ ] Controller registered in the module's `controllers` array
- [ ] Presentation lint + types pass: `<runner> lint && <runner> check-types`
- [ ] Controller unit tests pass: `<runner> test` scoped to `controller`
- [ ] DTO unit tests pass: `<runner> test` scoped to `request.dto`

---

## Cross-Cutting

- [ ] No circular module dependencies (check with `madge` or `nx graph` if available)
- [ ] Naming conventions: `kebab-case` for files, `PascalCase` for classes, `SCREAMING_SNAKE_CASE` for token symbols
- [ ] Multi-tenant: `organizationId` present in every entity, query, and repository operation
- [ ] `<runner> lint` exits with code 0 — zero errors, zero warnings
- [ ] `<runner> check-types` exits with code 0 — zero type errors
- [ ] `<runner> test` passes all tests in the new BC
- [ ] `<runner> build` exits with code 0
- [ ] No `eslint-disable` without a comment explaining why
- [ ] No `as any` or `as unknown` casts
- [ ] `nestjs-hexagonal-check --files '<bc>/**/*.ts' --classes static --strict` exits 0
- [ ] Architecture review (`nestjs-hexagonal:review-subdomain`) reports no FAIL items
