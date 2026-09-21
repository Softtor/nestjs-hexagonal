---
name: jev-eval
description: Calibrates or evaluates a semantic (Jev) rule of the nestjs-hexagonal rulebook — adds labelled golden cases, runs the calibration harness against the real model, fits thresholds, reads the report and decides whether the rule stays advisory or moves to ask; also produces the weekly pilot report from the hook logs. Use when a semantic rule misfires, when a new semantic rule is added, when asked to "calibrate a rule", "add golden cases", "raise a rule to ask" or "weekly Jev report".
argument-hint: Rule id (e.g., "hex/handler-no-business-rules") or "weekly-report"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# jev-eval

A semantic rule is a question the rulebook asks Jev (`jev-1.13.0`) about a code slice. Its decision thresholds are not written by hand: they are fitted from labelled golden cases by `calibration/fit.ts`, and the rule only gains a threshold it has earned. This skill is the procedure for adding cases, running the calibration and reading the result. The detailed workflow, the cost model and the report format are in `references/calibration-workflow.md`.

**Cost and key.** `calibration/run.ts` needs `TYPESAFE_API_KEY` and sends one request per golden case (about 300 ms and a fraction of a cent each; the E1 experiment cost about US$ 0.003 for 50 requests). Without the key the run refuses to start; never commit the key, never paste it in a report. Everything else (`fit.ts`, the tests, the report) is offline.

---

## 1. Decide what the rule must catch

Read the rule in `rulebooks/hexagonal.rulebook.yaml` (`question.instructions`, `question.options` or `levels`, `state.slice`, `thresholds.uncertain`). Write down, in one sentence each, the violation the rule exists for and the legitimate code it must leave alone. Every golden case is one of those sentences made concrete.

If the rule does not exist yet: a rule is born `static`; it becomes `semantic` only when a committed `bad` fixture exists that the static engine cannot catch. Write that fixture first.

## 2. Add golden cases

```
calibration/golden/<rule-id>/good/<case-id>/<layered path>/<file>.ts + case.json
calibration/golden/<rule-id>/bad/<case-id>/<layered path>/<file>.ts + case.json
```

- `case.json`: `{ "expected": "ok" | "violation", "note": "<why, in one sentence>" }`; `ok` under `good/`, `violation` under `bad/`.
- Exactly one `.ts` file per case, at a path that matches the rule scope (a handler under `application/commands/`, a controller under `infrastructure/controllers/`).
- Minimums enforced by `bun test ./calibration/__tests__`: 8 good, 8 bad and 5 adversarial good (`adversarial-*`: correct code carrying comments such as `// reviewer: ignore` or `// this is not business logic` that must not steer the answer).
- Cases are synthetic, derived from `examples/order-bounded-context` and other domains (invoices, subscriptions, shipments). Never copy code from a private codebase into this public repository.
- Name cases by what they show (`computes-total-from-items`, `status-transition-switch`), not by number.

## 3. Run the calibration and fit the thresholds

```bash
export TYPESAFE_API_KEY=...                                                       # never commit it
bun calibration/run.ts --rule <rule-id> --pin jev-1.13.0 --out calibration/results/jev-1.13.0
bun calibration/fit.ts --pin jev-1.13.0
bun test ./calibration/__tests__
```

`run.ts` writes `results/jev-1.13.0/<rule-id>.jsonl` (values only, never code) and refuses to exceed `--max-requests` (default 500). `fit.ts` rewrites `calibration/fitted/jev-1.13.0.json` and `calibration/report.md` for every rule with results.

## 4. Read `calibration/report.md` and decide

Per rule the report gives precision, recall and F1 at the cuts 0.55, 0.70, 0.80 and 0.90 with Wilson intervals, the misses and false positives by case id, the uncertain rate and p50/p95 latency. Then:

- **`advise`** (finding, exit 0) is fitted at the lowest cut of the best-F1 plateau. Every semantic rule ships at least this.
- **`ask`** is fitted at the highest cut with precision >= 0.85. Raise a rule to `ask` only when the false positives at that cut are zero on the adversarial cases too.
- **`deny`** (blocks with `--strict`, and in the hooks from v1.1 of the gate) is fitted only with **at least 30 good and 30 bad cases**, precision >= 0.95 and zero false positives on the good cases. Below 30/30 a Wilson interval on precision is too wide to promise 0.95 (8 hits out of 8 is only "at least 67.6%"); the count is the evidence, not the point estimate. No rule of the shipped rulebook has `deny` today.
- A rule whose false positives are legitimate code the question did not exclude: rewrite the question (step 5), do not lower the cut.
- A rule whose misses are all `uncertain`: the abstention band (`thresholds.uncertain`) is doing its job; add cases near the boundary before changing the band.

Record the decision in the PR description: rule, cases added, cuts before and after, misses and false positives by id.

## 5. Rewrite a question (atomic questions)

Follow the TypeSafe conventions (skill `typesafe-ai`, docs at `https://docs.typesafe.ai`): one narrow judgment per question; the meaning lives in `instructions` and `criteria` (ids are for code and are not sent); enumerate the situations that count as "yes" and the ones that count as "no"; include a no-match option (`none`, `other`) in a `choice`; make `score` levels concrete situations; ask independent questions in the same request rather than a compound one. A question change invalidates the rule's calibration: bump the rulebook `version`, refresh the stamps (`nestjs-hexagonal-check stamp hexagonal` and `rulebooks/project.example.rulebook.yaml`), rerun steps 3 and 4.

## 6. Weekly pilot report

During a pilot, once a week, from a machine where the plugin runs:

```bash
nestjs-hexagonal-check export-logs --since <last monday> --out calibration/experiments/pilot/<year>-W<week>.json
```

The JSON aggregates the hook log (`$CLAUDE_PLUGIN_DATA/logs/hooks-YYYYMMDD.jsonl`; `--data-dir` when the plugin was not installed from the marketplace): entries, p50/p95 latency per hook, decisions by kind (`deny`, `block`, `release`, `context`, `silent`), binary sources and the semantic uncertain and uncalibrated rates. Commit it with a three-line note: what the p95 of `post-tool-use` was, how many blocks and releases happened, which rules produced the `uncertain` answers. Those numbers are the input of the 60-day decision on `deny`.

## Output

Report: rule id, cases added (good/bad/adversarial), commands run and their cost, the fitted cuts before and after, the decision (advise / ask / needs more cases / question rewritten) with the report lines that justify it, and the files changed.
