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
  { base_multiple: number; growth_multiplier: number; maturity_multiplier: number; ratio_percentile: number; category_median_ratio: number; reference_n: number };
export type LiveRow = Pick<SnapshotProtocol, 'slug' | 'name' | 'category' | 'chains' | 'tvl_usd' | 'mcap_usd' | 'change_7d'>;
interface CategoryFit { category: string; n: number; multiple: number; a: number | null; b: number | null }
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
    ref_tvl_usd: number; candidates: Candidate[]; selected_id: string; selection_note: string;
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
type Base = 'median' | 'power-global' | 'power-cat-k4' | 'power-cat-k12';
const REF = 1e8;
function ols(ps: SnapshotProtocol[]) {
  const xs = ps.map(p => Math.log10(p.tvl_usd)), ys = ps.map(p => Math.log10(p.mcap_usd!));
  const x = xs.reduce((a,b) => a+b,0)/ps.length, y = ys.reduce((a,b) => a+b,0)/ps.length;
  const denominator = xs.reduce((sum,v) => sum+(v-x)**2,0);
  const b = denominator < 1e-12 ? 1 : xs.reduce((sum,v,i) => sum+(v-x)*(ys[i]!-y),0)/denominator;
  return { a: y-b*x, b, denominator };
}
function fit(protocols: SnapshotProtocol[], form: Base) {
  const g = ols(protocols), gm = median(protocols.map(p => p.mcap_usd!/p.tvl_usd));
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of protocols) if (p.category !== null) groups.set(p.category, [...(groups.get(p.category) ?? []),p]);
  const categories: CategoryFit[] = [];
  for (const category of [...groups.keys()].sort(compare)) {
    const ps = groups.get(category)!, n = ps.length;
    let a = g.a, b = g.b, multiple = gm;
    if (form === 'median') {
      if (n >= 5) multiple = (n*median(ps.map(p => p.mcap_usd!/p.tvl_usd))+6*gm)/(n+6);
    } else {
      if (form !== 'power-global' && n >= 5) {
        const c = ols(ps), k = form === 'power-cat-k4' ? 4 : 12;
        if (c.denominator >= 1e-12) { a = (n*c.a+k*g.a)/(n+k); b = (n*c.b+k*g.b)/(n+k); }
      }
      multiple = 10**a * REF**(b-1);
    }
    categories.push({ category,n,multiple,a: form === 'median' ? null : a,b: form === 'median' ? null : b });
  }
  const global = form === 'median' ? gm : 10**g.a * REF**(g.b-1);
  const lookup = new Map(categories.map(c => [c.category,c]));
  return { global, a: form === 'median' ? null : g.a, b: form === 'median' ? null : g.b, categories,
    predict: (p: SnapshotProtocol) => {
      const c = p.category === null ? undefined : lookup.get(p.category);
      return form === 'median' ? p.tvl_usd*(c?.multiple ?? gm) : 10**(c?.a ?? g.a)*p.tvl_usd**(c?.b ?? g.b);
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
function select(calibration: SnapshotProtocol[], asOf: string) {
  const halves = [calibration.filter((_,i) => i%2 === 0),calibration.filter((_,i) => i%2 === 1)];
  const candidates: Candidate[] = [];
  for (const base of ['median','power-global','power-cat-k4','power-cat-k12'] as Base[]) {
    for (const [name,weight] of [['none',0],['g25m',0.25],['g50m',0.5]] as const) {
      const errors: number[] = [];
      for (let i=0;i<2;i++) {
        const train = halves[i]!, fitted = fit(train,base), defaultAge = defaultAgeFor(train,asOf);
        for (const p of halves[1-i]!) {
          const o = overlay(p,asOf,defaultAge,weight,name !== 'none');
          errors.push(Math.abs(Math.log10(fitted.predict(p)*o.growthMult*o.maturity/p.mcap_usd!)));
        }
      }
      candidates.push({ id: base+'+'+name, median_abs_log10_error: median(errors), within_2x_share: errors.filter(e => e<=Math.log10(2)).length/errors.length });
    }
  }
  candidates.sort((a,b) => a.median_abs_log10_error-b.median_abs_log10_error || compare(a.id,b.id));
  const tied = candidates.filter(c => c.median_abs_log10_error <= candidates[0]!.median_abs_log10_error+0.005);
  tied.sort((a,b) => b.within_2x_share-a.within_2x_share || a.median_abs_log10_error-b.median_abs_log10_error || compare(a.id,b.id));
  const winner = tied[0]!, [base,name] = winner.id.split('+');
  return { winner, base: base as Base, weight: name === 'g50m' ? 0.5 : name === 'g25m' ? 0.25 : 0, enabled: name !== 'none',
    candidates: candidates.map(c => ({...c, median_abs_log10_error: round4(c.median_abs_log10_error),within_2x_share: round4(c.within_2x_share)})) };
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
    watchlist: r.watchlist, verdict: r.verdict, farm_steps: r.farm_steps };
}
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calibration = snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).sort((a,b) => compare(a.slug,b.slug));
  const selection = select(calibration,snapshot.as_of);
  const fitted = fit(calibration,selection.base);
  const modelVersion = selection.winner.id === 'median+g50m' ? 'comps-cal-1' : MODEL_VERSION;
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
    const {growth, growthMult, maturity} = overlay(p,snapshot.as_of,defaultAge,selection.weight,selection.enabled);
    const implied = Math.max(1, Math.round(p.tvl_usd * base * growthMult * maturity));
    const verdict: Verdict = 'skip';
    return { ...p, rank: 0, token_status: 'pre-token', age_days: age, implied_value_usd: implied,
      watchlist: watch.has(p.slug), verdict, verdict_basis: { ratio: 0, category_median_ratio: 0, ratio_percentile: 0, reference_n: 0 }, model: { base_multiple: round4(base), growth_pct: growth,
        growth_multiplier: round4(growthMult), maturity_multiplier: round4(maturity), age_days: age }, farm_steps: [] };
  });
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
    early_size: early, live_size: live.length, rows: board.map(radarRow), live,
    methodology: { model_version: modelVersion, calibration_n: calibration.length,
      calibration_excluded_nonpositive: snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd <= 0).length,
      form: selection.winner.id, selected_id: selection.winner.id,
      form_label: `${selection.base === 'median' ? 'Category median multiples shrunk toward the global median' : selection.base === 'power-global' ? 'A global power-law fit of market cap on TVL' : 'Category power-law fits shrunk toward the global fit'}${selection.enabled ? ', with growth and maturity adjustments.' : ', without growth or maturity adjustments.'}`,
      formula_text: `implied = ${selection.base === 'median' ? `TVL x category median multiple (shrinkage k=6 toward global ${round4(fitted.global)})` : `10^(${round4(fitted.a!)}) x TVL^${round4(fitted.b!)} (${selection.base === 'power-global' ? 'global parameters' : `category params shrunk k=${selection.base === 'power-cat-k4' ? 4 : 12} toward global`})`}${selection.enabled ? ` x (1 + clip(change_7d, -50, +50)/100 x ${selection.weight}) x (0.7 + 0.3 x min(ageDays, 1460)/1460)` : ' x 1 x 1'}`,
      global_a: fitted.a === null ? null : round4(fitted.a), global_b: fitted.b === null ? null : round4(fitted.b),
      ref_tvl_usd: REF, global_multiple: round4(fitted.global), categories: fitted.categories
        .sort((a,b) => b.n-a.n || compare(a.category,b.category)).map(c => ({...c,multiple: round4(c.multiple),a: c.a === null ? null : round4(c.a),b: c.b === null ? null : round4(c.b)})),
      candidates: selection.candidates,
      selection_note: 'The winner was selected by two-way cross-fit on this same calibration set. These pooled OOS numbers describe the selection procedure and are mildly optimistic for the winner; final parameters were refit on all 128 comps.',
      scatter: { points: calibration.map(p => [Math.log10(p.tvl_usd),Math.log10(p.mcap_usd!)].map(v => Math.round(v*1000)/1000)),
        line: (() => { const xs = calibration.map(p => Math.log10(p.tvl_usd)), x1 = Math.min(...xs), x2 = Math.max(...xs);
          const y = (x: number) => fitted.a === null ? x+Math.log10(fitted.global) : fitted.a+fitted.b!*x;
          return { x1: round4(x1),y1: round4(y(x1)),x2: round4(x2),y2: round4(y(x2)) }; })() },
      global_fallback: 'Null categories and categories with fewer than 5 calibration members use the global fit.',
      calibration_policy: 'Calibration requires recorded market cap > 0 and TVL > 0; nonpositive recorded market caps are excluded.',
      oos: { folds: 2, n_fit: Math.floor(calibration.length/2), n_validation: calibration.length, median_abs_log10_error: round4(selection.winner.median_abs_log10_error),within_2x_share: round4(selection.winner.within_2x_share) },
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
