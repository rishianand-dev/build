# Golden-set corpus

Real captured sites for `src/eval/golden-set.ts`'s precision/recall/F1 harness against `themeFromCapture`'s DOM-heuristic block classifier.

## What's here

Each `<site-slug>/` directory holds:
- `capture.json` — the real `PageCapture` from `capturePage()` (real DOM, screenshots, etc.)
- `expected.json` — hand-labeled `ExpectedBlock[]` ground truth, `{role, note?}[]`, section-level roles only (see `SECTION_ROLES` in `golden-set.ts`), top-to-bottom document order
- `screenshots/` — the captured screenshots, used for labeling and (via `eval/vlm-baseline.ts`) the zero-shot VLM baseline

`_capture-log.json` records the outcome (ok/blocked/error) of every capture attempt, including sites that never made it into the corpus.

## Labeling methodology (read before trusting or extending this corpus)

Labels are **self-labeled by inspecting the captured screenshot**, not independently human-verified — flagged explicitly here per the plan's own framing of this as a real limitation, not swept under the rug. To keep that self-labeling honest rather than noisy:

- **Only label what's visually unambiguous from the screenshot.** `header` and `footer` are near-zero-ambiguity (always present, always first/last). `hero`/`carousel`/`newsletter`/`banner` are labeled only when clearly identifiable (an obvious full-bleed promo image, an obvious email-capture form, an obvious slim colored top bar).
- **hero vs. carousel**: labeled `carousel` when the screenshot shows visible pagination dots/prev-next arrows on a full-bleed banner, `hero` otherwise. This is a visual proxy for "does the source DOM stack 2+ full-bleed slides," which can't be fully confirmed from a single static screenshot — a known source of label noise on this specific distinction.
- **Sections deliberately left unlabeled** (not a miss — genuinely out of scope): anything that doesn't map to a `SECTION_ROLES` value at all in the current schema (e.g. a 2-8 image mosaic grid, a category thumbnail strip — `from-capture.ts` builds these without assigning any role), and any tile/grid section where "collections" vs. "no role" is ambiguous from a screenshot alone (that ambiguity is resolved by DOM structure `themeFromCapture` sees that a screenshot doesn't show — labeling it either way without checking would be a guess, not ground truth).
- **nav is excluded entirely** — see the doc comment on `SECTION_ROLES` in `golden-set.ts`: it's always a child row inside `header`, never independent.

## Regenerating / extending

- Capture: `capturePage({ url, outDir: "data/golden-set/<slug>", viewport: {width:1440,height:900} })` (see `src/capture/capture.ts`).
- Score: `npm run eval:golden` (add `-- --update-baseline` to write the current run as the new regression baseline, `-- --vlm` to also run the zero-shot local-VLM baseline).
- Many major retail sites block headless Chromium outright (Cloudflare/Akamai interstitials, or an outright navigation timeout) — that's expected, not a bug in the capture pipeline. `_capture-log.json` records which sites were skipped and why.
