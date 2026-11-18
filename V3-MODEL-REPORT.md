# V3 model re-validation

Run with Node v24.22.1, using ../token-radar-01-kit/input/snapshot.json. Calibration contains 128 positive-market-cap, positive-TVL protocols sorted by slug. All errors are pooled held-out absolute log10 errors. Two-way training uses the opposite alternating half; five-fold training excludes the index-modulo-5 validation fold. Fold medians are never averaged.

## Adoption decision

Grid winner: **power-cat-k12+vol30** (0.5214 median error; 0.3203 within 2x). Production selected: **power-cat-k12+none**, refit on all 128 comps (two-way 0.5245 / 0.3047).

The different-candidate prerequisite passes. The median-improvement clause misses: 0.5214 > 0.5145. The alternative share clause misses: 0.3203 < 0.3250, although its median guard passes: 0.5214 <= 0.5265. Neither adoption clause fires. Decisions use unrounded values.

Candidates within 0.005 of the minimum are compared by descending within-2x share, then ascending median error, then id. Repeatedly applying this rule after removing each pick yields vol30, vol15, and k12+none; k8's lower median does not overcome its lower share.

## Full candidate results

Five-fold results are supplementary and do not affect selection.

| Candidate | Two-way median | Two-way within 2x | Five-fold median | Five-fold within 2x |
|---|---:|---:|---:|---:|
| power-cat-k12+vol30 | 0.5214 | 0.3203 | 0.5763 | 0.2969 |
| power-cat-k8+none | 0.5219 | 0.2969 | 0.5605 | 0.2891 |
| power-cat-k12+vol15 | 0.5221 | 0.3125 | 0.5704 | 0.2969 |
| power-cat-k12+none | 0.5245 | 0.3047 | 0.5582 | 0.2813 |
| power-cat-k20+none | 0.5310 | 0.2969 | 0.5582 | 0.2969 |
| power-cat-k12-age+none | 0.5320 | 0.3125 | 0.5680 | 0.2969 |
| power-cat-k4+g50m | 0.5328 | 0.3203 | 0.5778 | 0.2734 |
| power-cat-k4+none | 0.5368 | 0.3125 | 0.5684 | 0.2891 |
| power-global+g50m | 0.5387 | 0.2969 | 0.5502 | 0.2813 |
| power-cat-k12+g25m | 0.5393 | 0.3203 | 0.5787 | 0.2969 |
| power-global+g25m | 0.5393 | 0.3125 | 0.5361 | 0.2891 |
| power-global+none | 0.5397 | 0.3125 | 0.5574 | 0.2969 |
| power-cat-k4+g25m | 0.5401 | 0.3359 | 0.5775 | 0.2891 |
| power-cat-k12-trim+none | 0.5448 | 0.2891 | 0.5607 | 0.2891 |
| power-cat-k12+g50m | 0.5456 | 0.3125 | 0.5739 | 0.2969 |
| power-cat-k12+chains05 | 0.5490 | 0.3125 | 0.5894 | 0.2734 |
| power-cat-k12+chains10 | 0.5622 | 0.3047 | 0.5744 | 0.2813 |
| median+none | 0.7175 | 0.2969 | 0.7361 | 0.2734 |
| median+g50m | 0.7443 | 0.2969 | 0.7343 | 0.2500 |
| median+g25m | 0.7539 | 0.2969 | 0.7376 | 0.2500 |

## Top three supplementary check

| Two-way pick | Five-fold median | Five-fold within 2x |
|---|---:|---:|
| power-cat-k12+vol30 | 0.5763 | 0.2969 |
| power-cat-k12+vol15 | 0.5704 | 0.2969 |
| power-cat-k12+none | 0.5582 | 0.2813 |

The selected model has 36/128 five-fold predictions within 2x, exactly 0.28125. Existing JavaScript Math.round reporting gives 0.2813; the supplied reference gives 0.2812 (a rounding-tie difference of 0.0001). All 20 two-way references match at four decimals; all supplementary references are within 0.001.

## Trim and age fits

Trim fits OLS once, computes residuals and their median-centered MAD, removes observations with absolute residual above 2.5 MAD, and refits once. Fewer than two survivors or TVL sum-of-squares below 1e-12 keeps the initial fit. Category shrinkage uses the original category count, with k=12; categories below five members and null categories use the global fit.

Age uses log10(1 + ageDays/365), with missing ages imputed from the training fold only. Centered two-predictor normal equations estimate a, b, d. A determinant <= 1e-12 falls back to the global d for a category, fitting intercept and TVL slope conditional on that d (global fallback d=0). All three category coefficients shrink toward the global coefficients with k=12 and original n.

| Training set | n | Imputed age days | Trim survivors (global) | Trim a | Trim b | Age a | Age b | Age d |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A (even indices) | 64 | 990 | 53 | 3.3819 | 0.4790 | 3.7241 | 0.4758 | -0.7047 |
| B (odd indices) | 64 | 1004.5 | 58 | 2.4985 | 0.5933 | 3.0013 | 0.5182 | 0.1689 |
| All comps | 128 | 1000 | 111 | 2.7924 | 0.5565 | 3.1809 | 0.5197 | -0.2493 |

## Evidence and verification

Dashboard rows include the actual selected fit parameters, category calibration count, global-fallback flag, and three nearest calibration comps by absolute log10 TVL distance, with slug tie-breaking. Category pools require five members; otherwise the global pool is used. Evidence is associated with board objects in a WeakMap so it is emitted only in dashboard rows, preserving board serialization. Verified evidence counts, nearest peers, reconstructed valuations, and radarRow output for every row.

Acceptance command:

```sh
mkdir -p /tmp/tr-a-out
MAKEFUN_OUTPUT_DIR=/tmp/tr-a-out node main.ts --input ../token-radar-01-kit/input/snapshot.json
sha256sum /tmp/tr-a-out/board.json
```

Board SHA-256 unchanged: `089f060818bc7176993d86cbc0cccc40d08e73b253ca26a446ae45c999cbcefa`. Main completed successfully, including board self-check and dossier generation.

## Skipped candidate

A category-relative size overlay (s=0.2) was considered and skipped because its reference set changes from calibration peers during fitting to board peers at prediction time, and this comps predictor has no board-peer distribution on the prediction path.
