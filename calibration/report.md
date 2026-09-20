# Calibration report for jev-1.13.0

Generated 2026-09-20T21:11:24.451Z against rulebook `hexagonal` 1.3.0. Cuts are applied to the noul probability or to the probability mass on the violating options/levels, reproducing the runtime decision: a noul inside the uncertain band or a choice/score below minConfidence counts as uncertain (never TP nor FP, a miss for recall). Intervals are 95% Wilson. `deny` is fitted only with at least 30 good and 30 bad cases, precision >= 0.95 and zero false positives on the good cases. Every fitted cut is restricted to values at or above the rule's uncertain band `hi`; `advise` takes the lowest cut of the best-F1 plateau, `ask` and `deny` take the highest cut of their plateau.

## Summary

| Rule | Primitive | Good | Bad | Errors | Advise | Ask | Deny | Uncertain rate | p50 ms | p95 ms | Models | Also caught by static? (does not count) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `hex/controller-thin` | noul | 16 | 8 | 0 | 0.65 | 0.95 | omitted | 0.0% | 317 | 378 | jev-1.13.0 | TODO=false |
| `hex/entity-not-anemic` | noul | 13 | 8 | 0 | 0.65 | 0.9 | omitted | 14.3% | 310 | 364 | jev-1.13.0 | TODO=false |
| `hex/handler-no-business-rules` | noul | 15 | 10 | 0 | 0.65 | 0.85 | omitted | 0.0% | 314 | 796 | jev-1.13.0 | TODO=false |
| `hex/no-overengineering` | choice | 13 | 8 | 0 | 0.65 | 0.95 | omitted | 14.3% | 302 | 362 | jev-1.13.0 | TODO=false |
| `hex/port-no-infra-leak` | noul | 13 | 10 | 0 | 0.65 | 0.95 | omitted | 0.0% | 312 | 413 | jev-1.13.0 | TODO=false |

## hex/controller-thin

Primitive noul, 16 good and 8 bad cases, 0 error(s), 22076 input tokens, uncertain rate 0.0%. Cuts restricted to >= hi=0.65; advise at the lowest cut of the best-F1 plateau, ask and deny at the highest cut of their plateau.

`deny` omitted: needs at least 30 good and 30 bad cases (have 16/8).

| Cut | TP | FP | FN | TN | Uncertain | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|---|
| 0.55 | 8 | 0 | 0 | 16 | 0 | 100.0% [67.6%, 100.0%] | 100.0% [67.6%, 100.0%] | 1.000 |
| 0.7 | 8 | 0 | 0 | 16 | 0 | 100.0% [67.6%, 100.0%] | 100.0% [67.6%, 100.0%] | 1.000 |
| 0.8 | 8 | 0 | 0 | 16 | 0 | 100.0% [67.6%, 100.0%] | 100.0% [67.6%, 100.0%] | 1.000 |
| 0.9 | 8 | 0 | 0 | 16 | 0 | 100.0% [67.6%, 100.0%] | 100.0% [67.6%, 100.0%] | 1.000 |

At the fitted advise cut 0.65: effective recall 100.0% (uncertain answers count as misses; 0 uncertain); 0 miss(es) ; 0 false positive(s) .

Also caught by static? does not count: TODO=false (no static overlap has been measured yet).

## hex/entity-not-anemic

Primitive noul, 13 good and 8 bad cases, 0 error(s), 16541 input tokens, uncertain rate 14.3%. Cuts restricted to >= hi=0.65; advise at the lowest cut of the best-F1 plateau, ask and deny at the highest cut of their plateau.

`deny` omitted: needs at least 30 good and 30 bad cases (have 13/8).

| Cut | TP | FP | FN | TN | Uncertain | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|---|
| 0.55 | 4 | 0 | 4 | 13 | 3 | 100.0% [51.0%, 100.0%] | 50.0% [21.5%, 78.5%] | 0.667 |
| 0.7 | 4 | 0 | 4 | 13 | 3 | 100.0% [51.0%, 100.0%] | 50.0% [21.5%, 78.5%] | 0.667 |
| 0.8 | 4 | 0 | 4 | 13 | 3 | 100.0% [51.0%, 100.0%] | 50.0% [21.5%, 78.5%] | 0.667 |
| 0.9 | 4 | 0 | 4 | 13 | 3 | 100.0% [51.0%, 100.0%] | 50.0% [21.5%, 78.5%] | 0.667 |

At the fitted advise cut 0.65: effective recall 50.0% (uncertain answers count as misses; 3 uncertain: factory-applies-event-getters-only, update-assigns-all-props, with-status-immutable-copier); 4 miss(es) (behavior-named-setters, factory-applies-event-getters-only, update-assigns-all-props, with-status-immutable-copier); 0 false positive(s) .

Also caught by static? does not count: TODO=false (no static overlap has been measured yet).

## hex/handler-no-business-rules

Primitive noul, 15 good and 10 bad cases, 0 error(s), 23268 input tokens, uncertain rate 0.0%. Cuts restricted to >= hi=0.65; advise at the lowest cut of the best-F1 plateau, ask and deny at the highest cut of their plateau.

`deny` omitted: needs at least 30 good and 30 bad cases (have 15/10).

| Cut | TP | FP | FN | TN | Uncertain | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|---|
| 0.55 | 10 | 0 | 0 | 15 | 0 | 100.0% [72.2%, 100.0%] | 100.0% [72.2%, 100.0%] | 1.000 |
| 0.7 | 10 | 0 | 0 | 15 | 0 | 100.0% [72.2%, 100.0%] | 100.0% [72.2%, 100.0%] | 1.000 |
| 0.8 | 10 | 0 | 0 | 15 | 0 | 100.0% [72.2%, 100.0%] | 100.0% [72.2%, 100.0%] | 1.000 |
| 0.9 | 9 | 0 | 1 | 15 | 0 | 100.0% [70.1%, 100.0%] | 90.0% [59.6%, 98.2%] | 0.947 |

At the fitted advise cut 0.65: effective recall 100.0% (uncertain answers count as misses; 0 uncertain); 0 miss(es) ; 0 false positive(s) .

Also caught by static? does not count: TODO=false (no static overlap has been measured yet).

## hex/no-overengineering

Primitive choice, 13 good and 8 bad cases, 0 error(s), 19394 input tokens, uncertain rate 14.3%. Cuts restricted to >= hi=0.65; advise at the lowest cut of the best-F1 plateau, ask and deny at the highest cut of their plateau.

`deny` omitted: needs at least 30 good and 30 bad cases (have 13/8).

| Cut | TP | FP | FN | TN | Uncertain | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|---|
| 0.55 | 8 | 0 | 0 | 10 | 3 | 100.0% [67.6%, 100.0%] | 100.0% [67.6%, 100.0%] | 1.000 |
| 0.7 | 8 | 0 | 0 | 10 | 3 | 100.0% [67.6%, 100.0%] | 100.0% [67.6%, 100.0%] | 1.000 |
| 0.8 | 8 | 0 | 0 | 10 | 3 | 100.0% [67.6%, 100.0%] | 100.0% [67.6%, 100.0%] | 1.000 |
| 0.9 | 8 | 0 | 0 | 10 | 3 | 100.0% [67.6%, 100.0%] | 100.0% [67.6%, 100.0%] | 1.000 |

At the fitted advise cut 0.65: effective recall 100.0% (uncertain answers count as misses; 3 uncertain: adversarial-mapper-claims-redundant, adversarial-rule-not-apply-read-model, inventory-low-stock-aggregation); 0 miss(es) ; 0 false positive(s) .

Also caught by static? does not count: TODO=false (no static overlap has been measured yet).

## hex/port-no-infra-leak

Primitive noul, 13 good and 10 bad cases, 0 error(s), 13703 input tokens, uncertain rate 0.0%. Cuts restricted to >= hi=0.65; advise at the lowest cut of the best-F1 plateau, ask and deny at the highest cut of their plateau.

`deny` omitted: needs at least 30 good and 30 bad cases (have 13/10).

| Cut | TP | FP | FN | TN | Uncertain | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|---|
| 0.55 | 10 | 0 | 0 | 13 | 0 | 100.0% [72.2%, 100.0%] | 100.0% [72.2%, 100.0%] | 1.000 |
| 0.7 | 10 | 0 | 0 | 13 | 0 | 100.0% [72.2%, 100.0%] | 100.0% [72.2%, 100.0%] | 1.000 |
| 0.8 | 10 | 0 | 0 | 13 | 0 | 100.0% [72.2%, 100.0%] | 100.0% [72.2%, 100.0%] | 1.000 |
| 0.9 | 10 | 0 | 0 | 13 | 0 | 100.0% [72.2%, 100.0%] | 100.0% [72.2%, 100.0%] | 1.000 |

At the fitted advise cut 0.65: effective recall 100.0% (uncertain answers count as misses; 0 uncertain); 0 miss(es) ; 0 false positive(s) .

Also caught by static? does not count: TODO=false (no static overlap has been measured yet).
