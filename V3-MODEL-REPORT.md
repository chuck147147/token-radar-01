# Token Radar calibration candidate review

## Adoption decision

Production stays on **`power-cat-k12+none` (`comps-cal-2`)**. The two-way grid winner was `power-cat-k12+vol30`, with median absolute log10 error of 0.521448 and a within-2× share of 0.3203125 (41/128). It differed from the v2 winner, but neither adoption clause fired.

- The median improvement clause required error ≤ 0.5145. The winner scored 0.521448.
- The within-2× clause required share ≥ 0.325 and median error ≤ 0.5265. The winner cleared the error limit and missed the share threshold.

## Cross-fit results

Both protocols use the same 128 snapshot records with positive market cap and TVL, sorted by slug. Two-way training and validation alternate even and odd halves. Five-fold validation uses index modulo five. In each protocol, every observation receives one held-out prediction. The pooled metrics are the median absolute log10 prediction error and the share of errors at or below log10(2).

The two-way winner comes from the candidates within 0.005 of the minimum median error, ranked by largest within-2× share, then lowest median error, then candidate ID. Pooled two-way OOS numbers are mildly optimistic for the grid winner. Five-fold scores are supplementary and do not affect adoption.

| Candidate | Two-way median error | Two-way within 2× | Five-fold median error | Five-fold within 2× |
|---|---:|---:|---:|---:|
| `power-cat-k12+vol30` | 0.5214 | 0.3203 | 0.5763 | 0.2969 |
| `power-cat-k8+none` | 0.5219 | 0.2969 | 0.5605 | 0.2891 |
| `power-cat-k12+vol15` | 0.5221 | 0.3125 | 0.5704 | 0.2969 |
| `power-cat-k12+none` | 0.5245 | 0.3047 | 0.5582 | 0.2812 |
| `power-cat-k20+none` | 0.5310 | 0.2969 | 0.5582 | 0.2969 |
| `power-cat-k12-age+none` | 0.5320 | 0.3125 | 0.5680 | 0.2969 |
| `power-cat-k4+g50m` | 0.5328 | 0.3203 | 0.5778 | 0.2734 |
| `power-cat-k4+none` | 0.5368 | 0.3125 | 0.5684 | 0.2891 |
| `power-global+g50m` | 0.5387 | 0.2969 | 0.5502 | 0.2812 |
| `power-cat-k12+g25m` | 0.5393 | 0.3203 | 0.5787 | 0.2969 |
| `power-global+g25m` | 0.5393 | 0.3125 | 0.5361 | 0.2891 |
| `power-global+none` | 0.5397 | 0.3125 | 0.5574 | 0.2969 |
| `power-cat-k4+g25m` | 0.5401 | 0.3359 | 0.5775 | 0.2891 |
| `power-cat-k12-trim+none` | 0.5448 | 0.2891 | 0.5607 | 0.2891 |
| `power-cat-k12+g50m` | 0.5456 | 0.3125 | 0.5739 | 0.2969 |
| `power-cat-k12+chains05` | 0.5490 | 0.3125 | 0.5894 | 0.2734 |
| `power-cat-k12+chains10` | 0.5622 | 0.3047 | 0.5744 | 0.2812 |
| `median+none` | 0.7175 | 0.2969 | 0.7361 | 0.2734 |
| `median+g50m` | 0.7443 | 0.2969 | 0.7343 | 0.2500 |
| `median+g25m` | 0.7539 | 0.2969 | 0.7376 | 0.2500 |

## Five-fold check for the two-way leaders

The top three apply the two-way selection rule repeatedly, removing each pick before ranking the rest. The third pick is also the v2 winner.

| Two-way rank | Candidate | Five-fold median error | Five-fold within 2× |
|---:|---|---:|---:|
| 1 | `power-cat-k12+vol30` | 0.5763 | 0.2969 |
| 2 | `power-cat-k12+vol15` | 0.5704 | 0.2969 |
| 3 | `power-cat-k12+none` | 0.5582 | 0.2812 |

The v2 winner had lower five-fold median error than either volatility overlay. Both volatility overlays had higher five-fold within-2× share.

## Fit details and skipped candidate

- Trimmed OLS uses the median absolute deviation about the median residual. It refits once after dropping points whose absolute residual exceeds 2.5 times that deviation, with the initial fit retained if trimming leaves insufficient TVL variation. Category shrinkage uses the original training category count.
- The age variant imputes missing ages with the training fold median and shrinks category coefficients toward the global fit with k=12. When a category's age coefficient is unstable, it uses the global age coefficient and fits the intercept and TVL slope conditional on that coefficient.
- The category-relative size overlay (s=0.2) was skipped. The proposed reference set changes from calibration peers during fitting to board peers at prediction time. The comps predictor scores individual protocols against a fitted calibration model and has no board-peer distribution on that path. Reusing the calibration distribution at prediction time would change the proposed overlay.
