# makefun-token-radar-03

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rioxbt/makefun-token-radar-03/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rioxbt/makefun-token-radar-03/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A Node 22 program that answers one question — *what would a pre-token protocol's launch be worth, and is it
worth farming?* — by fitting its value model on the sealed snapshot's own other half, the protocols whose
token already trades. It ranks every record that carries no token and passes a launch screen, hands in a
dashboard that shows the ranking with the fit's measured error beside every number, and prices the farm of
each protocol with its costs and its dilution.

## The value model, and the numbers behind it

The snapshot carries no value, no ranking and no airdrop flag. What it does carry, for 126 protocols, is both
a TVL and a market cap: the record of what a token of that protocol is worth against the TVL behind it. That
is the model's yardstick, and the multiple is fitted on it rather than set by hand:

```
log10(MCap / TVL) = 2.4337  − 0.4017·log10(TVL) + 0.0056·(log10(age) − mean) − 0.0255·growth7d + category offset
```

Ridge-regularised least squares (λ = 10) in log space, Huber re-weighted, target winsorised at its 10th and
90th percentile, fitted on the 126 token-bearing records whose MCap/TVL ratio is usable, with an offset for
each of the 9 categories holding at least 5 of them. The two tilts the model then applies to a pre-token
record — 7-day TVL growth, and time in the record with no token — are bounded (±20% and ±15%) and are stated
as judgement, not fitted: measured on those same records, neither has a usable effect on the ratio
(rank correlation −0.02 and −0.01), so the fit gives them almost no weight and the page prints that.

The fit is graded by deterministic 5-fold cross-validation against the obvious baseline, one multiple for
every protocol:

| 5-fold cross-validation on the snapshot's own 126 token-bearing records | median error | within 2× | within 3× | within 4× |
| --- | --- | --- | --- | --- |
| **this fitted model** | **×3.66** | **29%** | **45%** | **55%** |
| baseline: one global multiple (median ×0.214) | ×5.04 | 29% | 35% | 39% |

So the model beats a single global multiple by about a quarter on the median error, and by 16 points on how
often it lands within 4×. It is honest about the rest: a claim like this is worth ×0.26 to ×3.19 around the
point estimate in its middle half (the 10th-to-90th percentile band is ×0.12 to ×15.32), and every row of the
board carries that band, so the ranking is the claim and the number is a range. The measured weight on TVL is
what does the work — a dollar of TVL is worth less in a big protocol (MCap grows roughly as TVL^0.6) — and the
fitted category offsets range from −0.249 (Liquid Staking, n=9, median ×0.041) to +0.316 (Canonical Bridge,
n=7, median ×1.126).

## The board

From the sealed snapshot of 758 protocols (2026-11-14, floor $50M): **342 records carry no token**. 144 of
them are a version, a bridge, a staking or restaking product or an exchange's own record of a protocol whose
token already trades, so they are no launch of their own; they are listed with their figures and the reason
on their own tab rather than ranked. **198 are ranked** — all 40 of the house watchlist, 20 more above the
floor that the watchlist itself leaves out, and 138 below it — with:

- an implied value and its band, and the arithmetic broken out term by term in each protocol's own view;
- six farm steps with the cost and the time of each, built from the record's own TVL, chains, 7-day change
  and listing day, and from the protocol's category;
- what one wallet of $5,000 held 60 days actually earns after gas, which is a different ranking from the
  implied value: the board's rank 1 is worth $19 to that wallet, while the best farm on the board
  (MetalX Swap) is worth $330. Both orderings are one click apart on the page;
- a **beyond the floor** marker with its own filter on the 20 rows above the house's own floor that its
  watchlist leaves out (Sentora Curator, BitFi Basis, Polymarket International, OnRe, Resolv …): the list is
  a floor under the board and never a ceiling over it.

The dashboard is a static page with no framework and no network: the board (sortable and filterable by
search, category, chain and watchlist), a protocol's own view, the screened records, the 144 token-bearing
protocols the model was fitted on, and a method tab carrying every table above. It re-derives each row's
implied value in the browser from the published weights and the row's own figures, and prints whether that
matches board.json — so the page, the data and the code can be seen to agree.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Reads the sealed snapshot (or `/input/snapshot.json` in the grader's container), writes `out/board.json`,
`out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Two runs over the same snapshot
write the same bytes. To re-render the screenshots from the page's own files, run
`CHROME=/path/to/chrome sh tools/render-screenshots.sh`, then `main.ts` again so the dossier carries them.

## Repository layout

| path | what it is |
| --- | --- |
| `main.ts` | the entry: reads the snapshot, writes the board, the page's data, the dashboard and the dossier |
| `lib/model.ts` | the screen, the fit, the cross-validation, the farm model and the farm plans |
|  `dashboard/` | `index.html`, `app.css`, `app.js`: x, no dependency and no network |
| `screenshots/` | the three views the judge is shown: the board, a protocol's own view, the filtered board |
| `vendor/makefun-board.ts` | the kit's dossier library, byte for byte, as the rules ask |
| `tools/verify-gate.ts` | a local stand-in for the sealed seven-row gate, since the kit ships no grader |
| `tools/render-screenshots.sh` | renders the three screenshots from the page's own files in a headless browser |

## Verification

The kit ships no local grader for this competition, so `tools/verify-gate.ts` re-implements the seven rows the
rules name and runs them on what `main.ts` wrote. Its last run:

```
pass  dashboard_files  3 files, 50712 bytes, no network address
pass  board_file       198 rows, every slug in the snapshot
pass  sorted_by_value  ranks 1..N, values never rise
pass  farm_steps       every row 3 to 12 steps of 20 to 600 characters
pass  coverage         all 40 watchlist slugs ranked
pass  screenshots      3 images, 1-board.png, 2-detail.png, 3-filtered.png
pass  dossier_matches  1348598 bytes, byte for byte what buildDossier writes
7 passed, 0 failed
```

Two independent runs into two fresh directories compare identical (`diff -r` over `board.json`, `data.js`,
`dossier.json`,  `dashboard/` and `screenshots/`), and the dossier is 1.29 MiB against the 1.5 MiB cap. The
kit's own `makefun check` passes `competition_open`, `snapshot` (15 files, 1,100,063 bytes), `license_osi`
(SPDX-License-Identifier: MIT) and `entrypoint` (main.ts, node22); the transcript rows are the submission's.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dqdqv5x3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
