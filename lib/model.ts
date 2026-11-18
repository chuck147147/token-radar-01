/** Deterministic comparable-token calibration and pre-token screening. */
export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export const MODEL_VERSION = 'comps-cal-2';
export const MODEL = {
  category_min_n: 5, shrinkage_k: 6, growth_clip_pct: 50, growth_weight: 0.5,
  maturity_floor: 0.7, maturity_range: 0.3, maturity_days: 1460,
};
export const LIVE_ROWS = 24;
export type Verdict = 'farm' | 'thin' | 'skip';
export interface BoardRow extends SnapshotProtocol {
  rank: number; token_status: 'pre-token'; age_days: number | null;
  implied_value_usd: number; watchlist: boolean; verdict: Verdict;
  model: { base_multiple: number; growth_pct: number; growth_multiplier: number;
    maturity_multiplier: number; age_days: number | null };
  verdict_basis: { ratio: number; category_median_ratio: number; ratio_percentile: number; reference_n: number };
  farm_steps: string[];
}
export type RadarRow = Pick<BoardRow, 'rank' | 'slug' | 'name' | 'category' | 'chains' |
  'tvl_usd' | 'change_7d' | 'listed_at' | 'age_days' | 'implied_value_usd' | 'watchlist' | 'verdict' | 'farm_steps'> &
  Evidence & { base_multiple: number; growth_multiplier: number; maturity_multiplier: number; ratio_percentile: number; category_median_ratio: number; reference_n: number };
export type LiveRow = Pick<SnapshotProtocol, 'slug' | 'name' | 'category' | 'chains' | 'tvl_usd' | 'mcap_usd' | 'change_7d'>;
interface ValuationFit { category_n: number; global: boolean; a: number | null; b: number | null; d?: number }
interface Evidence { valuation_fit: ValuationFit; nearest_comps: { name: string; tvl_usd: number; mcap_usd: number; mcap_tvl_ratio: number }[] }
const rowEvidence = new WeakMap<BoardRow, Evidence>();
interface CategoryFit { category: string; n: number; multiple: number; a: number | null; b: number | null; d?: number }
interface Candidate { id: string; median_abs_log10_error: number; within_2x_share: number }
interface OOS { folds: number; n_fit: number; n_validation: number; median_abs_log10_error: number; within_2x_share: number }
interface Screened {
  tokenless_total: number; excluded_total: number;
  by_reason: { category: number; versioned: number; wrapped_or_staked_name: number; exchange_prefix: number };
  board_size: number;
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: typeof MODEL; model_version: string;
  watchlist_size: number; board_size: number; early_size: number; live_size: number;
  rows: RadarRow[]; live: LiveRow[];
  methodology: {
    model_version: string; calibration_n: number; calibration_excluded_nonpositive: number; global_multiple: number; categories: CategoryFit[];
    form: string; form_label: string; formula_text: string; global_a: number | null; global_b: number | null;
    ref_tvl_usd: number; candidates: Candidate[]; winner_id: string; selected_id: string; selection_note: string;
    scatter: { points: number[][]; line: { x1: number; y1: number; x2: number; y2: number } };
    global_fallback: string; calibration_policy: string; oos: OOS; growth_clip_pct: number; growth_weight: number;
    maturity_floor: number; maturity_days: number; default_age_days: number;
    screened: Screened; watchlist_size: number; early_size: number;
  };
}
export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
function median(values: number[]): number {
  if (!values.length) throw new SnapshotError('Cannot fit a median without observations');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const delta = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`);
  return Number.isFinite(delta) ? Math.max(0, Math.floor(delta / 86400000)) : null;
}
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}
const EXCLUDED = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
function exclusion(p: SnapshotProtocol): keyof Screened['by_reason'] | null {
  if (p.category !== null && EXCLUDED.has(p.category)) return 'category';
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return 'versioned';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'wrapped_or_staked_name';
  if (/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/.test(p.name)) return 'exchange_prefix';
  return null;
}
export function isRankable(p: SnapshotProtocol): boolean { return isPreToken(p) && exclusion(p) === null; }
/** Keep unrounded fitted values for calculations; round only the reported multipliers. */
type ExplorationBase = `power-cat-k${2 | 6 | 16 | 24 | 32}` | `power-cat-k12-${'fixb' | 'huber' | 'l1' | 'wtvl' | 'min5m' | 'min25m' | 'screen' | 'minn3' | 'minn8' | 'blend50' | 'chg'}`;
type Base = ExplorationBase | 'median' | 'power-global' | 'power-cat-k4' | 'power-cat-k12' | 'power-cat-k8' | 'power-cat-k20' | 'power-cat-k12-trim' | 'power-cat-k12-age';
type Overlay = 'none' | 'g25m' | 'g50m' | 'chains05' | 'chains10' | 'vol15' | 'vol30';
const REF = 1e8;
function ols(ps: SnapshotProtocol[]) {
  const xs = ps.map(p => Math.log10(p.tvl_usd)), ys = ps.map(p => Math.log10(p.mcap_usd!));
  const x = xs.reduce((a,b) => a+b,0)/ps.length, y = ys.reduce((a,b) => a+b,0)/ps.length;
  const denominator = xs.reduce((sum,v) => sum+(v-x)**2,0);
  const b = denominator < 1e-12 ? 1 : xs.reduce((sum,v,i) => sum+(v-x)*(ys[i]!-y),0)/denominator;
  return { a: y-b*x, b, denominator };
}
/** Centered weighted least squares, using the same degenerate-slope convention as OLS. */
function weightedOls(ps: SnapshotProtocol[], weights: number[]) {
  const xs = ps.map(p => Math.log10(p.tvl_usd)), ys = ps.map(p => Math.log10(p.mcap_usd!));
  const total = weights.reduce((a,b) => a+b,0);
  const x = xs.reduce((s,v,i) => s+weights[i]!*v,0)/total;
  const y = ys.reduce((s,v,i) => s+weights[i]!*v,0)/total;
  const denominator = xs.reduce((s,v,i) => s+weights[i]!*(v-x)**2,0);
  const b = denominator < 1e-12 ? 1 : xs.reduce((s,v,i) => s+weights[i]!*(v-x)*(ys[i]!-y),0)/denominator;
  return { a: y-b*x, b, denominator };
}
type FitNote = (note: string) => void;
function robust(ps: SnapshotProtocol[], huber: boolean, note?: FitNote) {
  const initial = ols(ps);
  let current = initial;
  for (let i=0;i<30;i++) {
    const residuals = ps.map(p => Math.log10(p.mcap_usd!)-current.a-current.b*Math.log10(p.tvl_usd));
    let weights: number[];
    if (huber) {
      const center = median(residuals), sigma = 1.4826*median(residuals.map(r => Math.abs(r-center)));
      if (sigma < 1e-12) { note?.('Huber sigma < 1e-12: OLS fallback'); return initial; }
      const delta = 1.345*sigma;
      weights = residuals.map(r => Math.abs(r) <= delta ? 1 : delta/Math.abs(r));
    } else weights = residuals.map(r => 1/Math.max(Math.abs(r),1e-6));
    current = weightedOls(ps,weights);
    if (current.denominator < 1e-12) note?.('Weighted denominator < 1e-12: slope 1');
  }
  return current;
}
const changeZ = (p: SnapshotProtocol): number => Math.max(-50,Math.min(50,p.change_7d ?? 0))/50;
function trainingFor(protocols: SnapshotProtocol[], form: Base): SnapshotProtocol[] {
  if (form === 'power-cat-k12-min5m') return protocols.filter(p => p.tvl_usd >= 5e6);
  if (form === 'power-cat-k12-min25m') return protocols.filter(p => p.tvl_usd >= 25e6);
  if (form === 'power-cat-k12-screen') {
    const center = median(protocols.map(p => Math.log10(p.mcap_usd!/p.tvl_usd)));
    return protocols.filter(p => Math.abs(Math.log10(p.mcap_usd!/p.tvl_usd)-center) <= 1);
  }
  return protocols;
}
/** One residual-based trimming pass; MAD is centered at the residual median. */
function trimmed(ps: SnapshotProtocol[], note?: FitNote) {
  const initial = ols(ps);
  const residuals = ps.map(p => Math.log10(p.mcap_usd!)-initial.a-initial.b*Math.log10(p.tvl_usd));
  const center = median(residuals), mad = median(residuals.map(r => Math.abs(r-center)));
  const survivors = ps.filter((_,i) => Math.abs(residuals[i]!) <= 2.5*mad);
  if (survivors.length < 2) { note?.('Trim survivors < 2: OLS fallback'); return initial; }
  const next = ols(survivors);
  if (next.denominator < 1e-12) note?.('Trim denominator < 1e-12: OLS fallback');
  return next.denominator >= 1e-12 ? next : initial;
}
function ageFit(ps: SnapshotProtocol[], asOf: string, defaultAge: number, fallbackD = 0, change = false, note?: FitNote) {
  const xs = ps.map(p => Math.log10(p.tvl_usd));
  const zs = ps.map(p => change ? changeZ(p) : Math.log10(1+(ageDays(asOf,p.listed_at) ?? defaultAge)/365));
  const ys = ps.map(p => Math.log10(p.mcap_usd!));
  const mean = (v: number[]) => v.reduce((a,b) => a+b,0)/v.length;
  const x = mean(xs), z = mean(zs), y = mean(ys);
  const cov = (u: number[], v: number[], um: number, vm: number) => u.reduce((s,t,i) => s+(t-um)*(v[i]!-vm),0);
  const xx = cov(xs,xs,x,x), zz = cov(zs,zs,z,z), xz = cov(xs,zs,x,z);
  const xy = cov(xs,ys,x,y), zy = cov(zs,ys,z,y), det = xx*zz-xz*xz;
  if (det <= 1e-12) note?.('Covariate determinant <= 1e-12: inherited coefficient');
  const d = det > 1e-12 ? (zy*xx-xy*xz)/det : fallbackD;
  const b = xx >= 1e-12 ? (xy-d*xz)/xx : 1;
  return { a: y-b*x-d*z, b, d, denominator: xx };
}
function fit(protocols: SnapshotProtocol[], form: Base, asOf: string, note?: FitNote) {
  protocols = trainingFor(protocols,form);
  if (!protocols.length) throw new SnapshotError(`No training observations for ${form}`);
  const defaultAge = defaultAgeFor(protocols,asOf), age = form === 'power-cat-k12-age';
  const change = form === 'power-cat-k12-chg', covariate = age || change;
  const minN = form === 'power-cat-k12-minn3' ? 3 : form === 'power-cat-k12-minn8' ? 8 : 5;
  const regression = (ps: SnapshotProtocol[], fallbackD = 0, scope = 'Global') => {
    const scopedNote: FitNote = message => note?.(`${scope}: ${message}`);
    return covariate ? ageFit(ps,asOf,defaultAge,fallbackD,change,scopedNote) : {
    ...(form === 'power-cat-k12-trim' ? trimmed(ps,scopedNote) :
      form === 'power-cat-k12-huber' || form === 'power-cat-k12-l1' ? robust(ps,form === 'power-cat-k12-huber',scopedNote) :
      form === 'power-cat-k12-wtvl' ? weightedOls(ps,ps.map(p => Math.sqrt(p.tvl_usd))) : ols(ps)), d: 0 };
  };
  const g = regression(protocols), gm = median(protocols.map(p => p.mcap_usd!/p.tvl_usd));
  if (g.denominator < 1e-12) note?.('Global denominator < 1e-12: slope 1');
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of protocols) if (p.category !== null) groups.set(p.category, [...(groups.get(p.category) ?? []),p]);
  const categories: CategoryFit[] = [], local = new Set<string>();
  for (const category of [...groups.keys()].sort(compare)) {
    const ps = groups.get(category)!, n = ps.length;
    let a = g.a, b = g.b, d = g.d, multiple = gm;
    if (form === 'median') {
      if (n >= 5) { multiple = (n*median(ps.map(p => p.mcap_usd!/p.tvl_usd))+6*gm)/(n+6); local.add(category); }
    } else {
      if (form !== 'power-global' && n >= minN) {
        const c = form === 'power-cat-k12-fixb' ? {
          a: ps.reduce((sum,p) => sum+(Math.log10(p.mcap_usd!)-g.b*Math.log10(p.tvl_usd)),0)/n,
          b: g.b, d: 0, denominator: Infinity,
        } : regression(ps,g.d,`Category ${category}`), k = Number(form.match(/k(\d+)/)![1]);
        if (c.denominator >= 1e-12) {
          a = (n*c.a+k*g.a)/(n+k); b = form === 'power-cat-k12-fixb' ? g.b : (n*c.b+k*g.b)/(n+k); d = (n*c.d+k*g.d)/(n+k); local.add(category);
        } else note?.(`Category ${category}: degenerate TVL, global fallback`);
      }
      multiple = 10**a * REF**(b-1);
    }
    categories.push({ category,n,multiple,a: form === 'median' ? null : a,b: form === 'median' ? null : b, ...(covariate ? {d} : {}) });
  }
  const global = form === 'median' ? gm : 10**g.a * REF**(g.b-1);
  const lookup = new Map(categories.map(c => [c.category,c]));
  return { global, a: form === 'median' ? null : g.a, b: form === 'median' ? null : g.b, categories,
    evidence: (p: SnapshotProtocol): ValuationFit => {
      const c = p.category === null ? undefined : lookup.get(p.category);
      return { category_n: p.category === null ? protocols.filter(q => q.category === null).length : c?.n ?? 0,
        global: p.category === null || !local.has(p.category), a: form === 'median' ? null : c?.a ?? g.a,
        b: form === 'median' ? null : c?.b ?? g.b, ...(covariate ? {d: c?.d ?? g.d} : {}) };
    },
    predict: (p: SnapshotProtocol) => {
      const c = p.category === null ? undefined : lookup.get(p.category);
      const value = form === 'median' ? p.tvl_usd*(c?.multiple ?? gm) : 10**(c?.a ?? g.a)*p.tvl_usd**(c?.b ?? g.b);
      if (form === 'power-cat-k12-blend50' && p.category !== null && local.has(p.category))
        return Math.sqrt(value*(10**g.a*p.tvl_usd**g.b));
      if (change) return value * 10**((c?.d ?? g.d)*changeZ(p));
      return age ? value * 10**((c?.d ?? g.d)*Math.log10(1+(ageDays(asOf,p.listed_at) ?? defaultAge)/365)) : value;
    } };
}
function defaultAgeFor(ps: SnapshotProtocol[], asOf: string): number {
  const ages = ps.map(p => ageDays(asOf,p.listed_at)).filter((a): a is number => a !== null);
  return ages.length ? median(ages) : 0;
}
function overlay(p: SnapshotProtocol, asOf: string, defaultAge: number, weight: number, enabled: boolean) {
  const growth = Math.max(-50,Math.min(50,p.change_7d ?? 0));
  return { growth, growthMult: 1+growth/100*weight,
    maturity: enabled ? 0.7+0.3*Math.min(ageDays(asOf,p.listed_at) ?? defaultAge,1460)/1460 : 1 };
}
const grid: { id: string; base: Base; overlay: Overlay }[] = [];
for (const base of ['median','power-global','power-cat-k4','power-cat-k12'] as Base[])
  for (const overlay of ['none','g25m','g50m'] as Overlay[]) grid.push({id: base+'+'+overlay,base,overlay});
for (const base of ['power-cat-k8','power-cat-k20','power-cat-k12-trim','power-cat-k12-age'] as Base[])
  grid.push({id: base+'+none',base,overlay: 'none'});
for (const overlay of ['chains05','chains10','vol15','vol30'] as Overlay[])
  grid.push({id: 'power-cat-k12+'+overlay,base: 'power-cat-k12',overlay});
function adjustment(p: SnapshotProtocol, asOf: string, defaultAge: number, name: Overlay) {
  const o = overlay(p,asOf,defaultAge,name === 'g50m' ? 0.5 : name === 'g25m' ? 0.25 : 0,name === 'g25m' || name === 'g50m');
  if (name === 'chains05' || name === 'chains10') o.growthMult = 1+(name === 'chains05' ? 0.05 : 0.10)*Math.log2(Math.max(1,p.chains.length));
  if (name === 'vol15' || name === 'vol30') o.growthMult = 1-(name === 'vol15' ? 0.15 : 0.30)*Math.abs(o.growth)/50;
  return o;
}
interface PlainDefinition { id: string; base: Base; overlay: Overlay }
interface EnsembleDefinition { id: string; components: string[] }
type Definition = PlainDefinition | EnsembleDefinition;
const exploration: Definition[] = [...grid];
for (const base of [
  'power-cat-k2','power-cat-k6','power-cat-k16','power-cat-k24','power-cat-k32',
  'power-cat-k12-fixb','power-cat-k12-huber','power-cat-k12-l1','power-cat-k12-wtvl',
  'power-cat-k12-min5m','power-cat-k12-min25m','power-cat-k12-screen',
  'power-cat-k12-minn3','power-cat-k12-minn8','power-cat-k12-blend50','power-cat-k12-chg',
] as ExplorationBase[]) exploration.push({id: base+'+none',base,overlay: 'none'});
exploration.push(
  {id: 'ens-med3+none', components: ['power-cat-k8+none','power-cat-k12+none','power-cat-k12+vol30']},
  {id: 'ens-med5+none', components: ['power-cat-k4+none','power-cat-k8+none','power-cat-k12+none','power-cat-k20+none','power-cat-k12-trim+none']},
  {id: 'ens-top3+none', components: ['power-cat-k12+vol30','power-cat-k12+vol15','power-cat-k12+none']},
);
interface FoldDiagnostic { folds: number; fold: number; base: Base; training_n: number; survivors: number; notes: string[] }
function crossFit(calibration: SnapshotProtocol[], asOf: string, folds: number, candidates: Definition[] = grid, diagnostics?: FoldDiagnostic[]): Candidate[] {
  const errors = new Map(candidates.map(c => [c.id, [] as number[]]));
  for (let i=0;i<folds;i++) {
    const train = calibration.filter((_,j) => j%folds !== i), validation = calibration.filter((_,j) => j%folds === i);
    const defaultAge = defaultAgeFor(train,asOf), predictions = new Map<string, number[]>();
    const fits = new Map<Base, ReturnType<typeof fit>>();
    for (const candidate of candidates) {
      if ('components' in candidate) continue;
      let fitted = fits.get(candidate.base);
      if (!fitted) {
        const notes: string[] = [];
        fitted = fit(train,candidate.base,asOf,note => notes.push(note));
        fits.set(candidate.base,fitted);
        diagnostics?.push({folds,fold: i,base: candidate.base,training_n: train.length,survivors: trainingFor(train,candidate.base).length,notes});
      }
      predictions.set(candidate.id,validation.map(p => {
        const o = adjustment(p,asOf,defaultAge,candidate.overlay);
        return fitted.predict(p)*o.growthMult*o.maturity;
      }));
    }
    for (const candidate of candidates) {
      const values = 'components' in candidate ? validation.map((_,j) => median(candidate.components.map(id => {
        const component = predictions.get(id);
        if (!component) throw new SnapshotError(`Missing ensemble component ${id}`);
        return component[j]!;
      }))) : predictions.get(candidate.id)!;
      values.forEach((value,j) => errors.get(candidate.id)!.push(Math.abs(Math.log10(value/validation[j]!.mcap_usd!))));
    }
  }
  return candidates.map(candidate => {
    const es = errors.get(candidate.id)!;
    return {id: candidate.id, median_abs_log10_error: median(es), within_2x_share: es.filter(e => e <= Math.log10(2)).length/es.length};
  }).sort((a,b) => a.median_abs_log10_error-b.median_abs_log10_error || compare(a.id,b.id));
}
/** Exploration cannot enter production selection. Diagnostics are optional and local to this call. */
export function evaluateExploration(snapshot: Snapshot, diagnostics?: FoldDiagnostic[]) {
  const calibration = calibrationFor(snapshot);
  return { twoWay: crossFit(calibration,snapshot.as_of,2,exploration,diagnostics).map(reported),
    fiveFold: crossFit(calibration,snapshot.as_of,5,exploration,diagnostics).map(reported) };
}

function best(candidates: Candidate[]): Candidate {
  const min = Math.min(...candidates.map(c => c.median_abs_log10_error));
  return candidates.filter(c => c.median_abs_log10_error <= min+0.005).sort((a,b) => b.within_2x_share-a.within_2x_share || a.median_abs_log10_error-b.median_abs_log10_error || compare(a.id,b.id))[0]!;
}
const reported = (c: Candidate): Candidate => ({...c,median_abs_log10_error: round4(c.median_abs_log10_error),within_2x_share: round4(c.within_2x_share)});
function calibrationFor(snapshot: Snapshot) {
  return snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).sort((a,b) => compare(a.slug,b.slug));
}
/** Supplementary checks never feed the adoption decision. Full tables aid auditability. */
export function evaluateCandidates(snapshot: Snapshot) {
  const calibration = calibrationFor(snapshot), twoWay = crossFit(calibration,snapshot.as_of,2);
  const fiveFold = crossFit(calibration,snapshot.as_of,5), remaining = [...twoWay], topThree: Candidate[] = [];
  for (let i=0;i<3;i++) { const pick = best(remaining); topThree.push(reported(fiveFold.find(c => c.id === pick.id)!)); remaining.splice(remaining.indexOf(pick),1); }
  return { topThree, twoWay: twoWay.map(reported), fiveFold: fiveFold.map(reported) };
}
function select(calibration: SnapshotProtocol[], asOf: string) {
  const candidates = crossFit(calibration,asOf,2), winner = best(candidates);
  const incumbent = candidates.find(c => c.id === 'power-cat-k12+none')!;
  const selected = winner.id !== incumbent.id && (winner.median_abs_log10_error <= 0.5245-0.010 ||
    (winner.within_2x_share >= 0.305+0.02 && winner.median_abs_log10_error <= 0.5245+0.002)) ? winner : incumbent;
  const definition = grid.find(c => c.id === selected.id)!;
  return {winner,selected,base: definition.base,overlay: definition.overlay,
    weight: definition.overlay === 'g50m' ? 0.5 : definition.overlay === 'g25m' ? 0.25 : 0,
    enabled: definition.overlay === 'g50m' || definition.overlay === 'g25m', candidates: candidates.map(reported)};
}
/** Category actions describe a small position; the snapshot alone cannot establish reward eligibility. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const target = `${p.name} on ${chain}`;
  if (/lend|cdp|collateral/.test(c)) return `Supply $${capital} of eligible collateral through ${target}; check borrowing terms before borrowing`;
  if (/curator|vault|allocator/.test(c)) return `Deposit $${capital} into an eligible vault at ${target} and retain its shares`;
  if (/dex|yield|farm/.test(c)) return `Add $${capital} to a supported liquidity or yield position at ${target}`;
  if (/bridge/.test(c)) return `Transfer $${capital} through ${target} after checking destination liquidity`;
  if (/stak|restak/.test(c)) return `Stake $${capital} of a supported asset through ${target} and retain the receipt`;
  if (/perpetual|derivative/.test(c)) return `Fund a $${capital} margin account at ${target} and test a small hedged position`;
  if (/prediction/.test(c)) return `Fund ${target} with $${capital} and take a small position in a market you understand`;
  if (/stable/.test(c)) return `Deposit or mint $${capital} of a supported stable asset through ${target}`;
  if (/rwa|real world/.test(c)) return `Check access requirements and acquire $${capital} of an eligible asset at ${target}`;
  if (/insurance/.test(c)) return `Compare exclusions and purchase a small cover policy using a $${capital} budget at ${target}`;
  return `Use $${capital} in a supported deposit position at ${target} after reading its withdrawal terms`;
}
function farmSteps(row: BoardRow, defaultAge: number, categoryReference: boolean): string[] {
  const chain = row.chains[0] ?? 'its primary chain';
  const capital = row.tvl_usd >= 5e9 ? 250 : row.tvl_usd >= 1e9 ? 150 : row.tvl_usd >= 1e8 ? 100 : 50;
  const age = row.age_days ?? defaultAge;
  const hold = age < 180 ? 60 : age < 365 ? 45 : 30;
  const weeks = Math.ceil(hold / 7);
  const gas = capital >= 150 ? 8 : 4;
  const costs = 3 + gas + 2 * weeks;
  const step = (action: string, cost: string, time: string) => `${action}. Cost: ${cost}. Time: ${time}.`;
  return [
    step(`Prepare a dedicated wallet for ${row.name} and fund gas on ${chain}`, 'about $3 gas plus the position budget', '5 minutes'),
    step(actionFor(row, capital, chain), `$${capital} committed capital and about $${gas} gas`, '15 minutes'),
    step(`Review ${row.name}'s activity requirements and perform one supported action on ${chain} each week`, 'budget $2 gas weekly', `10 minutes weekly for ${weeks} weeks`),
    step(`Maintain the ${row.name} position and monitor withdrawal liquidity`, `$${capital} at risk, with variable opportunity cost`, `${hold} days`),
    step(`Check ${row.name}'s official rewards terms, log transactions and plan an orderly withdrawal`, 'no fee to read terms; withdrawal gas varies', '10 minutes'),
    step(`Net verdict: ${row.verdict.toUpperCase()} — implied $${row.implied_value_usd}; ${row.verdict_basis.ratio.toFixed(2)}x TVL; category median ${row.verdict_basis.category_median_ratio.toFixed(2)}x; percentile ${row.verdict_basis.ratio_percentile.toFixed(2)} among ${row.verdict_basis.reference_n} ${categoryReference ? (row.category ?? 'Uncategorized') : 'whole-board'} board peers${categoryReference ? '' : ' (category under 5)'}; farm: >= $25M and percentile >= 0.75; thin: >= $25M or >= $8M and percentile >= 0.40; else skip; rewards unconfirmed`, `roughly $${costs}, excluding capital losses`, `${weeks} weeks`),
  ];
}
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols.filter(p => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || compare(a.slug, b.slug)).slice(0, LIVE_ROWS)
    .map(p => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}
export function radarRow(r: BoardRow): RadarRow {
  return { rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
    tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, age_days: r.age_days,
    implied_value_usd: r.implied_value_usd, base_multiple: r.model.base_multiple,
    growth_multiplier: r.model.growth_multiplier, maturity_multiplier: r.model.maturity_multiplier,
    ratio_percentile: r.verdict_basis.ratio_percentile, category_median_ratio: r.verdict_basis.category_median_ratio, reference_n: r.verdict_basis.reference_n,
    watchlist: r.watchlist, verdict: r.verdict, farm_steps: r.farm_steps, ...rowEvidence.get(r)! };
}
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calibration = snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).sort((a,b) => compare(a.slug,b.slug));
  const selection = select(calibration,snapshot.as_of);
  const fitted = fit(calibration,selection.base,snapshot.as_of);
  const modelVersion = selection.selected.id === 'median+g50m' ? 'comps-cal-1' : MODEL_VERSION;
  const tokenless = snapshot.protocols.filter(isPreToken);
  const defaultAge = defaultAgeFor(calibration,snapshot.as_of);
  const watch = new Set(snapshot.watchlist);
  const screened: Screened = { tokenless_total: tokenless.length, excluded_total: 0,
    by_reason: { category: 0, versioned: 0, wrapped_or_staked_name: 0, exchange_prefix: 0 }, board_size: 0 };
  const chosen = snapshot.protocols.filter(p => {
    if (watch.has(p.slug)) return true;
    if (!isPreToken(p)) return false;
    const reason = exclusion(p);
    if (reason) { screened.excluded_total++; screened.by_reason[reason]++; return false; }
    return true;
  });
  const board: BoardRow[] = chosen.map(p => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const base = fitted.predict(p)/p.tvl_usd;
    const {growth, growthMult, maturity} = adjustment(p,snapshot.as_of,defaultAge,selection.overlay);
    const implied = Math.max(1, Math.round(p.tvl_usd * base * growthMult * maturity));
    const verdict: Verdict = 'skip';
    return { ...p, rank: 0, token_status: 'pre-token', age_days: age, implied_value_usd: implied,
      watchlist: watch.has(p.slug), verdict, verdict_basis: { ratio: 0, category_median_ratio: 0, ratio_percentile: 0, reference_n: 0 }, model: { base_multiple: round4(base), growth_pct: growth,
        growth_multiplier: round4(growthMult), maturity_multiplier: round4(maturity), age_days: age }, farm_steps: [] };
  });
  for (const r of board) {
    const categoryPool = calibration.filter(p => p.category === r.category);
    const pool = categoryPool.length >= 5 ? categoryPool : calibration;
    const nearest = [...pool].sort((a,b) => Math.abs(Math.log10(a.tvl_usd)-Math.log10(r.tvl_usd))-Math.abs(Math.log10(b.tvl_usd)-Math.log10(r.tvl_usd)) || compare(a.slug,b.slug)).slice(0,3);
    rowEvidence.set(r, { valuation_fit: fitted.evidence(r), nearest_comps: nearest.map(p => ({name: p.name,tvl_usd: p.tvl_usd,mcap_usd: p.mcap_usd!,mcap_tvl_ratio: p.mcap_usd!/p.tvl_usd})) });
  }
  board.sort((a, b) => b.implied_value_usd - a.implied_value_usd || compare(a.slug, b.slug));
  for (const r of board) {
    const categoryPeers = board.filter(p => p.category === r.category);
    const peers = categoryPeers.length >= 5 ? categoryPeers : board;
    const ratio = r.implied_value_usd/r.tvl_usd, ratios = peers.map(p => p.implied_value_usd/p.tvl_usd);
    const percentile = (ratios.filter(v => v < ratio).length+0.5*ratios.filter(v => v === ratio).length)/peers.length;
    r.verdict_basis = { ratio: round4(ratio), category_median_ratio: round4(median(ratios)), ratio_percentile: round4(percentile), reference_n: peers.length };
    r.verdict = r.implied_value_usd >= 25e6 && percentile >= 0.75 ? 'farm' : r.implied_value_usd >= 25e6 || (r.implied_value_usd >= 8e6 && percentile >= 0.40) ? 'thin' : 'skip';
  }
  board.forEach((r, i) => { r.rank = i + 1; r.farm_steps = farmSteps(r, defaultAge, board.filter(p => p.category === r.category).length >= 5); });
  screened.board_size = board.length;
  const live = liveRows(snapshot);
  const early = board.filter(r => !r.watchlist).length;
  return { board, radar: {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model: { ...MODEL, growth_weight: selection.weight }, model_version: modelVersion, watchlist_size: watch.size, board_size: board.length,
    early_size: early, live_size: live.length, rows: board.map(r => ({ ...radarRow(r), base_multiple: fitted.predict(r)/r.tvl_usd })), live,
    methodology: { model_version: modelVersion, calibration_n: calibration.length,
      calibration_excluded_nonpositive: snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd <= 0).length,
      form: selection.selected.id, winner_id: selection.winner.id, selected_id: selection.selected.id,
      form_label: 'Category power-law fits shrunk toward the global fit.',
      formula_text: `implied = ${selection.base === 'median' ? `TVL x category median multiple (shrinkage k=6 toward global ${round4(fitted.global)})` : `10^(${round4(fitted.a!)}) x TVL^${round4(fitted.b!)} (${selection.base === 'power-global' ? 'global parameters' : `category params shrunk k=${selection.base === 'power-cat-k4' ? 4 : 12} toward global`})`}${selection.enabled ? ` x (1 + clip(change_7d, -50, +50)/100 x ${selection.weight}) x (0.7 + 0.3 x min(ageDays, 1460)/1460)` : ' x 1 x 1'}`,
      global_a: fitted.a === null ? null : round4(fitted.a), global_b: fitted.b === null ? null : round4(fitted.b),
      ref_tvl_usd: REF, global_multiple: round4(fitted.global), categories: fitted.categories
        .sort((a,b) => b.n-a.n || compare(a.category,b.category)).map(c => ({...c,multiple: round4(c.multiple),a: c.a === null ? null : round4(c.a),b: c.b === null ? null : round4(c.b)})),
      candidates: selection.candidates,
      selection_note: `Two-way cross-fit compared ${selection.candidates.length} candidates. Pooled OOS numbers are mildly optimistic for the grid winner, ${selection.winner.id}. The production model, ${selection.selected.id}, was refit on all ${calibration.length} comps after applying the adoption rule.`,
      scatter: { points: calibration.map(p => [Math.log10(p.tvl_usd),Math.log10(p.mcap_usd!)].map(v => Math.round(v*1000)/1000)),
        line: (() => { const xs = calibration.map(p => Math.log10(p.tvl_usd)), x1 = Math.min(...xs), x2 = Math.max(...xs);
          const y = (x: number) => fitted.a === null ? x+Math.log10(fitted.global) : fitted.a+fitted.b!*x;
          return { x1: round4(x1),y1: round4(y(x1)),x2: round4(x2),y2: round4(y(x2)) }; })() },
      global_fallback: 'Null categories and categories with fewer than 5 calibration members use the global fit.',
      calibration_policy: 'Calibration requires recorded market cap > 0 and TVL > 0; nonpositive recorded market caps are excluded.',
      oos: { folds: 2, n_fit: Math.floor(calibration.length/2), n_validation: calibration.length, median_abs_log10_error: round4(selection.selected.median_abs_log10_error),within_2x_share: round4(selection.selected.within_2x_share) },
      growth_clip_pct: 50, growth_weight: selection.weight,
      maturity_floor: MODEL.maturity_floor, maturity_days: 1460, default_age_days: defaultAge,
      screened, watchlist_size: watch.size, early_size: early },
  } };
}
export function buildBoard(snapshot: Snapshot): BoardRow[] { return buildRadar(snapshot).board; }
/** Validate the envelope and required identity fields; normalize optional snapshot fields. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('Invalid snapshot JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SnapshotError('Expected a snapshot object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of) || !Number.isFinite(Date.parse(o.as_of))) throw new SnapshotError('Invalid snapshot date');
  if (typeof o.source !== 'string' || !Number.isSafeInteger(o.floor_usd) || (o.floor_usd as number) <= 0) throw new SnapshotError('Invalid source or TVL floor');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist) || o.watchlist.some(s => typeof s !== 'string')) throw new SnapshotError('Expected protocols and watchlist arrays');
  const optionalNumber = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const optionalString = (v: unknown): string | null => typeof v === 'string' ? v : null;
  const seen = new Set<string>();
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SnapshotError(`Protocol ${i} must be an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`Protocol ${i} lacks identity or TVL`);
    if (seen.has(p.slug)) throw new SnapshotError(`Duplicate slug: ${p.slug}`);
    seen.add(p.slug);
    return { slug: p.slug, name: p.name, category: optionalString(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: optionalNumber(p.change_7d), mcap_usd: optionalNumber(p.mcap_usd),
      listed_at: optionalString(p.listed_at), gecko_id: optionalString(p.gecko_id), symbol: optionalString(p.symbol) };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd as number, protocols, watchlist: o.watchlist as string[] };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map(r => r.slug));
  if (slugs.size !== board.length) return 'Duplicate board slugs';
  if (snapshot.watchlist.some(s => !slugs.has(s))) return 'Missing watchlist coverage';
  if (board.length > 1 && board.every(r => r.implied_value_usd === board[0]!.implied_value_usd)) return 'All implied values are equal';
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `Invalid rank at ${r.slug}`;
    const prev = board[i - 1];
    if (prev && (prev.implied_value_usd < r.implied_value_usd || (prev.implied_value_usd === r.implied_value_usd && compare(prev.slug, r.slug) > 0))) return `Invalid ordering at ${r.slug}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `Invalid implied value at ${r.slug}`;
    if (r.farm_steps.length !== 6 || r.farm_steps.some(s => s.trim().length < 20 || s.trim().length > 600 || !s.includes('Cost:') || !s.includes('Time:'))) return `Invalid farm plan at ${r.slug}`;
  }
  return null;
}
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n`;
}
