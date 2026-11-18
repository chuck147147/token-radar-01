# V5 candidate evaluation

Snapshot: `../token-radar-01-kit/input/snapshot.json`. Runtime: system Node v24.22.1. Calibration contains 128 rows with `mcap_usd > 0` and `tvl_usd > 0`, sorted by slug. Two-way folds use `index % 2`, training on the opposite half. Supplementary five-fold uses `index % 5`, training on the other four folds. Each row is validated once per protocol. Errors are pooled held-out `abs(log10(prediction / mcap))`; within-2x is the share at or below `log10(2)`. Tables sort by unrounded median error, then candidate ID, and report four decimals.

## Regression checks

All 20 existing candidates reproduced exactly at four decimals in both protocols, in both `evaluateCandidates` and `evaluateExploration`, against evaluation JSON captured before edits. The existing `topThree` result also reproduced exactly. Incumbent `power-cat-k12+none`: two-way **0.5245 / 0.3047**; five-fold **0.5582 / 0.2813** (median / within-2x share).

`select()`, the production grid, `MODEL`, and `MODEL_VERSION` remain textually unchanged. Exploration has 39 candidates (20 existing + 19 new).

Command: `MAKEFUN_OUTPUT_DIR=/tmp/tr-v5-out node main.ts --input ../token-radar-01-kit/input/snapshot.json`.

`board.json` SHA-256: `089f060818bc7176993d86cbc0cccc40d08e73b253ca26a446ae45c999cbcefa` — exact match before and after changes.

## Two-way cross-fit

| Candidate | Median absolute log10 error | Within-2x share |
|---|---:|---:|
| power-cat-k12-huber+none | 0.5152 | 0.2891 |
| power-cat-k12+vol30 | 0.5214 | 0.3203 |
| ens-med5+none | 0.5219 | 0.3047 |
| power-cat-k8+none | 0.5219 | 0.2969 |
| ens-top3+none | 0.5221 | 0.3125 |
| power-cat-k12+vol15 | 0.5221 | 0.3125 |
| ens-med3+none | 0.5245 | 0.3047 |
| power-cat-k12+none | 0.5245 | 0.3047 |
| power-cat-k12-min5m+none | 0.5245 | 0.3047 |
| power-cat-k12-minn3+none | 0.5245 | 0.2813 |
| power-cat-k16+none | 0.5267 | 0.2891 |
| power-cat-k12-fixb+none | 0.5277 | 0.3047 |
| power-cat-k6+none | 0.5277 | 0.2969 |
| power-cat-k20+none | 0.5310 | 0.2969 |
| power-cat-k24+none | 0.5318 | 0.2969 |
| power-cat-k12-age+none | 0.5320 | 0.3125 |
| power-cat-k12-blend50+none | 0.5328 | 0.3047 |
| power-cat-k4+g50m | 0.5328 | 0.3203 |
| power-cat-k32+none | 0.5330 | 0.3047 |
| power-cat-k12-wtvl+none | 0.5348 | 0.2422 |
| power-cat-k2+none | 0.5368 | 0.3125 |
| power-cat-k4+none | 0.5368 | 0.3125 |
| power-global+g50m | 0.5387 | 0.2969 |
| power-cat-k12+g25m | 0.5393 | 0.3203 |
| power-global+g25m | 0.5393 | 0.3125 |
| power-cat-k12-minn8+none | 0.5397 | 0.2969 |
| power-global+none | 0.5397 | 0.3125 |
| power-cat-k4+g25m | 0.5401 | 0.3359 |
| power-cat-k12-l1+none | 0.5414 | 0.2969 |
| power-cat-k12-chg+none | 0.5425 | 0.2500 |
| power-cat-k12-screen+none | 0.5432 | 0.2656 |
| power-cat-k12-trim+none | 0.5448 | 0.2891 |
| power-cat-k12+g50m | 0.5456 | 0.3125 |
| power-cat-k12+chains05 | 0.5490 | 0.3125 |
| power-cat-k12+chains10 | 0.5622 | 0.3047 |
| power-cat-k12-min25m+none | 0.5901 | 0.2813 |
| median+none | 0.7175 | 0.2969 |
| median+g50m | 0.7443 | 0.2969 |
| median+g25m | 0.7539 | 0.2969 |

## Five-fold cross-fit (supplementary)

| Candidate | Median absolute log10 error | Within-2x share |
|---|---:|---:|
| power-global+g25m | 0.5361 | 0.2891 |
| power-global+g50m | 0.5502 | 0.2813 |
| power-cat-k12-fixb+none | 0.5502 | 0.3047 |
| power-cat-k12-min25m+none | 0.5530 | 0.2891 |
| power-global+none | 0.5574 | 0.2969 |
| power-cat-k12-minn3+none | 0.5579 | 0.2813 |
| ens-med5+none | 0.5582 | 0.2891 |
| power-cat-k12+none | 0.5582 | 0.2813 |
| power-cat-k12-min5m+none | 0.5582 | 0.2813 |
| power-cat-k12-minn8+none | 0.5582 | 0.2813 |
| power-cat-k16+none | 0.5582 | 0.2969 |
| power-cat-k20+none | 0.5582 | 0.2969 |
| power-cat-k24+none | 0.5582 | 0.2969 |
| ens-med3+none | 0.5605 | 0.2891 |
| power-cat-k8+none | 0.5605 | 0.2891 |
| power-cat-k12-trim+none | 0.5607 | 0.2891 |
| power-cat-k12-l1+none | 0.5613 | 0.2813 |
| power-cat-k12-screen+none | 0.5614 | 0.2422 |
| power-cat-k6+none | 0.5637 | 0.2891 |
| power-cat-k12-blend50+none | 0.5639 | 0.2969 |
| power-cat-k32+none | 0.5649 | 0.2891 |
| power-cat-k12-age+none | 0.5680 | 0.2969 |
| power-cat-k4+none | 0.5684 | 0.2891 |
| ens-top3+none | 0.5704 | 0.2969 |
| power-cat-k12+vol15 | 0.5704 | 0.2969 |
| power-cat-k12+g50m | 0.5739 | 0.2969 |
| power-cat-k12-huber+none | 0.5740 | 0.2969 |
| power-cat-k12+chains10 | 0.5744 | 0.2813 |
| power-cat-k2+none | 0.5750 | 0.2813 |
| power-cat-k12+vol30 | 0.5763 | 0.2969 |
| power-cat-k4+g25m | 0.5775 | 0.2891 |
| power-cat-k4+g50m | 0.5778 | 0.2734 |
| power-cat-k12+g25m | 0.5787 | 0.2969 |
| power-cat-k12-chg+none | 0.5791 | 0.2578 |
| power-cat-k12-wtvl+none | 0.5849 | 0.3047 |
| power-cat-k12+chains05 | 0.5894 | 0.2734 |
| median+g50m | 0.7343 | 0.2500 |
| median+none | 0.7361 | 0.2734 |
| median+g25m | 0.7376 | 0.2500 |

## Training filter survivors

Fold numbering is zero-based. Validation rows are never filtered. Category sizes are computed after filtering. Counts below precede any regression-specific residual trimming.

| Folds | Held-out fold | Training rows | min5m survivors | min25m survivors | screen survivors |
|---:|---:|---:|---:|---:|---:|
| 2 | 0 | 64 | 64 | 40 | 47 |
| 2 | 1 | 64 | 64 | 29 | 47 |
| 5 | 0 | 102 | 102 | 56 | 78 |
| 5 | 1 | 102 | 102 | 52 | 76 |
| 5 | 2 | 102 | 102 | 59 | 79 |
| 5 | 3 | 103 | 103 | 50 | 76 |
| 5 | 4 | 103 | 103 | 59 | 72 |

## Implementation notes

- Each base is fitted once per training fold; overlays are applied to individual held-out predictions. Ensembles take the median of component dollar predictions for each row, before computing errors.
- Fixed-slope category intercepts minimize squared log residuals at the global slope, then shrink toward the global intercept with k=12. The stored category slope is exactly the global slope.
- Huber and L1 start from OLS and perform 30 reweighting iterations, except the specified Huber near-zero-scale fallback. Huber MAD is centered at the residual median; its weights use absolute residuals. TVL weights are `sqrt(tvl_usd)`.
- Change uses the age regression solver with the clipped change covariate and identical coefficient shrinkage. The internal `d` slot holds the change coefficient (e); existing age arithmetic is preserved.
- Categories below their configured minimum, unseen categories, and null categories use the global fit. Degenerate category fits retain the global parameters. An empty filtered training set raises `SnapshotError` rather than reintroducing excluded rows; none occurred here.
- `evaluateExploration(snapshot, diagnostics?)` returns only `{twoWay, fiveFold}`. An optional caller-owned diagnostics array records per-base, per-fold survivor counts and numerical fallback notes without shared mutable state.

Numerical fallbacks observed (one fit event per row below):

| Folds | Held-out fold | Base | Fallback |
|---:|---:|---|---|
| 5 | 1 | power-cat-k12-trim | Category Basis Trading: Trim survivors < 2: OLS fallback |
| 5 | 3 | power-cat-k12-age | Category Canonical Bridge: Covariate determinant <= 1e-12: inherited coefficient |

No numerical fallback was recorded for any new base. No Huber scale fallback occurred on this snapshot. Standard global fallback for insufficient category size remains active.

## Validation and reproduction

`node v5-eval.ts` prints both evaluation objects as JSON, including complete two-way and five-fold tables.

Strict TypeScript checking passed for `lib/model.ts` and `v5-eval.ts` with `strict` and `noUncheckedIndexedAccess`. Targeted numerical checks passed for snapshot-order invariance, fixed-slope intercepts, geometric blending, unit-weight WLS equivalence to OLS, synthetic Huber zero-scale fallback, missing-change equivalence to the one-predictor fit, filter-only training fits, and independently pooled per-row ensemble errors in both protocols. Regression comparisons and the final board hash passed.
