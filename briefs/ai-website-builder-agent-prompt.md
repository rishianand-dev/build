# Project brief for coding agent: AI-assisted website builder (URL → sections)

## Context

We already have a page builder (screenshots attached separately in the actual dev environment) with this data model:

```
Site
 └─ Version (draft | published, versioned, branchable)
     ├─ Theme (colors, type scale, spacing — global tokens)
     ├─ Page[]
     │    └─ Section[] (ordered)
     │         └─ Row[]
     │              └─ Column[] (width_pct, placeholder_type, content)
     └─ SharedInstance[] (Header, Footer, ProductCard — referenced by id from any page)
```

Section types already supported in the builder UI: `Slideshow, Gallery, Collapsible, Form, Grid, Collections, Parallax-Image, Search, Multilogos, Deal_countdown, News_letter, Logos, Compare, Title, Row, Best, Feature, Header, Footer, ProductCard`.

Each section is one of two shapes:
1. **List-bound** (Slideshow, Gallery): array of items, each item = `{ image, alt, link: { source_type, source_id }, index }`.
2. **Row/Column layout** (Header, ProductCard): rows made of percentage-width columns, each column has a `placeholder_type` from a closed enum (e.g. Header row-3 placeholders: `Announcement, Hamburger, Menu, Logo, Search, Login, Wishlist, Cart`).

Behavioral props exist outside content (e.g. Header: `always_fixed_on_scroll: bool`, `reappear_on_scroll_up: "1sec"`).

## Goal of this build

Given a **live website URL**, produce a **draft Version** of a new site in our builder's exact schema — auto-filling as many sections/rows/columns/content fields as possible — such that a human only needs to review/correct output in the existing builder UI, not build from scratch.

Target split: ~80% of fields auto-filled with high confidence, ~20% flagged for manual completion. Never silently guess — unmapped or low-confidence fields must show as an explicit "needs review" state, not a blank or a wrong default.

## Scope for this build (MVP — build in this order, stop and check in after each phase)

### Phase 1 — Capture service
- Input: a URL (single page first, sitemap crawl later).
- Use Playwright (headless Chromium) to render the page fully (wait for network idle + lazy-loaded images).
- Capture: full DOM snapshot, computed styles per element, a full-page screenshot, and a list of network asset URLs (images, fonts).
- **Also capture behavior, not just static state**: scripted scroll from top to 600px and back, screenshot before/after, to detect sticky/fixed header behavior. Scripted hover over the first 3 repeated card-like elements, screenshot before/after, to detect hover-reveal content.
- Output: a single structured `PageCapture` JSON (DOM tree + styles + screenshots + interaction diffs) — this is the only artifact later phases read from. Store screenshots as files, reference by path.

### Phase 2 — Section segmentation & classification
- Input: `PageCapture`.
- Segment the DOM into top-level visual blocks (use landmark tags, repeated-sibling detection, and vertical whitespace gaps as heuristics first).
- For each block, classify against **our closed section-type enum only** (list above) using an LLM call that receives: the block's HTML snippet (cleaned/simplified), its cropped screenshot region, and the enum as the only allowed output.
- Require the LLM to return `{ section_type, confidence, evidence[] }`. If confidence is below threshold or `section_type` isn't in the enum, output `section_type: "unmapped"` — never force-fit.
- Unit-test this step with a fixed set of sample captures and expected labels (build a small golden-set regression suite; this classification step is the one most likely to silently regress).

### Phase 3 — Row/column decomposition for layout sections (Header, ProductCard, Footer)
- Input: a block classified as a Row/Column-type section.
- Decompose into rows (stacked horizontal bands) and, within each row, columns.
- For each column, classify into the **placeholder enum specific to that section type** (e.g. Header uses `Announcement, Hamburger, Menu, Logo, Search, Login, Wishlist, Cart`; define equivalent fixed enums per section type — get these from the existing builder's UI options, don't invent new ones).
- Compute `width_pct` per column from rendered pixel widths, normalized to sane round numbers, respecting a minimum width for icon-only columns.
- Populate behavioral props from the Phase 1 interaction diffs (e.g. `always_fixed_on_scroll` = true if header position was identical before/after scroll).
- Any column that doesn't match a known placeholder → `placeholder_type: "unmapped"`, keep it in output with its raw content so a human can classify it manually later.

### Phase 4 — List-bound section extraction (Slideshow, Gallery)
- Input: a block classified as list-bound.
- Extract ordered items: image URL, alt text (from `alt` attr or nearby caption), and link target.
- Link target resolution: classify the link's `href` against our `source_type` enum (`Category, Product, Collection, External-URL, Page`) — this is a constrained-selection problem like the endpoint binding below, not free text.
- Output array of `{ image, alt, link: { source_type, source_id_or_url }, index }`.

### Phase 5 — Data/endpoint binding (for sections that need backend data, e.g. Collections/ProductList)
- Capability registry is provided: `capability-registry.json` (174 endpoints, auto-tagged from our real frontend service layer) and a human-readable `capability-registry-summary.md`. Use these as the starting registry — **do not treat `request_body_fields_guess` as ground truth**; it was extracted heuristically via regex from TypeScript source and needs validation against real backend contracts (Postman/OpenAPI/backend team) before being used to generate live payloads. Flag any field used in generation that hasn't been validated yet.
- For any section requiring dynamic data, match required capability (e.g. `list_products`) against the registry `capability` tags. Never invent a param not present in the endpoint's known body fields.
- Known gaps already identified in this registry pass — account for these up front rather than rediscovering them:
  - **No dedicated `list_products`-with-filters-and-sort single endpoint was found** — filtering (`list_filter_options`), specifications (`list_product_specifications`), and listing (`list_products`, multiple candidates: `getEntityProducts`, `getSpecialProductsById`, `searchByProducts`) are separate calls. The agent must pick the right combination per use case (homepage collection vs. filterable list page) and document why — don't assume one endpoint covers all Collection/Grid section needs.
  - **Sort is not visibly present as a first-class param on the list endpoints extracted** — if a source site's list page has a sort dropdown, this is very likely a real gap-report case (Phase 5's gap-reporting requirement), not a mapping bug.
  - Several endpoints resolve to the same path from different function names (e.g. `getSalesOrderDetailsEndPoint`/`getoneOrderHistoryEndPoint`/`getPosOrdersByIdEndPoint` all hit `/sales-orders/one`) — dedupe by path, not by function name, when building the final capability index, or the agent will treat one real endpoint as three different capabilities.
  - ~40 of the 174 extracted functions are account/checkout/logistics operations (returns, loyalty redemption, campaigns, appointments) irrelevant to page-content rendering — already excluded from the priority capability list in the summary doc, no action needed unless a future section type requires them (e.g. an "Appointment booking" section).
- Diff what the source page visually implies (filters, sort, pagination) against the matched endpoint's known capability. Any implied feature with no matching capability → add to a structured **gap report**, do not omit silently and do not fabricate the feature.
- Output: `{ matched_endpoint, payload (validated fields only), gaps[] }`.

### Phase 6 — Assembly into our schema + persistence
- Assemble Phases 2–5 output into the exact `Site > Version > Page > Section > Row > Column` JSON shape defined above.
- Deduplicate repeated structural blocks (Header, Footer, ProductCard pattern) across pages into `SharedInstance`s referenced by id; page-unique blocks stay inline.
- Persist as a new **draft Version**, branched from current `published` (or as the initial version if none exists). Support multiple concurrent drafts per site (branch model, not a single draft flag) — see data model above.
- Every field that could not be confidently filled must be present in output with `status: "needs_review"` and a human-readable reason — build a build-report view/endpoint that lists all needs_review fields for a Version so a human can triage in one place before publish.

### Phase 7 — Review/edit loop
- The existing builder UI reads/writes this same schema, so no new editor UI should be needed here — just make sure Phase 6 output validates against the same schema the manual builder writes to, and confirm round-trip (load an AI-generated Version in the existing builder, edit a field, save, reload) works with zero data loss or shape drift.
- Do not build a separate/parallel editor. If schema mismatches are found between what AI outputs and what the manual builder expects, fix the generator's output shape, not the builder.

## Explicit non-goals for this build
- Do not generate arbitrary new section types outside the existing enum.
- Do not attempt to clone/replicate backend business logic (cart, checkout, personalization) — only map to existing endpoints via the capability registry.
- Do not build a new theming engine — reuse the existing Theme token model, just populate it from extracted colors/typography.
- Do not silently "improve" or reinterpret source content — fidelity to source over creativity; if uncertain, flag for review instead of guessing.

## Tech constraints
- Capture: Playwright (Node or Python — pick one and use consistently across the project).
- Classification/extraction: LLM calls via the Anthropic API, structured/JSON output only, with the enum passed explicitly in every prompt (never rely on the model "knowing" our enum from training).
- Storage: whatever we're already using for the builder's data (confirm before assuming a new DB) — Version/Page/Section/Row/Column should be relational or document-based matching the existing builder's persistence, not a new parallel store.
- All LLM-derived fields must carry `{ source: "ai" | "manual", confidence?, status }` metadata alongside the value so the UI can visually distinguish AI-filled vs human-edited vs needs-review fields without extra lookups.

## Deliverables for check-in after each phase
1. Phase 1: working capture CLI/script — `capture(url) -> PageCapture JSON + screenshots`, tested against 3 real sites.
2. Phase 2: classification function with the golden-set test suite, precision/recall reported per section type.
3. Phase 3: row/column decomposition tested against the Header/ProductCard examples above, output diffed against manually-built equivalents in our builder.
4. Phase 4: list-bound extraction tested against a real slideshow/gallery.
5. Phase 5: endpoint binding + gap report, tested against a mock capability registry.
6. Phase 6: full end-to-end — one real URL in, one draft Version out, loadable in the existing builder.
7. Phase 7: round-trip verification report.

Do not skip ahead to Phase 6 before 1–5 are individually working and tested — each phase's output is the next phase's input, and debugging a broken end-to-end pipeline without isolated phase tests will be much slower than testing incrementally.

Ask clarifying questions before starting if: the exact placeholder enums per section type aren't available, the capability registry format isn't defined, or the existing builder's persistence layer/schema isn't accessible for reference.
