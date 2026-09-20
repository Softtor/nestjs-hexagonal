# Experiment E1: Jev on real diff hunks (2026-09-20)

Summary of the experiment that decided which rules became `semantic` and why none of them starts with a `deny` threshold. Only aggregate numbers are recorded here. **The dataset (code hunks from a private codebase) and the per-hunk results are not in this repository**; they live in the private pilot repository of the team that ran the experiment.

## Setup

- 50 hunks taken from historical pull requests of a private NestJS codebase built with this plugin's architecture: 25 with a confirmed P1/P2 review finding and 25 clean.
- Five `noul` questions asked over the hunk only (never the whole file), one request per hunk with all questions together: `fat_controller`, `handler_business_rule`, `tenant_leakage`, `over_engineering`, `insufficient_event_payload`.
- Model `jev-1.13.0` through `POST https://api.typesafe.ai/v1/systemone`.

## Results

| Metric | Value |
|---|---|
| Requests | 50 |
| Latency p50 / p95 | 322 ms / 822 ms |
| Cost | about US$ 0.003 for the whole run |
| Generic precision / recall at p >= 0.55 | 0.89 / 0.64 |
| Adversarial traps (comments trying to steer the answer) | 6 of 7 handled correctly |

Per question:

| Question | Outcome | Consequence |
|---|---|---|
| `fat_controller` | 5 of 6 caught, 0 false positives at p >= 0.70 | strongest signal; `hex/controller-thin` is ready for `advise` and a fitted `ask` |
| `handler_business_rule` | 4 of 5 caught, 2 false positives on legitimate handlers (existence check, re-read after a blocked save, policy check) | `hex/handler-no-business-rules` starts at `advise` only; criteria rewritten to list the orchestration shapes explicitly; needs >= 30/30 golden cases before any `ask`/`deny` |
| `tenant_leakage` | 1 of 6 caught | Jev cannot decide it from a hunk; stays a static rule (`softtor/tenant-scoped-query`) plus human review |
| `over_engineering` | 0 of 4 caught on hunks | needs the whole file; kept as `hex/no-overengineering` (`choice`, `slice: file`) with the countable part in `hex/no-overengineering-static` |
| `insufficient_event_payload` | only synthetic positives existed | stays AST/static (`hex/event-payload-sufficient`) |

## Conclusions applied in this repository

1. No semantic `deny` in v1: the data does not support precision >= 0.95 on any question. `deny` only appears in `calibration/fitted/<pin>.json` after at least 30 good and 30 bad golden cases per rule.
2. Questions must be atomic and list the non-violating shapes explicitly (the two `handler_business_rule` false positives are now `good` golden cases).
3. The state is the enclosing declaration of the change for handlers and controllers, and the whole file only where the property is a file-level one (ports, entities, over-engineering).
4. Comparison with a general-purpose LLM (Haiku 4.5 structured output) is still pending; it was not possible in the experiment environment.
