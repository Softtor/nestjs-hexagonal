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

The plugin prompts for two optional values when enabled: `TYPESAFE_API_KEY` (semantic rules; leave empty to stay offline) and `package_runner` (`bun run`, `pnpm`, `npm run` or `yarn`; leave empty to detect it from each project's lockfile). To pin the CLI in a project, `bun add -d github:Softtor/nestjs-hexagonal#v1.3.0` (see [Onboarding another project](#onboarding-another-project)).

### Local development

```bash
cd /path/to/nestjs-hexagonal && bun install   # --plugin-dir does not get the automatic dependency install
claude --plugin-dir /path/to/nestjs-hexagonal
```

Claude Code installs the Node dependencies of a plugin it copies into its cache (marketplace install), but a plugin loaded in place with `--plugin-dir` or from a local-directory marketplace keeps its source directory as `CLAUDE_PLUGIN_ROOT` and gets no install. Without `node_modules` the hooks fail open (one actionable line on stderr, exit 0) and the CLI exits 1. To test the hooks the way a user gets them, bump `version`, run `/plugin update` and `/reload-plugins` so the copy in the cache is the one that runs.

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
| `nestjs-hexagonal:create-subdomain` | Orchestrates full BC creation by dispatching agents per layer; verification and review run the checker |
| `nestjs-hexagonal:review-subdomain` | Three steps: static rulebook (CLI), semantic rulebook (Jev, one batch per file), residual review by the Opus agent; every finding cites its rule id or `residual` |
| `nestjs-hexagonal:onboard-project` | Checklist to onboard a project: stamped `.claude/rulebook.yaml`, key, pinned CLI, baseline, hooks |
| `nestjs-hexagonal:jev-eval` | Calibrate or evaluate a semantic rule: golden cases, `run.ts`/`fit.ts`, report, advise/ask/deny decision, weekly pilot report |
| `nestjs-hexagonal:using-nestjs-hexagonal` | Routing meta-skill; also documents the package runner, the rulebook and CLI, the hooks and how other harnesses run the CLI |

## Agents

The six pipeline agents are rulebook-driven: the rules arrive as a slice injected by the `SubagentStart` hook, the layer skill supplies the code patterns, the `SubagentStop` hook blocks a stop that leaves a static FAIL behind, and each agent runs `nestjs-hexagonal-check` on the files it created before reporting. `architecture-reviewer` runs the checker first and judges only what the rulebook cannot decide. `explore-agent` is the cheap read-only scanner (issue [#2](https://github.com/Softtor/nestjs-hexagonal/issues/2)) built on `prescan`.

| Agent | Model | Purpose |
|---|---|---|
| `explore-agent` | Claude Haiku (`haiku` alias) | Read-only map of an existing module: `prescan` plus the minimum reads; runs before Opus/Sonnet touch anything |
| `domain-agent` | **Claude Opus 5.5** (`claude-opus-5-5`) | Domain modeling — entities, VOs, events, repo interfaces |
| `application-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | Use cases, CQRS handlers, DTOs, ports |
| `infrastructure-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | Prisma repos, module wiring, adapters |
| `presentation-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | Controllers, request DTOs, Swagger |
| `broadcasting-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | WS gateway (backend) + event consumption (Next.js/React frontend) |
| `listener-agent` | Claude Sonnet 5 (`claude-sonnet-5`) | Creates event listeners (same-BC projections, cross-BC reactions, bridge) |
| `architecture-reviewer` | **Claude Opus 5.5** (`claude-opus-5-5`) | Consumes the checker JSON; judges `uncertain`/`uncalibrated`/undecided semantic outcomes, WARN semantic findings and cross-file concerns (multi-hop tenant scoping, empty directories, small event tables) |
| `event-debug-agent` | **Claude Opus 5.5** (`claude-opus-5-5`) | Debug full event chain: entity -> dispatch -> WS -> frontend |

**Why Opus 5.5 for domain, review, and debug?** Domain modeling requires critical decisions. Review requires deep judgment to distinguish necessary from unnecessary complexity. Event debugging requires tracing across 6 layers systematically.

**Model pins:** Agents use full IDs (`claude-opus-5-5`, `claude-sonnet-5`) so resolution does not fall back to legacy 4.x aliases on some providers. Requires Claude Code **v2.1.280+** (Opus 5.5) and **v2.1.197+** (Sonnet 5) — run `claude update` if needed. `explore-agent` uses the `haiku` alias on purpose: it is read-only, any Haiku generation does the job, and the alias follows whatever Haiku the account serves. The `frontmatter` CI job accepts exactly `claude-opus-5-5`, `claude-sonnet-5`, `claude-haiku-4-5` and `haiku`.

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

## Rulebook & CLI

The architecture rules above also exist as a machine-readable **rulebook** (`rulebooks/hexagonal.rulebook.yaml`) and a checker CLI, `nestjs-hexagonal-check`, that runs the static rules over a set of files offline. Semantic rules are answered by Jev, TypeSafe's typed-judgment model, only when `--classes semantic` is requested and `TYPESAFE_API_KEY` is set (see [Semantic checks (Jev)](#semantic-checks-jev)); runtime rules (package tests) are declared but not executed by this version.

### Running the checker

```bash
# inside this repository
bun scripts/check.ts --rulebook hexagonal --files 'src/**/*.ts' --classes static --format text

# from a project that installed the plugin as a dev dependency
bun add -d github:Softtor/nestjs-hexagonal#v1.3.0
bunx nestjs-hexagonal-check --files 'apps/api/src/**/*.ts' --strict
bunx nestjs-hexagonal-check --diff origin/main --format json
bunx nestjs-hexagonal-check prescan --files 'apps/api/src/orders/**/*.ts'   # map: layer, kind, size, spec sibling
bunx nestjs-hexagonal-check stamp hexagonal softtor-conventions          # extends block for a project rulebook
```

| Flag | Meaning |
|---|---|
| `--rulebook <path\|id>` | rulebook to run; an id resolves to `rulebooks/<id>.rulebook.yaml` in the plugin (`hexagonal`, `softtor-conventions`) |
| `--project-rulebook <path>` | project rulebook; defaults to `$NESTJS_HEXAGONAL_RULEBOOK`, then `$CLAUDE_PROJECT_DIR/.claude/rulebook.yaml` |
| `--files <glob\|dir\|file...>` / `--diff <base>` | files to check (globs, directories or files relative to the current directory) or the files changed since `<base>` (`git diff --relative` plus untracked files) |
| `--classes static[,semantic,runtime]` | rule classes to run; `semantic` needs `TYPESAFE_API_KEY`, `runtime` is still inert |
| `--format json\|text` | output format |
| `--strict` | exit 1 when a static FAIL or a semantic `deny` exists |
| `--fail-on-uncertain` | with `--strict`, exit 3 when a semantic answer is `uncertain` or `uncalibrated` |
| `--explain` | list the rules applied to each file; with `semantic`, also the questions and the state slice sent |

Each finding carries the rule id, severity (`FAIL`/`WARN`), path, line, evidence and the rule's `fix` text.

Subcommands:

| Subcommand | Meaning |
|---|---|
| `stamp [<id>...]` | prints the `extends` block (id, version, sha256) of the named plugin rulebooks, default `hexagonal`, ready to paste into `.claude/rulebook.yaml` |
| `prescan --files\|--diff [--semantic] [--format json\|text]` | cheap static map of the files: layer from the path (`domain`, `application`, `infrastructure`, `presentation`, `other`), kind from the content (`entity`, `vo`, `event`, `repo-interface`, `use-case`, `handler`, `controller`, `dto`, `module`, `listener`, `adapter`, `test`, `other`), line count and whether a spec sibling exists; sorted by layer. `--semantic` asks Jev one `choice` question per file ("what kind of artifact is this", the kinds plus `other`) and records the answer next to the static kind with an `agrees` flag; it runs only with a key and is skipped with a notice otherwise; with a key it sends the whole file (up to 8,000 tokens) and its path, so it is opt-in by flag and never runs from a hook. This is the input of the `explore-agent` and of any cheap explore step, not a rule check |
| `export-logs --since <date> [--out <file>] [--data-dir <dir>]` | aggregates the hook log (see [Hooks](#hooks)) |

### Project rulebook

A project opts in by creating `.claude/rulebook.yaml` (or pointing `NESTJS_HEXAGONAL_RULEBOOK` at a file). It extends one or more plugin rulebooks, adds rules under its own namespace and overrides inherited rules by id (`disabled`, `severity`, `scope`, `thresholds`). `rulebooks/project.example.rulebook.yaml` is a complete example.

```yaml
$schema: nestjs-hexagonal/rulebook@1
id: acme-crm
version: 0.1.0
extends:
  - { id: hexagonal, version: 1.2.0, sha256: <sha256sum rulebooks/hexagonal.rulebook.yaml> }
model: { provider: typesafe, pin: jev-1.13.0 }
rules: []
overrides:
  - { id: softtor/identifiers-english, scope: { exclude: ['src/legacy/**'] } }
```

The `sha256` stamp pins the content of the base rulebook the project was calibrated against. When the installed copy differs, the CLI still runs but reports `rulebook-mismatch` and marks the run `uncalibrated`; a stale stamp never blocks.

### Opt-in gate and kill switch

`scripts/run.sh` is the single entry point for the CLI and for the plugin hooks. In hook mode (`--hook <name>`) it decides in pure shell, before starting any runtime:

1. no `.claude/rulebook.yaml` in `$CLAUDE_PROJECT_DIR` and no `NESTJS_HEXAGONAL_RULEBOOK` pointing at an existing file: exit 0 with no output (the plugin is inert for projects that did not opt in);
2. `NESTJS_HEXAGONAL_DISABLE=1`: exit 0 (kill switch, also honoured by the CLI);
3. `file_path` resolving outside the project directory: exit 0;
4. the project's own `node_modules/.bin/nestjs-hexagonal-check` is preferred when present, so the version pinned in the project's lockfile is the one that runs; otherwise the plugin's `scripts/check.ts`;
5. missing `node_modules` (plugin loaded in place, or a failed install): an actionable message on stderr and exit 0 in hook mode, exit 1 in CLI mode.

The runtime is `bun`; when it is absent the script falls back to `node --experimental-strip-types`. In hook mode the script then runs `scripts/hooks/<name>.ts` with stdin forwarded; the JSONL log records which copy ran (`binarySource: node_modules | plugin-root`).

### Hooks

`hooks/hooks.json` subscribes to four events. Every handler goes through `run.sh --hook <name>`, so the opt-in gate, the path containment, the single execution source and the fail-open above apply to all of them; that gate is the whole opt-in mechanism (see [Disclosure](#disclosure) for why the manifest does not use `defaultEnabled`). **In this version only a static FAIL blocks anything**; semantic answers are advisory text, and nothing blocks on `uncertain` or `uncalibrated`.

| Hook | Fires for | What it does | Output | Budget |
|---|---|---|---|---|
| `SubagentStart` `^nestjs-hexagonal:.*` | plugin subagents | records the session start (HEAD sha, timestamp) and injects the slice of the composed rulebook for the agent's layer: rule ids, titles, severity, the `fix` of FAIL rules | `additionalContext` (at most 1,500 tokens) | 300 ms, no network |
| `PreToolUse` `Write\|Edit` | plugin subagents, path inside the project and inside the scope of a static rule | computes the content the call would produce (Edit applies `old_string` to `new_string`, honouring `replace_all`), runs the static rules that need only that file (the two project-wide `external` checks run later) and keeps only the findings the current file does not already have | new static FAIL: `permissionDecision: deny` with rule id, evidence and fix (3 findings at most); new WARN: `additionalContext` with no permission decision; nothing new: silent | p95 1.5 s, no network |
| `PostToolUse` `Write\|Edit` | any agent | records the path per `agent_id`; static rules for everyone; semantic rules only for a plugin subagent with a key, under a 13 s deadline; `additionalContext` only when there is a finding, capped at 8 KB per agent and session (then a one-line notice) | `additionalContext` | p95 2 s, hook timeout 15 s |
| `SubagentStop` (the six pipeline agents) | plugin subagents | touched files = paths recorded in the session store plus `git diff --name-only` and untracked files since the recorded HEAD, minus the files that were already dirty when the agent started (baseline recorded at SubagentStart); full static run on them; a static FAIL blocks at once with `decision: block` and a `reason` listing only files this agent touched, and Jev is never called on that path; on a clean stop the semantic advisory runs (key present, at most 8 concurrent requests, deadline 17 s) and is stored for the parent; the block counter lives in the session store and after 2 blocks the agent is released with a `systemMessage` listing the unresolved FAILs | `{ decision: "block", reason }`, or silent | 20 s (hook timeout); the blocking path needs no network |
| `PostToolUse` `Agent` | parent of a completed plugin subagent | reads the residual report of that `agentId` from the session store and returns the unresolved FAILs and the semantic advisory of the last clean stop to the orchestrator | `additionalContext` | 200 ms |

Why release after 2 blocks: Claude Code ends a subagent after 8 consecutive stop-hook blocks, and the `reason` becomes the subagent's next instruction. An agent that cannot satisfy a rule would otherwise burn the whole budget; releasing earlier keeps the unresolved list visible to the parent through the `Agent` hook. `stop_hook_active` is ignored for the counter because it is already `true` on the first continuation. Note that as of Claude Code v2.1.198 subagents run in the background by default, in which case the `Agent` PostToolUse hook fires at launch (`status: async_launched`) and stays silent; the release message still reaches the user as a `systemMessage`.

State lives under `$CLAUDE_PLUGIN_DATA` (`~/.claude/plugins/data/<id>/`; when the variable is absent the hooks use the marketplace install directory if it exists, else a temp directory): `sessions/<session_id>/<agent_id>.json` (touched paths, block counter, advisory bytes, unresolved findings; written atomically with a lock and garbage-collected after 24 h), `logs/hooks-YYYYMMDD.jsonl` (one line per decision: event, agent type, tool, path relative to the project, rule ids, decision, latency, `binarySource`, plugin version, semantic counters; never code nor the key) and the Jev cache, log and circuit breaker described below. `nestjs-hexagonal-check export-logs --since 2026-09-14 --out weekly.json` aggregates the log: entries, p50/p95 latency per hook, decisions by kind, binary sources, uncertain and uncalibrated rates. A terminal does not receive `CLAUDE_PLUGIN_DATA`, so the command defaults to `~/.claude/plugins/data/nestjs-hexagonal-softtor-nestjs-hexagonal/` (the marketplace install) and accepts `--data-dir` for any other location.

### Disclosure

- **What is sent:** with a key present, one request per file and state slice containing the rule preamble, the file path, the layer, the slice name and the code of that slice plus the rulebook questions. The whole file is sent only when a rule declares `slice: file`. `prescan --semantic` is different: it is opt-in by flag, no rule is involved, and it sends the whole content of each scanned file (truncated at 8,000 tokens) plus its path and layer, with a single "what kind of artifact is this" question; it never runs from a hook. The key travels in the `Authorization` header and never appears in a hook output, a reason, the JSONL log or the cache; the hooks refuse to print any output that would contain the key or a raw file body.
- **When:** only if all three hold: the project opted in with `.claude/rulebook.yaml` (or `NESTJS_HEXAGONAL_RULEBOOK`), the hook fires inside a plugin subagent (`agent_type` prefixed `nestjs-hexagonal:`, with an `agent_id`), and a key is configured. `PreToolUse` and `SubagentStart` never use the network. Static rules run offline for every agent.
- **To whom:** `https://api.typesafe.ai/v1/systemone`. TypeSafe states it does not train on customer data; zero data retention is only available under an enterprise contract. Treat the code you check as shared with that provider.
- **How to disable:** `NESTJS_HEXAGONAL_DISABLE=1` (everything), remove the project rulebook (all hooks stay silent), or remove the key (static only).
- **Opt-in is per project, not per install.** The only gate is the one in `run.sh`: a project without `.claude/rulebook.yaml` (or `NESTJS_HEXAGONAL_RULEBOOK`) never runs a hook, whatever the plugin state. The manifest deliberately does not set `defaultEnabled: false`: with that field Claude Code 2.1.278 reads `hooks/hooks.json` but registers neither the hooks nor the plugin agents (`create-subdomain` fails with "Agent type 'nestjs-hexagonal:domain-agent' not found"), so the field would disable the plugin instead of deferring its activation.

### Onboarding another project

The skill `nestjs-hexagonal:onboard-project` is the executable version of this list.

1. Create `.claude/rulebook.yaml` extending `hexagonal` (and `softtor-conventions` only if multi-tenant scoping, no emoji and English identifiers are conventions of that project). `nestjs-hexagonal-check stamp hexagonal softtor-conventions` prints the `extends` block with the sha256 of the installed copies.
2. Set the key, if semantic rules are wanted: answer the `TYPESAFE_API_KEY` prompt when enabling the plugin (stored in the keychain, exported to the hooks as `CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY`) or export `TYPESAFE_API_KEY` in the shell. The option is read first.
3. Pin the CLI in the project so the hooks and the CI run the same version: `bun add -d github:Softtor/nestjs-hexagonal#v1.3.0`. The hooks prefer `node_modules/.bin/nestjs-hexagonal-check` when it exists.
4. Run `bunx nestjs-hexagonal-check --files 'src/**/*.ts' --strict` once to see the baseline, and add it to lint-staged or CI.
5. Optional: `NESTJS_HEXAGONAL_RULEBOOK` in `.claude/settings.json` `env` when the rulebook lives elsewhere.
6. Other harnesses (Codex, Cursor, OpenCode) get no hooks or agents; they run the same CLI from the project (`--diff <base> --strict` in a pre-commit step, `--format json` for a reviewer, `prescan` before editing).

### Package runner

Skills and agents never hardcode a package manager. They write `<runner>` (`bun run`, `pnpm`, `npm run`, `yarn`) and `<add>` (`bun add`, `pnpm add`, `npm install`, `yarn add`), resolved from the lockfile at the project root (`bun.lock`/`bun.lockb`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`); the table lives once in `skills/using-nestjs-hexagonal/SKILL.md`. The optional `package_runner` user option overrides the detection for one user: Claude Code substitutes non-sensitive `userConfig` values into skill and agent content as `${user_config.package_runner}`, so the skill shows the configured value inline. The value is user-level (`pluginConfigs` in the user settings), never per project, and `CLAUDE_PLUGIN_OPTION_PACKAGE_RUNNER` reaches hook processes only, not the agent's Bash, which is why lockfile detection is the primary mechanism.

### Semantic checks (Jev)

Five rules of the `hexagonal` rulebook are `semantic`: `hex/handler-no-business-rules`, `hex/port-no-infra-leak`, `hex/entity-not-anemic`, `hex/controller-thin` and `hex/no-overengineering`. They are questions that a regex cannot answer, so the CLI asks Jev (`jev-1.13.0`, pinned in the rulebook) and turns the probability into a decision.

- **Enable:** export `TYPESAFE_API_KEY` (or answer the plugin's `TYPESAFE_API_KEY` prompt, which the CLI reads as `CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY`) and pass `--classes static,semantic`. Without the key the semantic rules are skipped with a one-line notice and the exit code is 0; the static rules keep working offline.
- **What is sent:** one request per file and state slice, containing the rule preamble, the file path, the layer, the slice name and the code of that slice (the enclosing declaration of the change for handlers and controllers, the whole file for ports, entities and the over-engineering question) plus the rulebook questions. The whole file is sent only when the rule declares `slice: file`. `prescan --semantic` is different: it is opt-in by flag, no rule is involved, and it sends the whole content of each scanned file (truncated at 8,000 tokens) plus its path and layer, with a single "what kind of artifact is this" question; it never runs from a hook. The key travels in the `Authorization` header and never appears in the output, the JSONL log or the cache.
- **When:** on an explicit `--classes semantic` run, and in the `PostToolUse` and `SubagentStop` hooks under the gate described in [Disclosure](#disclosure): project opted in with a rulebook, plugin subagent, key present.
- **To whom:** `https://api.typesafe.ai/v1/systemone`. TypeSafe states it does not train on customer data; zero data retention is only available under an enterprise contract (`privacy@typesafe.ai`). Treat the code you check as shared with that provider.
- **Local state:** with `CLAUDE_PLUGIN_DATA` set, answers are cached under `$CLAUDE_PLUGIN_DATA/cache` (keyed by state, questions, model pin and rulebook version), one JSONL line per call is appended to `$CLAUDE_PLUGIN_DATA/jev.jsonl` (rule ids, answer values, model, latency, tokens, decision; never the code nor the key) and a circuit breaker in `breaker.json` opens for five minutes after three failures in two minutes.
- **Decisions:** `deny`, `ask`, `advise`, `pass`, `uncertain` (noul probability inside the abstention band, or choice/score confidence below `minConfidence`) and `uncalibrated` (the response model differs from the pin, or a base rulebook sha256 stamp does not match). `deny` requires fitted thresholds in `calibration/fitted/<pin>.json`, produced by the calibration harness from at least 30 good and 30 bad golden cases with precision >= 0.95; without them a rule yields at most `ask` and every finding is marked `calibrated: false`. `--strict` fails only on static FAIL and semantic `deny`.
- **Disable:** `NESTJS_HEXAGONAL_DISABLE=1`, unset the key, or drop `semantic` from `--classes`.

The calibration harness (`calibration/run.ts`, `calibration/fit.ts`, golden cases and the report) is documented in [`calibration/README.md`](calibration/README.md).

### Rulebooks shipped

| Rulebook | Scope |
|---|---|
| `hexagonal` | project-agnostic hexagonal + DDD + CQRS rules (`hex/*`) |
| `softtor-conventions` | multi-tenant scoping, no emoji, English identifiers (`softtor/*`); extend it only if those conventions apply |

Static rules have golden fixtures under `calibration/golden/<rule-id>/{good,bad}/`; `bun test` fails if a static rule lacks fixtures or a fixture stops behaving as labelled. Semantic rules have labelled golden cases in the same tree (`<case-id>/case.json` plus one file), consumed by the calibration harness.

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

Community contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md), the [ROADMAP](ROADMAP.md) for open feature tracks and good first issues, and the [CHANGELOG](CHANGELOG.md). CI validates every agent and skill frontmatter, every `nestjs-hexagonal:<id>` reference and every relative link (`bun scripts/validate-frontmatter.ts`).

1. Fork the repository
2. Create a feature branch
3. Follow the existing skill structure (SKILL.md + references/)
4. Submit a pull request

## License

MIT
