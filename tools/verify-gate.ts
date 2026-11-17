// A local stand-in for the sealed seven-row gate (RULES.txt, "The gate"), run on what main.ts wrote.
// The kit ships no local grader for this competition, so this checks the seven rows the rules name --
// the dashboard's files and their no-network rule, the board's rows and slugs, the ranks and implied
// values, the watchlist coverage, the farm steps, the screenshots, and the dossier -- and prints one
// line per row. It reads the sealed snapshot for the watchlist and the protocol slugs.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//   node tools/verify-gate.ts out ../input/snapshot.json

import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2] ?? 'out';
const snapshotPath = process.argv[3] ?? '/input/snapshot.json';
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
  protocols: { slug: string }[];
  watchlist: string[];
};

const rows: [string, boolean, string][] = [];
const say = (row: string, ok: boolean, detail: string): void => {
  rows.push([row, ok, detail]);
};
const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// ---------------------------------------------------------------- dashboard_files
function walk(root: string): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, name.name);
    if (name.isDirectory()) out.push(...walk(p));
    else if (name.isFile()) out.push({ path: p, size: lstatSync(p).size });
  }
  return out;
}
let dashOk = true;
let dashDetail = '';
try {
  const files = walk(join(out, 'dashboard'));
  const bytes = files.reduce((n, f) => n + f.size, 0);
  if (!files.some((f) => f.path.endsWith('index.html'))) { dashOk = false; dashDetail = 'no index.html'; }
  if (!files.some((f) => f.path.endsWith('.css'))) { dashOk = false; dashDetail = 'no .css'; }
  if (!files.some((f) => f.path.endsWith('.js'))) { dashOk = false; dashDetail = 'no .js'; }
  if (files.length > 400) { dashOk = false; dashDetail = `${files.length} files`; }
  if (bytes > 4_194_304) { dashOk = false; dashDetail = `${bytes} bytes`; }
  for (const f of files) {
    const name = f.path.slice(f.path.lastIndexOf('/') + 1);
    if (!PLAIN.test(name)) { dashOk = false; dashDetail = `bad name ${name}`; }
  }
  // The no-network rule: no http/https address in an HTML attribute, a CSS file, a script import or a
  // require specifier. A URL in visible text or a comment is allowed.
  for (const f of files) {
    const text = readFileSync(f.path, 'utf8');
    if (f.path.endsWith('.css') && /https?:\/\//.test(text.replace(/\/\*[\s\S]*?\*\//g, ''))) { dashOk = false; dashDetail = `${f.path} names a network address`; }
    if (f.path.endsWith('.html')) {
      for (const m of text.matchAll(/<[a-z]+[^>]*>/gi)) {
        if (/(href|src|action|poster|data|srcset)\s*=\s*["'][^"']*https?:\/\//i.test(m[0]!)) { dashOk = false; dashDetail = `${f.path} names a network address in an attribute`; }
      }
    }
    if (f.path.endsWith('.js') || f.path.endsWith('.mjs')) {
      for (const m of text.matchAll(/(?:import|require|from)\s*\(?\s*["']([^"']+)["']/g)) {
        if (/^https?:\/\//.test(m[1]!)) { dashOk = false; dashDetail = `${f.path} imports a network address`; }
      }
    }
  }
  say('dashboard_files', dashOk, dashOk ? `${files.length} files, ${bytes} bytes, no network address` : dashDetail);
} catch (err) {
  say('dashboard_files', false, String(err));
}

// ---------------------------------------------------------------- board_file + sorted_by_value
const slugs = new Set(snapshot.protocols.map((p) => p.slug));
let board: { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }[] = [];
let boardOk = true;
let boardDetail = '';
let stepsOk = true;
let stepsDetail = '';
let sortOk = true;
let sortDetail = '';
try {
  const raw = readFileSync(join(out, 'board.json'), 'utf8');
  const parsed = JSON.parse(raw) as { rows?: typeof board } | typeof board;
  board = Array.isArray(parsed) ? parsed : parsed.rows!;
  if (!Array.isArray(board)) { boardOk = false; boardDetail = 'no rows array'; }
  else {
    if (board.length < 100 || board.length > 4000) { boardOk = false; boardDetail = `${board.length} rows`; }
    const seen = new Set<string>();
    for (const r of board) {
      if (!slugs.has(r.slug)) { boardOk = false; boardDetail ||= `invented slug ${r.slug}`; }
      if (seen.has(r.slug)) { boardOk = false; boardDetail ||= `duplicate slug ${r.slug}`; }
      seen.add(r.slug);
      if (typeof r.name !== 'string' || r.name.length === 0) { boardOk = false; boardDetail ||= `row ${r.slug} has no name`; }
      if (!Number.isInteger(r.rank) || r.rank <= 0) { boardOk = false; boardDetail ||= `row ${r.slug} has no rank`; }
      if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) { boardOk = false; boardDetail ||= `row ${r.slug} has no usable implied value`; }
      if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { stepsOk = false; stepsDetail ||= `row ${r.slug} has ${r.farm_steps?.length} steps`; }
      else for (const s of r.farm_steps) {
        const t = String(s).trim();
        if (t.length < 20 || t.length > 600) { stepsOk = false; stepsDetail ||= `row ${r.slug} has a ${t.length}-character step`; }
      }
    }
    if (raw.length > 8_388_608) { boardOk = false; boardDetail ||= `${raw.length} bytes`; }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  if (ranks.length !== board.length || ranks.some((r, i) => r !== i + 1)) { sortOk = false; sortDetail = 'ranks are not 1..N once each'; }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) { sortOk = false; sortDetail = `row ${i + 1} rises above row ${i}`; }
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size === 1) { sortOk = false; sortDetail = 'every implied value is the same'; }
  say('board_file', boardOk, boardOk ? `${board.length} rows, every slug in the snapshot` : boardDetail);
  say('sorted_by_value', sortOk, sortOk ? 'ranks 1..N, values never rise' : sortDetail);
  say('farm_steps', stepsOk, stepsOk ? 'every row 3 to 12 steps of 20 to 600 characters' : stepsDetail);
} catch (err) {
  say('board_file', false, String(err));
}

// ---------------------------------------------------------------- coverage
const have = new Set(board.map((r) => r.slug));
const missing = snapshot.watchlist.filter((s) => !have.has(s));
say('coverage', missing.length === 0, missing.length === 0 ? `all ${snapshot.watchlist.length} watchlist slugs ranked` : `missing ${missing.slice(0, 4).join(', ')}`);

// ---------------------------------------------------------------- screenshots
let shotOk = true;
let shotDetail = '';
try {
  const files = readdirSync(join(out, 'screenshots')).filter((n) => !n.startsWith('.'))
    .map((n) => ({ n, size: statSync(join(out, 'screenshots', n)).size }));
  if (files.length < 3 || files.length > 4) { shotOk = false; shotDetail = `${files.length} images`; }
  for (const f of files) {
    if (!PLAIN.test(f.n)) { shotOk = false; shotDetail = `bad name ${f.n}`; }
    if (f.size > 524_288) { shotOk = false; shotDetail ||= `${f.n} is ${f.size} bytes`; }
    const b = readFileSync(join(out, 'screenshots', f.n));
    const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (!png && !jpeg) { shotOk = false; shotDetail ||= `${f.n} is neither PNG nor JPEG`; continue; }
    if (png) {
      const w = b.readUInt32BE(16);
      const h = b.readUInt32BE(20);
      const long = Math.max(w, h);
      const short = Math.min(w, h);
      if (long > 1440 || short < 800) { shotOk = false; shotDetail ||= `${f.n} is ${w}x${h}`; }
    }
  }
  say('screenshots', shotOk, shotOk ? `${files.length} images, ${files.map((f) => f.n).join(', ')}` : shotDetail);
} catch (err) {
  say('screenshots', false, String(err));
}

// ---------------------------------------------------------------- dossier_matches
try {
  const wanted = buildDossier(out, { text_max_bytes: 65_536 });
  const have = readFileSync(join(out, 'dossier.json'));
  const same = Buffer.from(wanted).equals(have);
  say('dossier_matches', same && have.length <= 1_572_864, same
    ? `${have.length} bytes, byte for byte what buildDossier writes`
    : `differs from buildDossier (${have.length} vs ${wanted.length} bytes)`);
} catch (err) {
  say('dossier_matches', false, String(err));
}

let failed = 0;
for (const [row, ok, detail] of rows) {
  if (!ok) failed++;
  process.stdout.write(`${ok ? 'pass' : 'FAIL'}  ${row.padEnd(16)} ${detail}\n`);
}
process.stdout.write(`${rows.length - failed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
