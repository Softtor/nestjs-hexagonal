# Fluent Event Dispatcher Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for runtime implementation; independent documentation and checker work can follow superpowers:dispatching-parallel-agents.

**Goal:** Ship the previously designed broker-neutral dispatcher and migrate plugin guidance for v1.4.0.

**Architecture:** Copyable, tested templates, no runtime package. Pure entities queue events; handlers dispatch after persistence/transaction commit. The NestJS container supplies a publisher; adapters own transport and serialization.

**Tech Stack:** TypeScript, RxJS, NestJS CQRS adapters, Bun tests.

**Spec:** `docs/superpowers/specs/2026-10-08-fluent-event-dispatcher-design.md` (recovered original plan; continuation explicitly requested).

## Global Constraints

- `.event()` is the fluent entry point. Named payloads require `.with()`; instances retain identity/prototype and have no `.with()`.
- `publish(): Promise<void>` and cold `publish$(): Observable<void>`; sync/Promise/Observable publisher returns are normalized on completion, including empty completion, with no retries.
- `Entity.apply()` queues only; `getUncommittedEvents()` returns a snapshot and `acknowledgeEvent(event)` removes just that entry after successful completion.
- Port token `EVENT_PUBLISHER_TOKEN`; dispatcher token `EVENT_DISPATCHER_TOKEN`. No NestJS imports in entities, RxJS only in application templates.
- Named/instance request discriminant `kind`, common `name`, `eventId`, `occurredAt: Date`, optional `key`; `payload` for named requests and `event` for instances.
- Templates live in `shared/events/` (port/dispatcher/memory) and `shared/infrastructure/` (Nest adapters). Pure base templates remain in `shared/base-classes/`.
- Keep legacy pattern recognition. Do not implement the separate repository backlog.
- Three manifests/changelog release 1.4.0; PR, passing CI, merge, tag/release already authorized in original request.

## Review Focus

- Partial publisher completion and cancellation must retain undelivered queued events.
- Concurrent publication of one entity must not silently duplicate or remove events.
- Named events without EventBus factories must fail rather than lose class listener routing.
- Type checking must consume actual copied templates, not test doubles.
- Semantic calibration must not reuse fitted thresholds when the rulebook stamp changes.

### Task 1: Runtime templates and integration examples

**Files:** shared/events/*.ts.example; shared/base-classes/{entity,domain-event}.ts.example; shared/infrastructure/*event*publisher*.ts.example; examples/order-bounded-context/**; scripts/__tests__/event-dispatcher.spec.ts; package.json/bun.lock/tsconfig.json/.github/workflows/ci.yml.

**Interfaces:** Produces typed `dispatch<Map>(publisher)` and `EventDispatcher<Map>`, event builders, publication requests, adapters and entity queue.

- [ ] Write tests copying the real templates into a temporary project and compile type contracts; assert cold execution, immutability, sync/async failures, empty completion, original prototype, metadata stability, partial queue failure/cancellation, concurrency, EventBus listeners and DI, compatibility adapter, persist-before-publish.
- [ ] Run tests and capture RED before writing runtime code.
- [ ] Implement the templates and migrate the Order example using `EVENT_DISPATCHER_TOKEN`, `events.from(order).publish()` and EventBus adapter configuration.
- [ ] Run runtime tests and typecheck. Expected: tests PASS, TypeScript exits 0.
- [ ] Commit runtime templates and integration example after verification.

### Task 2: Documentation and migration

**Files:** skills/**/*.md; agents/*.md; CLAUDE.md; README.md; CONTRIBUTING.md; .github/PULL_REQUEST_TEMPLATE.md; shared/repository-contracts/repository-contracts.ts.example.

**Interfaces:** Consumes Task 1 names and semantics; documents useClass/useFactory/useExisting, plain DomainEvent metadata and entity queue, transport mapping and migration.

- [ ] Replace AggregateRoot/EventPublisher/commit as the preferred flow with pure Entity/dispatcher; isolate old guidance in migration compatibility sections.
- [ ] Add dispatcher reference documenting RxJS composition, stable IDs, keys, factories, broker mapping, transaction ordering and uncertain delivery.
- [ ] Run frontmatter/link validation and docs specs. Expected: PASS with no stale primary flow.
- [ ] Commit documentation after verification.

### Task 3: Checker, rulebook and release

**Files:** scripts/lib/executors/pattern-consistent.ts; scripts/__tests__/executors.spec.ts; rulebooks/hexagonal.rulebook.yaml; calibration/golden/**; release manifests; CHANGELOG.md; ROADMAP.md.

**Interfaces:** Recognizes dispatcher-based B/C handlers while retaining EventPublisher legacy; consumes pure-domain flow without mandatory Nest imports.

- [ ] Write classification regressions for dispatcher patterns, old B/C and comments/strings, run RED, implement classifier, run GREEN.
- [ ] Bump rulebook 1.4.0 and add new-flow reference fixtures without silently reusing old calibration. Preserve semantic questions where possible; version mismatch remains uncalibrated and CI performs fresh calibration.
- [ ] Update manifests/changelog/roadmap to 1.4.0.
- [ ] Run full test suite, typecheck, document validation, static checker on examples. Expected: PASS.
- [ ] Review whole branch, fix material issues, push PR and wait for required CI.
- [ ] Merge passing PR, create v1.4.0 tag/release and verify published metadata and main SHA.
