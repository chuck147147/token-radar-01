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
/** Category playbooks are conditional on the official UI; snapshot categories do not prove features or rewards. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string) {
  const c = (p.category ?? '').toLowerCase();
  const play = (entry: string, first: string, second: string, maintain: string, exit: string) => ({
    entry: `At ${p.name} on ${chain}, ${entry}; cap committed capital at $${capital}`,
    first, second, maintain, exit,
  });
  if (/uncollateralized/.test(c)) return play('supply to an eligible credit pool after checking borrower and default terms', 'review borrower repayments', 'review pool utilization', 'check arrears and redemption gates', 'request redemption within the pool notice window');
  if (/cdp/.test(c)) return play('deposit eligible collateral; inspect liquidation ratio before any optional mint', 'review collateral headroom', 'review debt and stability fees', 'keep debt below the liquidation threshold; avoid leverage', 'repay any minted debt before withdrawing collateral');
  if (/lend|collateral/.test(c)) return play('supply an eligible asset after checking caps and withdrawal liquidity; leave borrowing disabled', 'withdraw a small slice', 'resupply that slice', 'check utilization, supply rates and collateral settings', 'withdraw supply; repay any debt first');
  if (/option/.test(c)) return play('inspect expiry and maximum loss; use only a defined-risk option or vault allocation', 'review expiry and exercise terms', 'review premium and settlement quotes', 'track expiry and any vault lockup', 'settle or close before expiry, then redeem available funds');
  if (/curator|vault|allocator/.test(c)) return play('deposit into a supported vault after inspecting allocations, fees and redemption queues', 'redeem a small share tranche', 'redeposit the redeemed assets', 'track share value, allocation changes and queue length', 'request share redemption and complete any queued claim');
  if (/liquidity manager|dex/.test(c)) return play('select a liquid pair, inspect price impact and fee tier, then add a small liquidity position', 'remove a small liquidity slice', 're-add the withdrawn pair', 'check range coverage, pool depth and impermanent loss', 'remove liquidity and collect accrued fees');
  if (/leveraged farm/.test(c)) return play('choose an unlevered farm position if available; inspect debt and liquidation terms', 'review debt exposure', 'review underlying pool liquidity', 'keep leverage disabled and inspect withdrawal penalties', 'unwind the farm and settle any debt before withdrawal');
  if (/yield|farm/.test(c)) return play('deposit into a supported yield pool after separating base yield from incentives', 'withdraw a small tranche', 'redeposit the withdrawn tranche', 'check reward expiry, deposit fees and withdrawal locks', 'unstake or redeem the position and collect earned balances');
  if (/bridge/.test(c)) return play('quote a supported route and verify destination liquidity and recipient before transfer', 'review route fees', 'verify destination receipt and finality', 'track pending transfers and destination liquidity', 'quote a return route separately; destination gas is additional');
  if (/stak|restak/.test(c)) return play('stake a supported asset after checking slashing and unbonding rules; retain the receipt', 'review receipt exchange rate', 'review validator or operator status', 'monitor slashing exposure and unbonding queues', 'request unstaking and claim after the cooldown');
  if (/perpetual|derivative|basis trading|synthetic/.test(c)) return play('fund supported collateral; size any test trade within the budget and avoid leverage', 'review funding and basis', 'review close quotes and margin headroom', 'check funding costs, liquidation distance and open orders', 'cancel orders, close exposure and withdraw margin');
  if (/prediction/.test(c)) return play('inspect resolution rules and buy a small position in a market you understand', 'review resolution evidence', 'review an exit quote', 'check market depth and dispute deadlines', 'sell if liquid or redeem after final resolution');
  if (/nft|marketplace/.test(c)) return play('verify collection or asset identity, royalties and executable bids before a small purchase', 'review comparable executable bids', 'review listing and royalty terms', 'track liquidity; avoid self-trades and inflated floor prices', 'cancel stale listings; sell only against an acceptable bid');
  if (/gaming|game/.test(c)) return play('use a supported game asset or entry only after checking ownership and refund rules', 'complete a supported gameplay session', 'use a different supported game mode', 'track asset utility and withdrawal restrictions', 'redeem refundable balances and cancel market listings');
  if (/oracle/.test(c)) return play('inspect a supported data service; allocate only to documented usage or staking', 'inspect feed freshness', 'compare feed deviation against its reference', 'check heartbeat, service charges and any slash conditions', 'cancel service renewals or follow documented unstaking');
  if (/privacy/.test(c)) return play('test a supported private deposit after checking withdrawal denominations; back up recovery material offline', 'verify deposit status', 'review withdrawal proof requirements', 'retain recovery material and verify withdrawal availability', 'withdraw using the saved recovery material; never share secrets');
  if (/wallet|infra|chain/.test(c)) return play('verify network settings and use a documented wallet or network feature with a small funded balance', 'send a small transfer between your own addresses', 'test the return transfer', 'check receipts, network status and token approvals', 'return unused balances and revoke unused approvals');
  if (/social/.test(c)) return play('set up a profile and use a documented paid feature only if useful', 'publish an original post', 'reply meaningfully to another post', 'review permissions and recurring charges', 'cancel renewals and withdraw any refundable balance');
  if (/\bai\b|artificial intelligence/.test(c)) return play('test a documented agent or inference service; cap prepaid usage and restrict wallet permissions', 'run a small supported inference task', 'evaluate its output on a second task', 'check usage charges and agent spending permissions', 'disable agent permissions and withdraw refundable credits');
  if (/stable/.test(c)) return play('inspect backing and redemption fees before acquiring or minting a supported stable asset', 'review the redemption quote', 'review backing and peg data', 'track peg deviation and redemption queues', 'redeem through the documented route; settle any mint debt');
  if (/rwa|real world/.test(c)) return play('check access requirements, issuer exposure and settlement terms before acquiring an eligible asset', 'review issuer disclosures', 'review redemption availability', 'track settlement windows and issuer restrictions', 'submit redemption before the dealing cutoff');
  if (/insurance/.test(c)) return play('compare exclusions, coverage dates and claim evidence before buying cover within budget', 'review covered exposure', 'review claims and exclusions', 'check coverage expiry and evidence requirements', 'cancel renewal; claim only for a qualifying loss');
  if (/payment|card/.test(c)) return play('inspect fees and refund terms before funding a supported payment balance', 'make a small useful payment', 'review settlement and refund status', 'track merchant fees and remaining balance', 'withdraw unused funds and cancel recurring payments');
  if (/index/.test(c)) return play('inspect constituents, rebalance rules and redemption fees before buying index shares', 'review constituent weights', 'review redemption quotes', 'track concentration and rebalance costs', 'redeem shares through the documented route');
  return play('verify a documented core feature and withdrawal terms before allocating funds; do not assume deposits exist', 'review the core feature receipt', 'review the documented exit quote', 'check permissions, lockups and exit liquidity', 'follow the documented exit and revoke unused approvals');
}
/** Planning estimates in USD per action, not live fee quotes. Keys match snapshot chain names. */
const FARM_GAS: Record<string, number> = {
  Ethereum: 8, Arbitrum: 0.50, Base: 0.30, Optimism: 0.50, Unichain: 0.30,
  Linea: 0.50, Scroll: 0.50, 'zkSync Era': 0.50, 'Polygon zkEVM': 0.50,
  Mantle: 0.30, Blast: 0.50, Mode: 0.50, Metis: 0.50, Soneium: 0.30,
  'X Layer': 0.30, Ink: 0.30, Fraxtal: 0.30, Boba: 0.50, Morph: 0.50,
  MegaETH: 0.30, Solana: 0.05, BSC: 0.20, Binance: 0.20, Polygon: 0.20, POLYGON: 0.20,
};
function farmSteps(row: BoardRow, defaultAge: number, categoryReference: boolean): string[] {
  const chain = row.chains[0] ?? 'its primary chain';
  const capital = row.tvl_usd >= 5e9 ? 250 : row.tvl_usd >= 1e9 ? 150 : row.tvl_usd >= 1e8 ? 100 : 50;
  const age = row.age_days ?? defaultAge;
  const hold = age < 180 ? 60 : age < 365 ? 45 : 30;
  const weeks = Math.ceil(hold / 7);
  const gas = Object.hasOwn(FARM_GAS, chain) ? FARM_GAS[chain]! : 2;
  const prepGas = gas, entryGas = 2*gas, weeklyGas = 2*gas, exitGas = 3*gas;
  const costs = prepGas+entryGas+weeklyGas*weeks+exitGas;
  const prepMinutes = 5, entryMinutes = 15, weeklyMinutes = 10, reviewMinutes = 10, exitMinutes = 15;
  const minutes = prepMinutes+entryMinutes+weeklyMinutes*weeks+reviewMinutes+exitMinutes;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const play = actionFor(row, capital, chain);
  const trend = row.change_7d === null ? "7d TVL change is unreported; verify on the protocol's own page" :
    row.change_7d < 0 ? `7d TVL ${row.change_7d}%; re-check whether TVL keeps falling before adding` :
    row.change_7d > 0 ? `7d TVL +${row.change_7d}%; momentum supports holding if liquidity remains sound` :
    '7d TVL is flat; verify liquidity before adding';
  const step = (action: string, cost: string, time: string) => `${action}. Cost: ${cost}. Time: ${time}.`;
  return [
    step(`Prepare a dedicated wallet for ${row.name}; verify its official app and ${chain} network. Fund ${usd(costs)} in native gas for the whole plan at an estimated ${usd(gas)}/action; this reserve includes later steps`, `${usd(prepGas)} gas for 1 funding action; reserve is not an extra fee`, `${prepMinutes} minutes`),
    step(`${play.entry}. Confirm these category features in the official UI before signing; limit approvals to the amount used`, `$${capital} committed capital + ${usd(entryGas)} gas allowance for 2 entry/approval actions; product fees extra`, `${entryMinutes} minutes`),
    step(`For ${row.name}, alternate weekly: odd weeks ${play.first}; even weeks ${play.second}. Use only UI-supported actions, recycle existing capital and skip unavailable features; read-only checks need no gas`, `up to ${usd(weeklyGas)} gas/week for 2 actions (${usd(weeklyGas*weeks)} across ${weeks} weeks); no new capital`, `${weeklyMinutes} minutes/week for ${weeks} weeks within ${hold} days`),
    step(`Maintain ${row.name}: ${play.maintain}. At day ${Math.floor(hold/2)} of the ${hold}-day hold, ${trend}`, `$${capital} remains at risk; $0 gas for review; opportunity cost varies`, `${reviewMinutes} minutes hands-on; ${hold} days elapsed hold`),
    step(`Rewards unconfirmed: check ${row.name}'s official eligibility, chain and cutoff terms; never assume an airdrop. Save tx hashes, dates, amounts and fees. At exit, ${play.exit}; record final proceeds`, `${usd(exitGas)} gas allowance for 3 exit/claim/revoke actions; reading terms is free; product fees extra`, `${exitMinutes} minutes hands-on; queues may extend settlement`),
    step(`Net verdict: ${row.verdict.toUpperCase()} — implied $${row.implied_value_usd}; ${row.verdict_basis.ratio.toFixed(2)}x TVL; category median ${row.verdict_basis.category_median_ratio.toFixed(2)}x; percentile ${row.verdict_basis.ratio_percentile.toFixed(2)} among ${row.verdict_basis.reference_n} ${categoryReference ? (row.category ?? 'Uncategorized') : 'whole-board'} board peers${categoryReference ? '' : ' (category under 5)'}; farm: >= $25M and percentile >= 0.75; thin: >= $25M or >= $8M and percentile >= 0.40; else skip; rewards unconfirmed`, `plan totals: ${usd(costs)} estimated gas; $${capital} capital at risk; product fees/losses extra`, `${minutes} minutes total hands-on; ${hold}-day hold`),
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
