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

## Rulebook (machine-readable rules)

`rulebooks/hexagonal.rulebook.yaml` encodes the rules above; `scripts/check.ts` (entry `scripts/run.sh`, bin `nestjs-hexagonal-check`) runs the static ones offline and, with `--classes semantic` and `TYPESAFE_API_KEY`, asks Jev the semantic ones (`scripts/lib/{jev-client,state-builder,decide,semantic-engine}.ts`). Runtime rules are still inert. Projects opt in with `.claude/rulebook.yaml` (`extends` with sha256 stamps, own rules, overrides by id); `NESTJS_HEXAGONAL_DISABLE=1` turns everything off. The same rulebook drives the hooks in `hooks/hooks.json` (`scripts/hooks/*.ts`, shared code in `scripts/hooks/lib/`, state in `scripts/lib/session-store.ts`, log in `scripts/lib/hook-log.ts`).

| Hook | Matcher | Gate | Effect (v1) |
|---|---|---|---|
| `SubagentStart` | `^nestjs-hexagonal:.*` | opt-in project, plugin agent | rulebook slice of the agent's layer as `additionalContext` (<= 1,500 tokens); records HEAD sha and start time |
| `PreToolUse` | `Write\|Edit` | plugin agent, path in project and in a static scope | only findings the current file does not already have: new static FAIL -> `permissionDecision: deny` (3 findings max); new WARN -> `additionalContext`, no permission decision; no network, no `external` checks |
| `PostToolUse` | `Write\|Edit` | any agent (path recorded per `agent_id`) | static for all; semantic only for plugin agent with key; `additionalContext` only with findings, 8 KB cap per agent and session |
| `SubagentStop` | the six pipeline agents | plugin agent | files = store paths + (`git diff`/untracked since start minus the baseline recorded at start); static FAIL -> `decision: block` at once, no Jev; clean stop -> semantic advisory under a 17 s deadline stored for the Agent hook; after 2 blocks -> release with `systemMessage` |
| `PostToolUse` | `Agent` | completed plugin subagent | unresolved FAILs and the last semantic advisory of that `agentId` from the store as `additionalContext` |

Every hook runs through `scripts/run.sh --hook <name>`, exits 0 whatever happens, never prints the key or a raw file body, and appends one line to `$CLAUDE_PLUGIN_DATA/logs/hooks-YYYYMMDD.jsonl` (`check.ts export-logs --since <date>` aggregates it). The key comes from `CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY` (plugin `userConfig`) or `TYPESAFE_API_KEY`. Opt-in is exclusively the `run.sh` gate (project `.claude/rulebook.yaml` or `NESTJS_HEXAGONAL_RULEBOOK`): never add `defaultEnabled: false` to `plugin.json`, because Claude Code 2.1.278 then reads `hooks.json` but registers neither hooks nor agents (`scripts/__tests__/hooks/plugin-manifest.spec.ts` guards this).

Semantic decisions (`scripts/lib/decide.ts`), per rule and per answer:

| Outcome | noul (`answers[k].noul`) | choice / score (mass on violating options or levels) | Effect |
|---|---|---|---|
| `deny` | p >= fitted `deny` | mass >= fitted `deny` | `--strict` exits 1; only with `calibration/fitted/<pin>.json` (>= 30/30 golden cases, precision >= 0.95, zero FP) |
| `ask` | p >= `ask` | mass >= `ask` | finding, exit 0 |
| `advise` | p >= `advise` (default 0.55) | mass >= `advise` | finding, exit 0 |
| `pass` | below `advise` and outside the band | below `advise` | no finding |
| `uncertain` | p inside `uncertain.lo..hi` (default 0.35..0.65) | `confidence < minConfidence` (default 0.6) | listed apart; exit 3 only with `--strict --fail-on-uncertain` |
| `uncalibrated` | response `model != pin` or `rulebook-mismatch` | same | listed apart, never deny |

Fitted thresholds take precedence over rulebook thresholds over defaults; a rulebook `deny` is ignored so that no rule can deny before calibration. Rulebook thresholds only declare `advise` and the abstention band.

| Rule id | Class | Severity | Source |
|---|---|---|---|
| `hex/domain-no-nest-decorators` | static | FAIL | review D1, D3, D6, M3 |
| `hex/entity-unique-id` | static | FAIL | review D5 |
| `hex/vo-immutable` | static | FAIL | harness value-object-immutable |
| `hex/repo-interface-in-domain` | static | FAIL | review D6 |
| `hex/module-exports-ports-only` | static | FAIL | review I1 |
| `hex/vo-no-class-validator` | static | FAIL | review D2, P1 |
| `hex/no-circular-import` | static | FAIL | review M3, reviewer circular dependency |
| `hex/event-payload-sufficient` | static | FAIL | reviewer insufficient event payload |
| `hex/handler-max-lines` | static | WARN | reviewer god handler |
| `hex/tests-use-builders` | static | WARN | review D7, T5 |
| `hex/pattern-consistent` | static (external) | WARN | reviewer inconsistent pattern |
| `hex/no-overengineering-static` | static (external) | WARN | reviewer over-engineering audit |
| `hex/handler-no-business-rules` | semantic | FAIL | reviewer god handler |
| `hex/port-no-infra-leak` | semantic | FAIL | review A6 |
| `hex/entity-not-anemic` | semantic | WARN | reviewer anemic model |
| `hex/controller-thin` | semantic | WARN | review P5 |
| `hex/no-overengineering` | semantic (choice) | WARN | reviewer over-engineering audit |
| `hex/tests-coverage` | runtime | WARN | review T1-T5 |
| `softtor/tenant-scoped-query` | static | FAIL | review I7 (`softtor-conventions`) |
| `softtor/no-emoji` | static | FAIL | Softtor style (`softtor-conventions`) |
| `softtor/identifiers-english` | static | WARN | Softtor style (`softtor-conventions`) |

Subcommands of `check.ts`: `stamp [<id>...]` prints the `extends` block with sha256 stamps; `prescan --files|--diff [--semantic]` (`scripts/prescan.ts`) maps layer, kind, size and spec sibling per file and, with a key, asks Jev one `choice` per file; `export-logs` aggregates the hook log. `scripts/validate-frontmatter.ts` (CI job `frontmatter`) validates agents, skills, `nestjs-hexagonal:<id>` references and relative links. Skills never hardcode a package manager: `<runner>`/`<add>` come from the lockfile ("Package runner" in `using-nestjs-hexagonal`), `scripts/__tests__/docs.spec.ts` greps for `pnpm` outside that section. Adding a static rule requires `calibration/golden/<rule-id>/{good,bad}/` fixtures (at least 2 each); a semantic rule requires labelled cases (`<case-id>/case.json` + one file, at least 8 good, 8 bad and 5 adversarial good); `bun test ./scripts ./calibration/__tests__` enforces both. Calibration (`calibration/run.ts` with the real key, then `calibration/fit.ts`) writes `calibration/fitted/<pin>.json` and `calibration/report.md`; it runs in CI only on push to `main` and weekly, never on pull requests. Keep `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` on the same version.

## Skills

| Skill | When |
|-------|------|
| `nestjs-hexagonal:domain` | Entity, VO, event, repository interface, data builder |
| `nestjs-hexagonal:application` | Use case, CQRS handler, DTO, port, read model |
| `nestjs-hexagonal:infrastructure` | Prisma repo, module wiring, adapter, event handler infra |
| `nestjs-hexagonal:presentation` | Controller, request DTO, Swagger, error filter |
| `nestjs-hexagonal:websocket-broadcasting` | Domain event -> WebSocket broadcast to frontend |
| `nestjs-hexagonal:event-listeners` | Same-BC, cross-BC, and bridge listeners (WS, broker, email) |
| `nestjs-hexagonal:create-subdomain` | Full BC orchestrator (dispatches agents per layer; Phase 6 runs the checker, Phase 7 invokes review-subdomain) |
| `nestjs-hexagonal:review-subdomain` | Static rulebook (CLI) -> semantic rulebook (Jev) -> residual review by architecture-reviewer; findings cite rule ids |
| `nestjs-hexagonal:onboard-project` | Stamped `.claude/rulebook.yaml`, key, pinned CLI, baseline, hooks |
| `nestjs-hexagonal:jev-eval` | Golden cases, calibration run and fit, advise/ask/deny decision, weekly pilot report |
| `nestjs-hexagonal:using-nestjs-hexagonal` | Routing; documents the package runner (lockfile detection, `${user_config.package_runner}` override), rulebook and CLI, hooks, other harnesses |

## Agents

The six pipeline agents get their rules from the `SubagentStart` slice, load the layer skill for patterns, have a "When the SubagentStop hook blocks" section (fix the listed files, do not argue, do not touch files you did not create) and run `nestjs-hexagonal-check --files <created> --classes static --strict` before reporting (or say the CLI is not installed). `architecture-reviewer` runs `--format json --classes static,semantic --explain` first and judges only `uncertain`/`uncalibrated`/undecided outcomes, WARN semantic findings and cross-file concerns. `explore-agent` is read-only on `haiku` and runs `prescan`.

| Agent | Model | Purpose |
|-------|-------|---------|
| `explore-agent` | Claude Haiku (`haiku`) | Read-only map of a module (prescan + minimal reads) |
| `domain-agent` | **Claude Opus 5.5** | Domain modeling (entities, VOs, events) |
| `application-agent` | Claude Sonnet 5 | Use cases, handlers, DTOs, ports |
| `infrastructure-agent` | Claude Sonnet 5 | Repos, module wiring, adapters |
| `presentation-agent` | Claude Sonnet 5 | Controllers, request DTOs, Swagger |
| `broadcasting-agent` | Claude Sonnet 5 | WS gateway backend + frontend consumption (Next.js/React) |
| `architecture-reviewer` | **Claude Opus 5.5** | Over-engineering + code smell detection |
| `event-debug-agent` | **Claude Opus 5.5** | Debug event chain: entity -> dispatch -> WS -> frontend |
| `listener-agent` | Claude Sonnet 5 | Create event listeners (same-BC, cross-BC, bridge) |

## Workflow Order

Domain (Opus 5.5) -> Application (Sonnet 5) -> Infrastructure (Sonnet 5) -> Presentation (Sonnet 5)

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
