# Changelog

All notable changes to this plugin. Versions follow `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, which CI keeps identical; a GitHub Release carries the same tag.

## Unreleased

### Added

- `overrides[].check.unlessInEnclosingDeclaration` (issue #15): a project rulebook replaces the enclosing-declaration regex of an inherited regex rule. Written for `softtor/tenant-scoped-query` in projects where Postgres RLS enforces tenant isolation and repositories query by an aggregate id (`conversationId`, `subscriptionId`, `findUnique` by `id` on an RLS-protected model); the base rule is unchanged, the override applies only to regex checks, and methods with no declared scope keep failing. Recipe in `rulebooks/project.example.rulebook.yaml` and in the `onboard-project` skill.

## 1.3.0 — 2026-09-20

Rulebook-driven agents and semantic rules. Sum of the four pull requests P1–P4 of the Jev plan.

### Added

- **Semantic rules through Jev** (`jev-1.13.0`, TypeSafe): five rules of the `hexagonal` rulebook are questions (`hex/handler-no-business-rules`, `hex/port-no-infra-leak`, `hex/entity-not-anemic`, `hex/controller-thin`, `hex/no-overengineering`). The CLI runs them with `--classes semantic` and `TYPESAFE_API_KEY`; one request per file and state slice; cache, retries, circuit breaker and a JSONL log that never holds code or the key.
- **Calibration harness**: labelled golden cases per semantic rule (>= 8 good, 8 bad, 5 adversarial), `calibration/run.ts` against the real model, `calibration/fit.ts` fitting `advise`/`ask`/`deny` with Wilson intervals, `calibration/fitted/<pin>.json` read by the CLI, `calibration/report.md`, a regression spec and a CI job that runs only on push to `main` and weekly. `deny` needs >= 30 good and 30 bad cases with precision >= 0.95 and zero false positives; no shipped rule has it.
- **Hooks** (`hooks/hooks.json`, opt-in per project through `.claude/rulebook.yaml`): `SubagentStart` injects the rulebook slice of the agent's layer; `PreToolUse` denies a Write or Edit that introduces a static FAIL; `PostToolUse` adds advisory findings; `SubagentStop` blocks the stop of a pipeline agent while a touched file has a static FAIL (twice, then releases with the list); `PostToolUse` on `Agent` hands the residue to the orchestrator. Kill switch `NESTJS_HEXAGONAL_DISABLE=1`. Hook state, session store and log under `$CLAUDE_PLUGIN_DATA`; `export-logs` aggregates the log.
- **Rulebook-driven agents**: the six pipeline agents take their rules from the injected slice, load the layer skill for patterns, carry a "When the SubagentStop hook blocks" section and run `nestjs-hexagonal-check --files <created> --classes static --strict` before reporting. `architecture-reviewer` runs the checker first (`--format json --classes static,semantic --explain`) and judges only `uncertain`, `uncalibrated`, undecided, WARN semantic findings and cross-file concerns; every finding cites its rule id or `residual`.
- **`review-subdomain` in three steps** (static CLI, semantic CLI one batch per file, residual review by the agent) keeping the PASS/WARNING/FAIL report; the rubric marks each of its 35 checks with the rule id that covers it or "residual (agent)". `create-subdomain` Phase 6 runs the checker and Phase 7 invokes the new review.
- **Package runner**: skills and agents no longer hardcode `pnpm`; `<runner>` and `<add>` are resolved from the project lockfile (`bun.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`), documented once in `using-nestjs-hexagonal`, with an optional user-level `package_runner` option substituted as `${user_config.package_runner}`.
- **New skills**: `jev-eval` (add golden cases, run and fit the calibration, read the report, decide advise/ask/deny, write atomic questions, weekly pilot report) and `onboard-project` (stamped `.claude/rulebook.yaml`, key, pinned CLI, baseline, hooks).
- **New subcommands**: `stamp [<id>...]` prints the `extends` block with sha256 stamps; `prescan --files|--diff [--semantic]` maps layer, kind, size and spec sibling per file (with a key, one `choice` question per file to Jev). Issue #2 partially: a minimal read-only `explore-agent` on `haiku` runs `prescan` and returns the module map.
- **CI `frontmatter` job** (issue #7): `scripts/validate-frontmatter.ts` validates every `agents/*.md` (name, description, model in `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`, `haiku`; non-empty tools) and `skills/*/SKILL.md` (name matches the directory), every `nestjs-hexagonal:<id>` reference and every relative link in the documentation.

### Changed

- `hexagonal` rulebook 1.3.0: semantic questions rewritten for calibration (a question change bumps the rulebook version and invalidates the cache and the fitted thresholds of that rule). Two rules the plan had listed were not adopted: a semantic tenant-leak rule (multi-hop tenant reasoning is the reviewer's residual) and a static `as`-cast rule (a linter's job).
- `skills/application/SKILL.md` description quoted: it contained an unquoted `: ` and was not valid YAML (found by the new validator).

### Lessons

- **`defaultEnabled` is not a deferral.** With `defaultEnabled: false` in `plugin.json`, Claude Code 2.1.278 reads `hooks/hooks.json` but registers neither the hooks nor the plugin agents (`create-subdomain` fails with "Agent type 'nestjs-hexagonal:domain-agent' not found"). Opt-in is therefore the `run.sh` gate alone: a project without `.claude/rulebook.yaml` never runs a hook. `scripts/__tests__/hooks/plugin-manifest.spec.ts` forbids the field.
- **Disclosure.** With a key present, the CLI and the `PostToolUse`/`SubagentStop` hooks send code slices of the files a plugin agent writes to `https://api.typesafe.ai/v1/systemone`. TypeSafe states it does not train on customer data; zero data retention is only available under an enterprise contract. The key travels only in the `Authorization` header and never appears in a hook output, reason, log or cache. Without a key everything is static and offline. Full text in the README section "Disclosure".

## 1.2.0 — 2026-09-20

Rulebook mechanism.

### Added

- Rulebook Zod schema (`nestjs-hexagonal/rulebook@1`): rules with id, layer, scope, class (`static`, `semantic`, `runtime`), severity, rationale, fix, source, check or question, state slice, thresholds; `extends` with version and sha256 stamps; overrides by id. Composition resolves bases recursively, rejects id collisions and marks a stale stamp as `uncalibrated` without blocking.
- `hexagonal` rulebook (project-agnostic static rules derived from `review-subdomain` D1..M4 and the `architecture-reviewer` smells) and `softtor-conventions` (tenant scoping, no emoji, English identifiers, extended only by projects that share them), with golden `good`/`bad` fixtures per static rule enforced by `bun test`.
- Static engine: regex, forbidden and required imports, line count, and `external` executors (`hex/pattern-consistent`, `hex/no-overengineering-static`) that look at the whole project tree.
- `nestjs-hexagonal-check` CLI (`scripts/check.ts`) with `--rulebook`, `--project-rulebook`, `--files`, `--diff`, `--classes`, `--format json|text`, `--strict`, `--explain`; `scripts/run.sh` as the single entry point with the opt-in gate, `node_modules/.bin` preference and fail-open; `bun` runtime with a `node --experimental-strip-types` fallback.
- `package.json` with `bin`, `files` and a `bun.lock`, so the plugin installs as a dev dependency (`bun add -d github:Softtor/nestjs-hexagonal#v1.2.0`); CI job with version parity between the three manifests.

### Fixed

- `--files` walks directories; a missing project rulebook is rejected with usage; `--diff` resolves relative to the current directory and includes untracked files; hoisted dependencies are found from any parent `node_modules`.

## 1.1.0 and earlier

Skills and agents for the six layers, `create-subdomain` and `review-subdomain` workflows, GSD installer, shared `.ts.example` base classes, the Order bounded context example; agents pinned to Claude Opus 5 / Sonnet 5 and the community roadmap (1.1.0).
