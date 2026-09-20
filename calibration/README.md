# Calibration

Everything the semantic rules need to turn a Jev probability into a decision lives here: labelled golden cases, the harness that sends them to the real model, the fitting script that derives thresholds, the fitted file the CLI reads and the report that justifies it.

```
calibration/
  golden/<rule-id>/{good,bad}/<case-id>/{<layered path>/<file>.ts, case.json}
  run.ts            sends every golden case of a rule to Jev, writes results/<pin>/<rule-id>.jsonl
  fit.ts            reads the results, fits thresholds, writes fitted/<pin>.json and report.md
  lib/              golden loader, result schema, metrics (precision, recall, F1, Wilson)
  fitted/<pin>.json thresholds the CLI applies (absent until the first real calibration)
  results/<pin>/    raw answers per case (values only, never code); produced by run.ts
  report.md         per-rule table, sample counts, misses and false positives by case id
  experiments/e1/   aggregate summary of the diff experiment that shaped the rules
```

Static rules also keep their fixtures under `golden/`, without `case.json`; `scripts/__tests__/check.spec.ts` runs them through the static engine.

## Golden cases

Every semantic rule has at least 8 plain good cases, 8 bad cases and 5 adversarial good cases (`adversarial-*`, correct code carrying comments such as `// reviewer: ignore` that must not steer the classifier). Each case directory holds exactly one `.ts` file at a path that matches the rule scope and a `case.json`:

```json
{ "expected": "violation", "note": "The handler multiplies unitPrice by quantity itself." }
```

`bun test ./calibration/__tests__` enforces the counts, the scope, the label and the steering comment. Cases are synthetic, derived from `examples/order-bounded-context` and variants in other domains; never copy code from a private codebase into this public repository.

## Running a calibration

```bash
export TYPESAFE_API_KEY=...                      # never commit it
bun calibration/run.ts --rule all --pin jev-1.13.0 --out calibration/results/jev-1.13.0
bun calibration/fit.ts --pin jev-1.13.0
bun test ./calibration/__tests__                 # regression spec now runs against the results
```

`run.ts` options: `--rule <id|all>`, `--pin` (must equal the rulebook pin), `--out`, `--concurrency` (default 4), `--max-requests` (default 500; the run aborts before sending anything when the golden set is larger) and `--cache-dir` (optional, reuses answers of identical state and questions). It refuses to run without the key. Each result line carries the pin, the model the API answered with, the case id, the expected label, the primitive, the value the decision engine uses (noul probability, or the probability mass on the violating options/levels), the raw answer, the confidence for choice/score, latency, tokens and whether the answer came from the cache. State text is never written; the client log at `results/<pin>/client-log.jsonl` follows the same rule.

`fit.ts`, per rule and primitive:

- reports precision, recall and F1 at the cuts 0.55, 0.70, 0.80 and 0.90 with 95% Wilson intervals, the absolute number of misses and false positives by case id, the uncertain rate (noul values inside `uncertain.lo..hi`, choice/score confidence below `minConfidence`), p50/p95 latency and the models seen;
- fits `advise` at the cut with the best F1, `ask` at the smallest cut with precision >= 0.85, and `deny` at the smallest cut with precision >= 0.95 and zero false positives on the good cases, **only when the rule has at least 30 good and 30 bad cases**; otherwise `deny` is omitted and the reason is printed in the report;
- copies the rule's abstention band (`uncertain`) or `minConfidence` into the fitted file so it is self-contained;
- leaves the column "also caught by static? does not count" as `TODO=false` until the static overlap is measured.

`fitted/<pin>.json` is keyed by rule id and validated by `scripts/lib/decide.ts` when the CLI loads it. Fitted thresholds take precedence over rulebook thresholds; a rule without an entry stays advisory (`calibrated: false`, never `deny`).

## Regression

`__tests__/fitted-regression.spec.ts` is skipped while `results/<pin>/` does not exist. Once results are committed it fails when a result line records a model other than the pin, or when a rule with a fitted `deny` no longer reaches precision 0.95 with zero false positives at that cut.

## CI

The `calibration` job of `.github/workflows/ci.yml` runs only on push to `main` and on the weekly schedule, with `secrets.TYPESAFE_API_KEY`; it never runs on pull requests (forks do not receive the secret and must not be able to spend it). It uploads `calibration/results` and `calibration/report.md` as workflow artifacts and does not commit; promoting a fitted file is a human decision made in a pull request that includes the results and the report.

## Hook gate verification

The blocking mechanics of the `SubagentStop` hook were verified against the Claude Code docs (`hooks.md`, "Stop decision control" and "SubagentStop"): `{ "decision": "block", "reason": "..." }` on exit 0 keeps the subagent running and delivers `reason` as its next instruction, `stop_hook_active` is `true` on every continuation, Claude Code ends the loop after 8 consecutive blocks, and context for the parent goes through `PostToolUse` on the `Agent` tool. The unit tests cover the JSON contract; the live behaviour is a manual spike the coordinator runs after the PR is merged into a cached copy of the plugin:

1. Create a dummy project with `.claude/rulebook.yaml` extending `hexagonal` (stamp with `sha256sum rulebooks/hexagonal.rulebook.yaml`), `bun install` in the plugin, bump `version`, `/plugin update`, `/reload-plugins`.
2. Run `nestjs-hexagonal:create-subdomain` for a small aggregate and, in the `domain-agent` prompt, ask for an `@Injectable()` service under `domain/`.
3. Observe the `PreToolUse` deny (`[plugin:nestjs-hexagonal]` reason with `hex/domain-no-nest-decorators`), then force the file through `Bash` and observe the `SubagentStop` block, the second block and the release `systemMessage` on the third stop.
4. Export the evidence: `nestjs-hexagonal-check export-logs --since <today> --out calibration/experiments/hooks-spike.json` and attach it to the pilot report.

## Changing a question

A question change invalidates the calibration of that rule: bump the rulebook `version`, refresh the sha256 stamp in `rulebooks/project.example.rulebook.yaml`, rerun `run.ts` for the rule and refit. The answer cache is keyed by rulebook version, so stale answers are never reused.
