---
name: onboard-project
description: Onboards a NestJS project to the nestjs-hexagonal rulebook, CLI and hooks — creates .claude/rulebook.yaml extending the plugin rulebooks with sha256 stamps, sets the optional TypeSafe key, pins the CLI as a dev dependency, runs the first baseline check and explains what the hooks will do from then on. Use when a project starts using the plugin, when asked to "onboard this project", "enable the hooks", "create the rulebook" or "set up nestjs-hexagonal-check".
argument-hint: Project root (defaults to the current project)
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# onboard-project

Executable checklist for a project that wants the rulebook enforced. The plugin is inert until step 2 exists: the hooks fire only for a project with `.claude/rulebook.yaml` (or `NESTJS_HEXAGONAL_RULEBOOK` pointing at a file), and the CLI is a plain dev dependency. README section "Onboarding another project" is the prose version of this list.

Resolve the package runner first ("Package runner" in `nestjs-hexagonal:using-nestjs-hexagonal`); the commands below use `bun`, replace with the project's runner.

---

## 1. Decide which rulebooks apply

| Rulebook | Extend it when |
|---|---|
| `hexagonal` | always: project-agnostic hexagonal + DDD + CQRS rules (`hex/*`) |
| `softtor-conventions` | the project is multi-tenant with an `organizationId` scope on every query, bans emoji in code and requires English identifiers (`softtor/*`); a project that does not share those conventions must not extend it |

Ask the user when the answer is not obvious from the codebase (grep for `organizationId` in repositories).

## 2. Create `.claude/rulebook.yaml` with stamps

Print the `extends` block from the installed plugin; the sha256 pins the content of each base rulebook the project is calibrated against:

```bash
bunx nestjs-hexagonal-check stamp hexagonal                       # add softtor-conventions when it applies
```

Write the file (the example is `rulebooks/project.example.rulebook.yaml` in the plugin):

```yaml
$schema: nestjs-hexagonal/rulebook@1
id: <project-id>            # lowercase, becomes the namespace of the project's own rules
version: 0.1.0
extends:
  - id: hexagonal
    version: 1.3.0
    sha256: <from the stamp command>
model:
  provider: typesafe
  pin: jev-1.13.0
rules: []                   # project rules under <project-id>/<slug>, static first
overrides: []               # by id: disabled, severity, scope, thresholds
```

A stale stamp never blocks: the CLI reports `rulebook-mismatch` and marks the run `uncalibrated`. Refresh the stamps when the plugin is updated (`stamp` again).

## 3. Set the key (optional, semantic rules)

Static rules run offline. Semantic rules (five in `hexagonal`) need `TYPESAFE_API_KEY`:

- Claude Code: answer the `TYPESAFE_API_KEY` prompt when enabling the plugin, or set it later in `/plugin` (plugin `userConfig`, stored in the keychain and exported to the hooks as `CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY`).
- Shell and CI: `export TYPESAFE_API_KEY=...`; in GitHub Actions only from a secret on `push`, never on `pull_request` from forks.

Before enabling it, read the README section "Disclosure": with a key, code slices of the files the plugin agents write are sent to `https://api.typesafe.ai`. Without a key the plugin stays static-only and offline.

## 4. Pin the CLI in the project

```bash
bun add -d github:Softtor/nestjs-hexagonal#v1.3.0
```

The hooks prefer `node_modules/.bin/nestjs-hexagonal-check` when it exists, so the version in the lockfile is the one that runs in hooks, in CI and on developers' machines. Bun installs the plugin's `bun.lock` dependencies (`yaml`, `zod`) hoisted; `bunx nestjs-hexagonal-check --help` must print the usage.

## 5. Run the baseline

```bash
bunx nestjs-hexagonal-check --files 'src/**/*.ts' --classes static --strict --format text
bunx nestjs-hexagonal-check prescan --files 'src/<one-module>/**/*.ts'            # cheap map of a module
```

Exit 1 lists the static FAILs the codebase already has. Decide with the user: fix them, scope them out (`overrides` with `scope.exclude` for legacy paths) or lower them to WARN for now. Do not disable a FAIL rule globally to get green.

Add the check to the project's gate, for example lint-staged: `nestjs-hexagonal-check --files <staged files> --classes static --strict`, or CI: `--diff origin/main --strict`.

## 6. Enable the hooks (already done)

Creating `.claude/rulebook.yaml` in step 2 is what enables the hooks; there is no other switch. From now on, inside the plugin agents (`nestjs-hexagonal:*-agent`): `SubagentStart` injects the rulebook slice of the layer, `PreToolUse` denies a Write or Edit that introduces a static FAIL, `PostToolUse` adds advisory findings, `SubagentStop` blocks the stop while a touched file has a static FAIL (twice, then releases). Verify with a plugin agent that the `[nestjs-hexagonal]` context appears at its start.

Kill switch: `NESTJS_HEXAGONAL_DISABLE=1` (everything), delete the rulebook (hooks silent), unset the key (static only). Rulebook elsewhere: `NESTJS_HEXAGONAL_RULEBOOK` in `.claude/settings.json` `env`.

## 7. Record it

Add to the project's CLAUDE.md (or run `nestjs-hexagonal:gsd-installer` for GSD projects): the rulebook id, which bases it extends, where the key comes from, the gate command, and the kill switch. Commit `.claude/rulebook.yaml`, the lockfile and the CLAUDE.md change together.

## Output

Report: rulebooks extended and their stamps, key configured or not (never the value), CLI version pinned, baseline result (FAIL and WARN counts, what was decided about them), gate command added, and the files changed.
