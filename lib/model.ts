// The token radar's model: one sealed snapshot of the protocol universe in, one ranked board out,
// plus every number the dashboard shows. Standard library only, erasable TypeScript (Node 22 runs it
// as it is). No randomness and no clock: the same snapshot always writes the same bytes.
//
// The question this file answers: a protocol's launch is the token it may issue one day. What would
// that token be worth if the protocol's record stayed as it is? The snapshot states no value, so the
// model is calibrated on the snapshot's own other half: the token-bearing protocols, whose market cap
// and TVL it does carry. On those pairs MCap over TVL is not a constant -- it falls as TVL rises, and
// it differs by category -- so the multiple is a fitted function, not a house constant:
//
//   log10(MCap / TVL) = w0 + w1*log10(TVL) + w2*(log10(age+1) - mean) + w3*growth7d/100
//                       + sum over the protocol's category of a category offset
//
// fitted by ridge-regularised least squares with Huber re-weighting on the snapshot's own
// token-bearing protocols, and graded by 5-fold cross-validation against a one-multiple-for-everyone
// baseline (see `calibrate`). A pre-token protocol's implied value is that fit, times two small,
// stated tilts -- seven-day growth and time-with-no-token -- so the ranking is the record's own
// figures all the way down. No protocol name is ever special-cased.
//
// The board ranks the protocols most likely to issue a token of their own: the records that carry no
// token and are not a version, a bridge, a staking or restaking product or a CEX form of a token
// that already trades (the house's own screen, `screenReason`), because a product of an existing
// token is not a launch. Every record it sets aside is still listed on the page, with its figures and
// the reason, in `screened`.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One row of the board: a protocol's record, the model's arithmetic on it and the plan to farm it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  band_lo_usd: number;
  band_hi_usd: number;
  /** implied_value_usd / tvl_usd: what the model says a dollar of this protocol's TVL is worth. */
  multiple: number;
  /** 10^z, the fitted part of the multiple, before the two tilts. */
  base_multiple: number;
  growth_tilt: number;
  patience_tilt: number;
  /** The farm model's figures for one wallet: see FARM. */
  farm: FarmEstimate;
  /** Where this row stands by what a $5,000 wallet actually earns net, not by implied value. */
  ev_rank: number;
  farm_steps: string[];
}

/** What one diligent wallet's farm is worth, on stated assumptions (FARM). */
export interface FarmEstimate {
  budget_usd: number;
  days_held: number;
  /** The wallet's share of the campaign's deposit-days at today's TVL. */
  share: number;
  gross_usd: number;
  cost_usd: number;
  net_usd: number;
  chain: string;
}

/** A record the screen sets aside, with its figures and why. */
export interface ScreenedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  reason: string;
  /** What the model would say it is worth if the screen let it through: shown, never ranked. */
  implied_value_usd: number;
}

/** One token-bearing protocol of the snapshot: the model's own yardstick, and the page's comparison. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  age_days: number | null;
}

/** The fit on the snapshot's own token-bearing protocols, with its cross-validated error. */
export interface Calibration {
  lambda: number;
  fitted_on: number;
  tokens: string[];
  weights: number[];
  categories: string[];
  category_offsets: number[];
  /** Per category: the snapshot's own token-bearing protocols in it and their MCap/TVL spread. */
  category_table: { category: string; n: number; median: number; p25: number; p75: number; offset: number }[];
  global_median_multiple: number;
  cv: {
    folds: number;
    median_log10_error: number;
    within_2x: number;
    within_3x: number;
    within_4x: number;
    baseline_median_log10_error: number;
    baseline_within_2x: number;
    baseline_within_3x: number;
    baseline_within_4x: number;
    /** The band the board's rows carry: the middle half (25th to 75th percentile) of the CV residual. */
    band_lo: number;
    band_hi: number;
    /** The wider 10th-to-90th percentile band, shown in the detail view beside the middle half. */
    wide_lo: number;
    wide_hi: number;
  };
}

/** Everything the page renders, and everything board.json holds. */
export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: number;
  watchlist_size: number;
  no_token_records: number;
  rows: RadarRow[];
  screened: ScreenedRow[];
  live: LiveRow[];
  calibration: Calibration;
  screen_note: string;
  farm_note: string;
  /** The farm model's assumptions, so the page states exactly what main.ts assumed. */
  farm_assumption: { allocation_of_implied: number; campaign_days: number; budget_usd: number; days_held: number };
}

// ---------------------------------------------------------------- the snapshot

/** Parse and validate the sealed snapshot. Throws on anything the model cannot read. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: no protocols[] and watchlist[]');
  }
  if (typeof raw.as_of !== 'string' || typeof raw.floor_usd !== 'number') {
    throw new Error('snapshot: no as_of or floor_usd');
  }
  return raw;
}

const DAY_MS = 86_400_000;

/** Whole days from a `YYYY-MM-DD` day to the snapshot's own `as_of`, or null when the record has none. */
export function daysSince(asOf: string, day: string | null): number | null {
  if (day === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / DAY_MS));
}

/** A record with no token in it: DefiLlama carries neither a CoinGecko id nor a symbol for it. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const PRODUCT_CATEGORIES: Record<string, string> = {
  Bridge: 'a bridge',
  'Canonical Bridge': 'a canonical bridge',
  'Liquid Staking': 'a liquid staking product',
  'Liquid Restaking': 'a liquid restaking product',
  'Restaked BTC': 'a restaked BTC product',
  CEX: 'a centralised exchange',
};

/**
 * Why a token-less record is no launch of its own: it is a version of, a bridge to, a staked form of
 * or an exchange's record for a protocol whose token already trades. The house drew the same lines
 * for its own watchlist; this applies them to the whole snapshot, so the board is a launch list and
 * not a list of child records. Returns null when the record passes.
 */
export function screenReason(p: SnapshotProtocol): string | null {
  const known = PRODUCT_CATEGORIES[p.category ?? ''];
  if (known !== undefined) return `${known}: a product of a token that already trades`;
  if (VERSION_MARKER.test(p.name)) return 'a version marker in the name: a later deployment of an existing protocol';
  if (PRODUCT_WORD.test(p.name)) return 'a wrapped or staked product in the name';
  for (const ex of EXCHANGES) {
    if (p.name.startsWith(ex)) return `${ex}’s own record: an exchange product, not a launch`;
  }
  return null;
}

// ---------------------------------------------------------------- small maths

const log10 = (n: number): number => Math.log10(n);
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/** The median of a copy of `xs`; NaN on an empty list. */
function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

/** The `q` quantile of a copy of `xs` (linear interpolation), NaN on an empty list. */
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const v = xs.slice().sort((a, b) => a - b);
  const at = q * (v.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, v.length - 1);
  return v[lo]! + (v[hi]! - v[lo]!) * (at - lo);
}

/** The geometric median ratio: exp() of the median of the logs, so one 80x outlier cannot set it. */
function geometricMedian(xs: number[]): number {
  return xs.length === 0 ? Number.NaN : 10 ** median(xs.map(log10));
}

/** Solve A w = b for a square, symmetric, non-singular A by Gaussian elimination with pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const d = A.length;
  const m = A.map((row, i) => row.concat([b[i]!]));
  for (let i = 0; i < d; i++) {
    let piv = i;
    for (let r = i + 1; r < d; r++) if (Math.abs(m[r]![i]!) > Math.abs(m[piv]![i]!)) piv = r;
    if (piv !== i) {
      const t = m[i]!;
      m[i] = m[piv]!;
      m[piv] = t;
    }
    const diag = m[i]![i]!;
    if (Math.abs(diag) < 1e-12) continue;
    for (let r = i + 1; r < d; r++) {
      const f = m[r]![i]! / diag;
      if (f === 0) continue;
      for (let c = i; c <= d; c++) m[r]![c] = m[r]![c]! - f * m[i]![c]!;
    }
  }
  const w = new Array<number>(d).fill(0);
  for (let i = d - 1; i >= 0; i--) {
    const diag = m[i]![i]!;
    if (Math.abs(diag) < 1e-12) continue;
    let s = m[i]![d]!;
    for (let j = i + 1; j < d; j++) s -= m[i]![j]! * w[j]!;
    w[i] = s / diag;
  }
  return w;
}

// ---------------------------------------------------------------- the fit

const RATIO_FLOOR = 0.0005;
const RATIO_CEIL = 100;
const MIN_CATEGORY_N = 5;
const RIDGE_LAMBDA = 10;
const HUBER_ITERATIONS = 4;
const HUBER_FLOOR = 0.3;
const CV_FOLDS = 5;

/** A row the fit runs on: a token-bearing protocol whose ratio is inside the model's usable range. */
interface TrainRow {
  p: SnapshotProtocol;
  y: number;
  tvl: number;
  age: number;
  growth: number;
}

function trainRows(snapshot: Snapshot): TrainRow[] {
  const out: TrainRow[] = [];
  for (const p of snapshot.protocols) {
    if (p.gecko_id === null) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < RATIO_FLOOR || ratio > RATIO_CEIL) continue;
    out.push({
      p,
      y: log10(ratio),
      tvl: log10(p.tvl_usd),
      // A record with no listing day is treated as a two-year-old one: the middle of the range.
      age: log10((daysSince(snapshot.as_of, p.listed_at) ?? 365) + 1),
      growth: clamp(p.change_7d ?? 0, -50, 150) / 100,
    });
  }
  return out;
}

/** The categories the fit gives an offset: those with at least MIN_CATEGORY_N train rows, by name. */
function fitCategories(rows: TrainRow[]): string[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const c = r.p.category ?? 'Uncategorized';
    n.set(c, (n.get(c) ?? 0) + 1);
  }
  return [...n.entries()].filter(([, k]) => k >= MIN_CATEGORY_N).map(([c]) => c).sort();
}

const FEATURE_TOKENS = ['1', 'log10 TVL', 'log10 age', 'growth 7d', 'category offset'];
const termLabel = (i: number, cats: string[]): string => (i < 4 ? FEATURE_TOKENS[i]! : `category: ${cats[i - 4]}`);

function design(r: TrainRow, cats: string[], ageMean: number): number[] {
  const x = [1, r.tvl, r.age - ageMean, r.growth];
  const c = r.p.category ?? 'Uncategorized';
  for (const cat of cats) x.push(c === cat ? 1 : 0);
  return x;
}

function ageMeanOf(rows: TrainRow[]): number {
  return rows.reduce((s, r) => s + r.age, 0) / rows.length;
}

/**
 * Ridge-regularised least squares with Huber re-weighting: four passes, each row scaled by
 * 1/sqrt(max(HUBER_FLOOR, |residual|)), so the fit follows the bulk of the ratios and not the few
 * protocols that trade at 50x TVL. The target is winsorised at its own 10th and 90th percentile.
 */
function fit(rows: TrainRow[], cats: string[], lambda: number): { w: number[]; ageMean: number } {
  const ageMean = ageMeanOf(rows);
  const q10 = quantile(rows.map((r) => r.y), 0.1);
  const q90 = quantile(rows.map((r) => r.y), 0.9);
  const y = rows.map((r) => clamp(r.y, q10, q90));
  const X = rows.map((r) => design(r, cats, ageMean));
  const d = 4 + cats.length;
  let w: number[] | null = null;
  for (let pass = 0; pass < HUBER_ITERATIONS; pass++) {
    const rX: number[][] = [];
    const ry: number[] = [];
    for (let i = 0; i < X.length; i++) {
      const s = w === null ? 1 : Math.sqrt(Math.max(HUBER_FLOOR, Math.abs(y[i]! - dot(w, X[i]!))));
      rX.push(X[i]!.map((v) => v / s));
      ry.push(y[i]! / s);
    }
    const A: number[][] = [];
    const b = new Array<number>(d).fill(0);
    for (let a = 0; a < d; a++) {
      const row = new Array<number>(d).fill(0);
      for (let i = 0; i < rX.length; i++) {
        const v = rX[i]!;
        if (v[a] === 0) continue;
        for (let q = 0; q < d; q++) row[q] += v[a]! * v[q]!;
        b[a] += v[a]! * ry[i]!;
      }
      // The penalty skips the intercept, so the fit can find the level and not only the shape.
      row[a] += a === 0 ? 0 : lambda;
      A.push(row);
    }
    w = solve(A, b);
    if (!w.every((v) => Number.isFinite(v))) throw new Error('calibration: the fit did not converge');
  }
  return { w: w!, ageMean };
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** The fit's prediction for one row, as a multiple of TVL. */
function predictMultiple(w: number[], cats: string[], ageMean: number, r: TrainRow): number {
  return 10 ** clamp(dot(w, design(r, cats, ageMean)), -3, 1.5);
}

/** Cross-validated error of a fitted model, and of a one-multiple-for-everyone baseline. */
function crossValidate(rows: TrainRow[], cats: string[], lambda: number): Calibration['cv'] {
  const errs: number[] = [];
  const signed: number[] = [];
  const baseErrs: number[] = [];
  for (let fold = 0; fold < CV_FOLDS; fold++) {
    const train = rows.filter((_, i) => i % CV_FOLDS !== fold);
    const test = rows.filter((_, i) => i % CV_FOLDS === fold);
    if (train.length === 0 || test.length === 0) continue;
    const { w, ageMean } = fit(train, cats, lambda);
    const base = geometricMedian(train.map((r) => 10 ** r.y));
    for (const r of test) {
      const e = log10(predictMultiple(w, cats, ageMean, r)) - r.y;
      errs.push(Math.abs(e));
      signed.push(e);
      baseErrs.push(Math.abs(log10(base) - r.y));
    }
  }
  const share = (xs: number[], within: number): number =>
    xs.filter((e) => e <= log10(within)).length / xs.length;
  return {
    folds: CV_FOLDS,
    median_log10_error: median(errs),
    within_2x: share(errs, 2),
    within_3x: share(errs, 3),
    within_4x: share(errs, 4),
    baseline_median_log10_error: median(baseErrs),
    baseline_within_2x: share(baseErrs, 2),
    baseline_within_3x: share(baseErrs, 3),
    baseline_within_4x: share(baseErrs, 4),
    band_lo: quantile(signed, 0.25),
    band_hi: quantile(signed, 0.75),
    wide_lo: quantile(signed, 0.1),
    wide_hi: quantile(signed, 0.9),
  };
}

/**
 * Fit the model on the snapshot's own token-bearing protocols and grade it by 5-fold
 * cross-validation. Every number the page shows about the model's quality comes from here.
 */
export function calibrate(snapshot: Snapshot, lambda: number = RIDGE_LAMBDA): Calibration {
  const rows = trainRows(snapshot);
  if (rows.length < 30) throw new Error(`calibration: only ${rows.length} token-bearing records with a usable MCap/TVL ratio`);
  const cats = fitCategories(rows);
  const { w, ageMean } = fit(rows, cats, lambda);
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    const c = r.p.category ?? 'Uncategorized';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(10 ** r.y);
  }
  const categoryTable = cats
    .map((c, i) => {
      const v = byCat.get(c)!;
      return {
        category: c,
        n: v.length,
        median: geometricMedian(v),
        p25: quantile(v, 0.25),
        p75: quantile(v, 0.75),
        offset: w[4 + i]!,
      };
    })
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  return {
    lambda,
    fitted_on: rows.length,
    tokens: [...FEATURE_TOKENS.slice(0, 4), ...cats.map((c) => termLabel(4 + cats.indexOf(c), cats))],
    weights: w,
    categories: cats,
    category_offsets: cats.map((_, i) => w[4 + i]!),
    category_table: categoryTable,
    global_median_multiple: geometricMedian(rows.map((r) => 10 ** r.y)),
    cv: crossValidate(rows, cats, lambda),
    ...{ ageMean },
  } as Calibration & { ageMean: number };
}

// ---------------------------------------------------------------- the farm model

/**
 * What one wallet's farm is worth. Stated assumptions, not snapshot figures: a campaign hands out an
 * allocation worth ALLOCATION of the implied value to those who hold through it, and it splits that
 * pool by deposit-days. One wallet putting BUDGET in for DAYS, against today's TVL over a 90-day
 * campaign, holds BUDGET*DAYS/(TVL*90) of it. Costs are one bridge, three gas transactions and a
 * withdrawal, from CHAIN_COST, a rough per-chain figure the page prints beside every estimate.
 */
export const FARM = {
  allocation_of_implied: 0.15,
  campaign_days: 90,
  budget_usd: 5_000,
  days_held: 60,
};

/** Rough cost of a bridge, three gas transactions and a withdrawal on a chain, in US dollars. */
export const CHAIN_COST: Record<string, number> = {
  Ethereum: 22, Arbitrum: 2.4, Base: 1.6, Optimism: 1.6, Polygon: 0.6, BSC: 0.9,
  Solana: 0.4, Avalanche: 1.2, 'OP Mainnet': 1.6, Sonic: 0.5, Berachain: 1.1, TON: 0.6,
  Sui: 0.5, Aptos: 0.4, Tron: 3, Bitcoin: 12, 'zkSync Era': 1.2, Linea: 1.3, Scroll: 1.2,
  Mantle: 0.8, Blast: 0.7, Hyperliquid: 0.4, Plasma: 0.5, Monad: 0.5,
};
const DEFAULT_CHAIN_COST = 3;

function costOf(chain: string): number {
  return CHAIN_COST[chain] ?? DEFAULT_CHAIN_COST;
}

function farmEstimate(tvl: number, implied: number, chain: string): FarmEstimate {
  const share = (FARM.budget_usd * FARM.days_held) / Math.max(1, tvl * FARM.campaign_days);
  const gross = FARM.allocation_of_implied * implied * share;
  const cost = costOf(chain);
  return {
    budget_usd: FARM.budget_usd,
    days_held: FARM.days_held,
    share,
    gross_usd: Math.round(gross),
    cost_usd: Math.round(cost * 100) / 100,
    net_usd: Math.round(gross - cost),
    chain,
  };
}

// ---------------------------------------------------------------- the farm plan

const usd = (n: number): string => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
};
const pctSigned = (n: number | null): string => (n === null ? 'unreported' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);

/** A share of a pool a reader can read: 1.2e-6 prints as 0.00012%, not 0.000%. */
const shareText = (s: number): string => `${(s * 100).toPrecision(2)}%`;

/** The position a reader takes in this kind of protocol. Every line is a category of the snapshot. */
const VENUES: Record<string, string> = {
  Lending: 'supply into the protocol’s deepest market and borrow a little against it if the borrow rate is under the supply rate; borrowing is what the points programs weight',
  'Uncollateralized Lending': 'supply into its credit pools only what you can lose; this kind of lending carries real default risk',
  Dexs: 'provide liquidity to its main pair, or to a pair your wallet already holds, and keep the position through the campaign',
  'Yield Aggregator': 'deposit into its top vault on the chain with the most TVL, and check the vault’s own strategy before you sign',
  Yield: 'deposit into the pool the protocol’s own page leads with, and read its fees before you commit size',
  'Risk Curators': 'allocate to one of its curated vaults, and spread across two of its curators rather than one',
  'Onchain Capital Allocator': 'deposit into one of its vaults and hold; the allocator’s own points usually follow the vault’s TVL',
  RWA: 'deposit into its yield-bearing product and read the redemption terms: some lock until maturity',
  CDP: 'mint against your collateral and keep the position open; a mint that is repaid in the same block scores nothing',
  'Stablecoin Issuer': 'mint or hold its stablecoin in the protocol’s own pools, not only in a wallet',
  'Basis Trading': 'deposit into its delta-neutral product; read what happens to the position if funding flips negative',
  'Leveraged Farming': 'use a small position and read the liquidation rules first: this category loses money fastest',
  'Algo-Stables': 'buy through its own pool and hold the LP, not only the stablecoin',
  Derivatives: 'trade a small size through its own venue; volume, not only deposits, is usually what scores',
  'Prediction Market': 'take positions on markets you already have a view on; the points follow volume',
  Launchpad: 'buy into a launch through it, at a size you would hold anyway',
  Insurance: 'buy cover you actually want, or supply to a pool and take the underwriting risk knowingly',
  Restaking: 'restake through its own interface and read the slashing terms before you commit',
  'AI Agents': 'use the product itself, at a small size, and hold any position it issues',
  'Decentralized AI': 'stake through its own interface and keep the position live through the campaign',
  Bridge: 'bridge a real position through it and use the pool on the far side, not only the route',
  'Cross Chain Bridge': 'move a position you are keeping anyway across it, and hold the LP on the far side',
  Farm: 'deposit into its headline vault and re-check the farm’s own token terms weekly',
  Synthetics: 'mint or trade a small position through its own venue',
  Indexes: 'mint its index token and hold it, rather than only holding the underlying',
  Payments: 'route real payments through it where you can',
  Privacy: 'hold a position in its shielded pool where it fits what you do',
  'NFT Marketplace': 'list and trade at a size you would anyway',
  Governance: 'delegate and vote through its own interface; participation often carries a weight of its own',
  'Liquidity Manager': 'use a managed vault and compare its fee to doing the range by hand',
  'Collateral Management': 'supply through its markets and keep the health factor well clear of liquidation',
  'Token Locker': 'lock a position you were going to hold anyway',
  'OTC Marketplace': 'trade through it at a size you would not put on a venue order book',
  'Crypto Card Issuer': 'use the card for real spending where your jurisdiction allows it',
  'Interest Rate Derivatives': 'hold a hedged rate position through its own venue',
  'Collateral Markets': 'supply collateral and borrow a little against it to show the position is used',
  'Dual-Token Stablecoin': 'mint through its own interface and hold both legs',
  'Stablecoin Wrapper': 'swap a real balance through it and hold the wrapper, not only the swap',
  'Reserve Currency': 'hold a position in its reserve pool',
  'Anchor BTC': 'mint its anchored form and hold it; read the custody terms first',
  'Decentralized BTC': 'mint through its own interface and read how the peg is kept',
  CeDeFi: 'use its product at a size you would hold anyway, and read the custody terms before you size up',
  'Options Vault': 'deposit into its headline vault and read the strike before you commit',
  Options: 'trade a position you wanted anyway through its own venue',
  'Staking Pool': 'stake through its own pool and read the terms of the staking token',
  DOR: 'deposit into its own markets and hold through the campaign',
  Chain: 'use the chain itself: bridge in, hold a balance, take one position in its flagship app',
};
const DEFAULT_VENUE = 'deposit into the protocol’s own headline product and hold the position through the campaign; check what it does with your money first';

/** Where a wallet pays gas on this protocol: its first chain, or a cheap default when it lists none. */
function gasChain(p: SnapshotProtocol): string {
  const first = p.chains[0];
  if (first === undefined) return 'Ethereum';
  return first;
}

/**
 * How to farm one protocol: six concrete steps, each with what it costs and how long it takes, built
 * from the record's own figures -- its TVL, its chains, its seven-day change, its listing day -- and
 * from the category of the record. The same derivation the page recomputes, so the two agree.
 */
export function farmPlan(row: Omit<RadarRow, 'farm_steps' | 'ev_rank'>, asOf: string): string[] {
  const chain = row.farm.chain;
  const age = row.age_days === null ? 'no listing day in the record' : `${row.age_days} days in the snapshot's record with no token`;
  const cost = usd(row.farm.cost_usd);
  const floor80 = usd(row.tvl_usd * 0.7);
  const venue = VENUES[row.category ?? ''] ?? DEFAULT_VENUE;
  const budget = usd(row.farm.budget_usd);
  const steps = [
    `Read the record before anything else: ${row.name} carries no token in the snapshot of ${asOf} (${row.category ?? 'no category'} on ${row.chains.slice(0, 3).join(', ') || 'no chain listed'}), ${usd(row.tvl_usd)} TVL, 7-day ${pctSigned(row.change_7d)}, ${age}. Check its own docs and governance for a points or airdrop programme before you commit; 10 minutes, no cost.`,
    `Fund a wallet on ${chain}: hold ${budget} in USDC or the chain's gas token, in a wallet you alone control. Bridge or buy in one or two transactions and expect about ${cost} of gas and fees for the whole round trip; 15 minutes.`,
    `Take the position: ${venue}. Start at ${budget} rather than your maximum, and keep 20% of your budget back for gas and for a top-up if the campaign runs long; 10 minutes, ${cost} of gas.`,
    `Hold it and keep it used: re-deposit, rebalance or repay and borrow again once a month (about ${usd(Math.max(1, row.farm.cost_usd / 4))} a month) so the wallet shows continued use. Campaigns weight deposit-days, and a wallet that appears only on the day of a launch is filtered out; 10 minutes a month.`,
    `Watch the dilution, which is the real cost: the pool is shared among everyone's deposit-days, so at today's ${usd(row.tvl_usd)} TVL your ${budget} for ${FARM.days_held} days earns about ${usd(row.farm.gross_usd)} (a ${usd(row.implied_value_usd)} implied value, ${usd(row.implied_value_usd * FARM.allocation_of_implied)} of it the campaign's pool, your share ${shareText(row.farm.share)}). If TVL doubles the expectation halves; 5 minutes a week.`,
    `Set the exit now: if 7-day TVL stays under ${floor80} for two weeks running, or the docs change the terms, withdraw (${cost}, settles in minutes). Net of that cost the farm is about ${usd(row.farm.net_usd)}.`,
  ];
  return steps.map((s) => s.trim());
}

// ---------------------------------------------------------------- the board

/**
 * Rank the snapshot: fit the model, score every record that carries no token and passes the screen,
 * and keep the ones the screen set aside beside the board with their figures.
 */
export function buildRadar(snapshot: Snapshot): Radar {
  const calibration = calibrate(snapshot);
  const ageMean = (calibration as Calibration & { ageMean: number }).ageMean;
  const watch = new Set(snapshot.watchlist);
  const rows: Omit<RadarRow, 'rank'>[] = [];
  const screened: ScreenedRow[] = [];
  const live: LiveRow[] = [];
  let noToken = 0;

  for (const p of snapshot.protocols) {
    const age = daysSince(snapshot.as_of, p.listed_at);
    if (!recordsNoToken(p)) {
      if (p.mcap_usd !== null && p.tvl_usd > 0) {
        live.push({
          slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd,
          multiple: p.mcap_usd / p.tvl_usd, age_days: age,
        });
      }
      continue;
    }
    noToken++;
    const train: TrainRow = {
      p,
      y: 0,
      tvl: log10(Math.max(1, p.tvl_usd)),
      age: log10((age ?? 365) + 1),
      growth: clamp(p.change_7d ?? 0, -50, 150) / 100,
    };
    const base = predictMultiple(calibration.weights, calibration.categories, ageMean, train);
    const growthTilt = 1 + 0.2 * clamp((p.change_7d ?? 0) / 100, -0.5, 1.5);
    // A launch-readiness tilt, not a fitted effect: the fit finds no usable age signal (the page
    // prints the coefficient), so the model tilts by at most +-15% and states why.
    const patienceTilt = age === null ? 1 : 0.85 + 0.3 * (clamp(age, 0, 1460) / 1460);
    const implied = Math.max(1, Math.round(p.tvl_usd * base * growthTilt * patienceTilt));
    const reason = screenReason(p);
    if (reason !== null) {
      screened.push({
        slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
        age_days: age, reason, implied_value_usd: implied,
      });
      continue;
    }
    const chain = gasChain(p);
    const row: Omit<RadarRow, 'rank' | 'ev_rank'> = {
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, age_days: age, on_watchlist: watch.has(p.slug),
      implied_value_usd: implied,
      band_lo_usd: Math.max(1, Math.round(implied * 10 ** calibration.cv.band_lo)),
      band_hi_usd: Math.max(2, Math.round(implied * 10 ** calibration.cv.band_hi)),
      multiple: implied / Math.max(1, p.tvl_usd),
      base_multiple: base, growth_tilt: growthTilt, patience_tilt: patienceTilt,
      farm: farmEstimate(p.tvl_usd, implied, chain),
      farm_steps: [],
    };
    row.farm_steps = farmPlan(row, snapshot.as_of);
    rows.push(row);
  }

  // The board's order: implied value first, then the model's own inputs, then the slug, so two runs
  // and any two identical figures still write one order.
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  // The same rows again by what the farm is worth to one wallet: the value ranking and the farming
  // ranking are not the same list, and the page shows both.
  const byEv = rows.slice().sort((a, b) => b.farm.net_usd - a.farm.net_usd || b.tvl_usd - a.tvl_usd);
  const evRank = new Map<string, number>();
  byEv.forEach((r, i) => evRank.set(r.slug, i + 1));
  const ranked: RadarRow[] = rows.map((r, i) => ({ ...r, rank: i + 1, ev_rank: evRank.get(r.slug)! }));
  live.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  screened.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    protocols: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    no_token_records: noToken,
    rows: ranked,
    screened,
    live,
    calibration,
    screen_note:
      'A record that is a version, a bridge, a staking or restaking product or an exchange form of a protocol whose token already trades is no launch of its own, so the board leaves it out and lists it beside the board with its figures. The screen uses the snapshot\'s own fields -- category and name -- and no list of protocol names.',
    farm_note:
      `Farm value assumes a campaign worth ${(FARM.allocation_of_implied * 100).toFixed(0)}% of the implied value, split by deposit-days over a ${FARM.campaign_days}-day campaign, for one wallet of ${usd(FARM.budget_usd)} held ${FARM.days_held} days, less the ${'`'}cost of gas${'`'} shown per chain. It is an assumption, stated on the page, not a figure the snapshot carries.`,
    farm_assumption: { ...FARM },
  };
}

/** The gate's own view of the board: rows only, in rank order. */
export function boardRows(radar: Radar): { rank: number; slug: string; name: string; implied_value_usd: number; farm_steps: string[] }[] {
  return radar.rows.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
}

/** What the gate would refuse, or null: answers it here rather than at the gate. */
export function boardIssue(rows: ReturnType<typeof boardRows>, snapshot: Snapshot): string | null {
  if (rows.length < 100) return `only ${rows.length} rows: the gate wants 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of rows) {
    if (!slugs.has(r.slug)) return `row ${r.rank} names ${r.slug}, which the snapshot does not list`;
    if (!(r.implied_value_usd > 0)) return `row ${r.rank} has no positive implied value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.rank} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.rank} has a farm step of ${t.length} characters`;
    }
  }
  const ranks = new Set(rows.map((r) => r.rank));
  if (ranks.size !== rows.length || Math.min(...ranks) !== 1 || Math.max(...ranks) !== rows.length) {
    return 'the ranks are not exactly 1 to N';
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} rises above row ${i}`;
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size === 1) return 'every implied value is the same: this ranks nothing';
  const have = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !have.has(s));
  if (missing.length > 0) return `the watchlist is not covered: ${missing.slice(0, 4).join(', ')}`;
  return null;
}

/** The dashboard's data, as the script the page loads: window.RADAR. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
