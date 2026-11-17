// Token launch radar (make.fun bounty token-radar-01): a Node 22 program, standard library only.
//
// It reads the sealed snapshot, fits the value model on the snapshot's own token-bearing protocols
// (lib/model.ts), ranks every record that carries no token and passes the launch screen, writes the
// board to /output/board.json, the page's data to /output/data.js, copies this repository's
// dashboard/ and screenshots/ into /output, and last writes /output/dossier.json -- the screenshots
// and a text of the page's source -- with the vendored make.fun library, byte for byte what the
// scorer rebuilds. Run it locally with:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Two runs over the same snapshot write the same bytes: no clock, no randomness, sorted writes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, boardRows, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value>, or --name=<value>, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(snapshot);
const rows = boardRows(radar);
const issue = boardIssue(rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping dot names; returns what it copied. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    const target = join(to, name);
    // A copy left read-only by an earlier run would stop the second run; write it fresh instead.
    if (existsSync(target)) rmSync(target, { force: true });
    copyFileSync(path, target);
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in three -- the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -\n`);
    process.exit(1);
  }
}

// The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

const c = radar.calibration;
const x = (n: number): string => `${(10 ** n).toFixed(2)}x`;
const network = process.stdout;
network.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.watchlist_size} on the watchlist, ` +
    `${radar.no_token_records} carry no token -> ${radar.rows.length} ranked, ${radar.screened.length} screened out, ${radar.live.length} token-bearing compared\n` +
    `token radar: model fitted on ${c.fitted_on} token-bearing records; 5-fold CV median error ${x(c.cv.median_log10_error)} ` +
    `(one global multiple: ${x(c.cv.baseline_median_log10_error)}), within 4x ${(c.cv.within_4x * 100).toFixed(0)}% against ${(c.cv.baseline_within_4x * 100).toFixed(0)}%; band ${x(c.cv.band_lo)} to ${x(c.cv.band_hi)}\n` +
    `token radar: implied value ${(radar.rows[0]!.implied_value_usd / 1e6).toFixed(0)}M at rank 1 (${radar.rows[0]!.name}), ` +
    `${(radar.rows[radar.rows.length - 1]!.implied_value_usd / 1e6).toFixed(1)}M at rank ${radar.rows.length}; watchlist rows all present\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
