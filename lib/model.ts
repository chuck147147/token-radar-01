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
export const MODEL_VERSION = 'comps-cal-1';
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
  farm_steps: string[];
}
export type RadarRow = Pick<BoardRow, 'rank' | 'slug' | 'name' | 'category' | 'chains' |
  'tvl_usd' | 'change_7d' | 'listed_at' | 'age_days' | 'implied_value_usd' | 'watchlist' | 'verdict' | 'farm_steps'> &
  { base_multiple: number; growth_multiplier: number; maturity_multiplier: number };
export type LiveRow = Pick<SnapshotProtocol, 'slug' | 'name' | 'category' | 'chains' | 'tvl_usd' | 'mcap_usd' | 'change_7d'>;
interface CategoryFit { category: string; n: number; multiple: number }
interface OOS { n_fit: number; n_validation: number; median_abs_log10_error: number; within_2x_share: number }
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
function fit(protocols: SnapshotProtocol[]) {
  const global = median(protocols.map(p => p.mcap_usd! / p.tvl_usd));
  const groups = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.category === null) continue;
    const values = groups.get(p.category) ?? [];
    values.push(p.mcap_usd! / p.tvl_usd); groups.set(p.category, values);
  }
  const categories: CategoryFit[] = [];
  for (const category of [...groups.keys()].sort(compare)) {
    const values = groups.get(category)!;
    if (values.length >= MODEL.category_min_n) categories.push({ category, n: values.length,
      multiple: (values.length * median(values) + MODEL.shrinkage_k * global) / (values.length + MODEL.shrinkage_k) });
  }
  const lookup = new Map(categories.map(c => [c.category, c.multiple]));
  return { global, categories, multiple: (category: string | null) => category === null ? global : lookup.get(category) ?? global };
}
function validate(calibration: SnapshotProtocol[]): OOS {
  const ordered = [...calibration].sort((a, b) => compare(a.slug, b.slug));
  const training = ordered.filter((_, i) => i % 2 === 0);
  const validation = ordered.filter((_, i) => i % 2 === 1);
  const fitted = fit(training);
  const errors = validation.map(p =>
    Math.abs(Math.log10(p.tvl_usd * fitted.multiple(p.category) / p.mcap_usd!)));
  return { n_fit: training.length, n_validation: validation.length,
    median_abs_log10_error: round4(median(errors)),
    within_2x_share: round4(errors.filter(e => e <= Math.log10(2)).length / errors.length) };
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
function farmSteps(row: BoardRow, defaultAge: number): string[] {
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
    step(`Net verdict: ${row.verdict.toUpperCase()} — implied $${row.implied_value_usd} on $${row.tvl_usd} TVL (${row.model.base_multiple.toFixed(2)}x category multiple); farm requires implied value >= $25,000,000 and implied/TVL >= 0.30; otherwise thin requires >= $8,000,000, else skip; ${row.verdict === 'farm' ? 'prioritize a small trial' : row.verdict === 'thin' ? 'limit activity to a low-cost trial' : 'skip a dedicated farm'} against roughly $${costs} of costs over ${weeks} weeks; rewards remain unconfirmed`, `roughly $${costs}, excluding capital losses`, `${weeks} weeks`),
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
    watchlist: r.watchlist, verdict: r.verdict, farm_steps: r.farm_steps };
}
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calibration = snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const fitted = fit(calibration);
  const tokenless = snapshot.protocols.filter(isPreToken);
  const ages = tokenless.map(p => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const defaultAge = ages.length ? median(ages) : 0;
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
    const base = fitted.multiple(p.category);
    const growth = Math.max(-MODEL.growth_clip_pct, Math.min(MODEL.growth_clip_pct, p.change_7d ?? 0));
    const growthMult = 1 + growth / 100 * MODEL.growth_weight;
    const maturity = MODEL.maturity_floor + MODEL.maturity_range * Math.min(age ?? defaultAge, MODEL.maturity_days) / MODEL.maturity_days;
    const implied = Math.max(1, Math.round(p.tvl_usd * base * growthMult * maturity));
    const verdict: Verdict = implied >= 25e6 && p.tvl_usd > 0 && implied / p.tvl_usd >= 0.30 ? 'farm' : implied >= 8e6 ? 'thin' : 'skip';
    return { ...p, rank: 0, token_status: 'pre-token', age_days: age, implied_value_usd: implied,
      watchlist: watch.has(p.slug), verdict, model: { base_multiple: round4(base), growth_pct: growth,
        growth_multiplier: round4(growthMult), maturity_multiplier: round4(maturity), age_days: age }, farm_steps: [] };
  });
  board.sort((a, b) => b.implied_value_usd - a.implied_value_usd || compare(a.slug, b.slug));
  board.forEach((r, i) => { r.rank = i + 1; r.farm_steps = farmSteps(r, defaultAge); });
  screened.board_size = board.length;
  const live = liveRows(snapshot);
  const early = board.filter(r => !r.watchlist).length;
  return { board, radar: {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model: MODEL, model_version: MODEL_VERSION, watchlist_size: watch.size, board_size: board.length,
    early_size: early, live_size: live.length, rows: board.map(radarRow), live,
    methodology: { model_version: MODEL_VERSION, calibration_n: calibration.length,
      calibration_excluded_nonpositive: snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd <= 0).length,
      global_multiple: round4(fitted.global), categories: fitted.categories
        .sort((a, b) => b.n - a.n || compare(a.category, b.category)).map(c => ({ ...c, multiple: round4(c.multiple) })),
      global_fallback: 'Null categories and categories with fewer than 5 calibration members use the global median.',
      calibration_policy: 'Calibration requires recorded market cap > 0 and TVL > 0. Nonpositive recorded market caps are treated as unpriced/dead tokens and excluded from calibration.',
      oos: validate(calibration), growth_clip_pct: MODEL.growth_clip_pct, growth_weight: MODEL.growth_weight,
      maturity_floor: MODEL.maturity_floor, maturity_days: MODEL.maturity_days, default_age_days: defaultAge,
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
