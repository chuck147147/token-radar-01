# UNMINTED — Token Launch Radar

An offline research dashboard ranking pre-token protocols with a deterministic comparable-token model (`comps-cal-2`).

The model selects among 12 pipelines: category median multiples with shrinkage k=6,
a global power law, and category power laws with parameter shrinkage k=4 or k=12,
each with no overlay or clipped weekly growth weights of 0.25 or 0.5 plus maturity.
Calibration uses 128 positive-cap, positive-TVL traded tokens, sorted by slug into
alternating halves. Every pipeline fits each half and predicts the other; selection
uses pooled median absolute log10 error, with within-2× share breaking ties within
0.005 of the best median. The winner, `power-cat-k12+none`, is refit on all calibration comps; production
uses the category power law without growth or maturity adjustments.
Unknown ages use the median known age of the fit-half comps during cross-fit and
of all calibration comps in production. Smaller or null categories use the global fit.
The dashboard reports the selected formula, candidates, effective multiples at
$100M TVL, and a log-log scatter plot with the global fit.

The same calibration set selects the winner and reports its pooled cross-fit
numbers, so those numbers describe the selection procedure and are mildly
optimistic for the winner. Implied values remain estimates, not predictions.
Tokenless protocols are screened; the complete watchlist is always retained.
Verdicts compare implied/TVL with category board peers (whole-board fallback for
categories with fewer than five rows): farm requires at least $25M implied and
at least the 75th percentile; thin requires at least $25M, or at least $8M and the
40th percentile; all others skip. Positions use the board's own distribution with
no quotas. Each row reports its basis and six farm steps.

Run with Node 22 (TypeScript stripping enabled):

```sh
MAKEFUN_OUTPUT_DIR=/tmp/tr-out node main.ts --input /path/to/snapshot.json
```

Open `/tmp/tr-out/dashboard/index.html`. The page reads the adjacent `data.js`; it needs no server or network. Views and filters can be initialized with `?view=board`, `?view=live`, `?view=method`, `?view=detail&slug=protocol`, `?category=Category`, and `?watchlist=1`.

- `main.ts`: input validation, output generation and packaging.
- `lib/model.ts`: calibration, screening, ranking, plans and browser data contract.
- `dashboard/`: standalone HTML, CSS and JavaScript.
- `vendor/`: dossier builder; `screenshots/`: submission images.
- Generated output: `board.json`, `dossier.json`, `data.js`, dashboard and screenshots.
