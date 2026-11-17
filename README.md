# UNMINTED — Token Launch Radar

An offline research dashboard ranking pre-token protocols with a deterministic comparable-token model (`comps-cal-1`).

The model fits market-cap/TVL medians from positive-cap, positive-TVL traded tokens.
Category medians with at least five comps are shrunk toward the global median using six global observations.
Smaller or null categories use the global median.
TVL is multiplied by that fit, a clipped weekly growth adjustment, and a maturity factor.
Tokenless protocols are screened; the complete watchlist is always retained.
Explicit value and value/TVL thresholds assign farm, thin, or skip verdicts and six farm steps.
An alternating-slug holdout test reports dispersion; implied values are estimates, not predictions.

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
