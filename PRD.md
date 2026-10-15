# Product requirements

## Product scope

A local-first meal-planning and shopping assistant for two adults and an 18-month-old child. It plans from a user-maintained recipe library and Lidl Târgu Mureș catalogue entries; it must not invent current offers, stock status, or nutrition data. Catalogue and recipe data are imported or entered by the user and remain in that browser.

For this MVP, menu generation selects and rotates user-curated recipes by meal slot. It does not invent recipes, scrape Lidl, or medically rank diets; suitability depends on the user's recipe and source data and qualified health guidance.

## Requirements

### PRD-001 — Seven-day family menu

Generate a seven-calendar-day menu with breakfast, lunch, and dinner for two adults and the toddler, plus snack 1 and snack 2 for the toddler only. Each recipe records portions for exactly two adults and one toddler at family meals, or one toddler and no adults at snacks. Every selected recipe must be supported by catalogue items valid on the plan date. Family meals require nutrition data for an adult portion and a toddler portion; snacks must not be assigned to adults.

### PRD-002 — Nutrition and authoritative guidance

Show estimated energy, protein, carbohydrate, fat, fibre, and salt per adult and toddler portion, plus per-person totals across the planned meals only. Do not present these as full-day intake; milk, drinks, and unplanned foods may not be included. Each recipe's nutrition values must include a source URL. Link users to EFSA dietary reference values and WHO complementary-feeding guidance for ages 6–23 months. Estimates are informational, not individualized advice or targets.

### PRD-003 — Lidl Târgu Mureș provenance

Every planned ingredient must resolve to a user-confirmed Lidl product link, current official Lidl catalogue link, Târgu Mureș store link, catalogue date range, and matching unit. Reject non-Lidl or malformed provenance and do not use entries outside their catalogue dates. A catalogue listing is not a guarantee of in-store stock.

### PRD-004 — Shopping list

Aggregate ingredient quantities across all 35 meals, subtract confirmed pantry/fridge quantities in matching units, and retain product and catalogue links on each remaining item.

### PRD-005 — Local fridge-photo recognition

Offer an image upload that sends the image only to Ollama at `127.0.0.1`; use a configurable local vision model (default `qwen2.5vl:3b`). Return candidate food names only. Require the user to match and confirm each item and quantity before it affects the pantry or shopping list. Do not save or forward the image.

### PRD-006 — Google Sheets CSV

Export the shopping list as UTF-8, comma-separated CSV with escaped fields and product/catalogue links so it can be imported into Google Sheets.

### PRD-007 — Toddler and privacy safeguards

Exclude recipes not explicitly marked as reviewed for toddler suitability. Show a clear warning to check allergies, choking hazards, food texture, and the child's individual needs with a qualified health professional. Store recipe/catalogue/pantry data only in browser local storage; the local server must bind to loopback and must not persist photos.

## Verification

| Requirement | Automated verification |
|---|---|
| PRD-001 | `tests/domain.test.ts` and `src/main.test.ts`: seven days, five ordered slots, two adult meal portions, toddler-only snacks, recipe rotation, and browser rendering |
| PRD-002 | `tests/domain.test.ts` and `src/main.test.ts`: per-person nutrition totals, official-source validation/references, and visible estimates |
| PRD-003 | `tests/domain.test.ts`: Lidl/product/catalogue/store URL checks, catalogue-date checks, and source links |
| PRD-004 | `tests/domain.test.ts` and `src/main.test.ts`: quantity aggregation, pantry subtraction, unit validation, and linked shopping items |
| PRD-005 | `src/vision.test.ts`, `server.test.ts`, and `src/main.test.ts`: Ollama loopback request/response, image validation, and user-reviewed suggestions |
| PRD-006 | `tests/domain.test.ts` and `src/main.test.ts`: CSV escaping, formula-safe text, line endings, and browser download |
| PRD-007 | `tests/domain.test.ts`, `server.test.ts`, and `src/main.test.ts`: toddler review, in-memory image handling, and explicit confirmation |

`npm test` runs all mapped tests in CI. `npm run typecheck` and `npm run build` are also required checks.

## Official references

- EFSA Dietary Reference Values: <https://multimedia.efsa.europa.eu/drvs/index.htm>
- EFSA DRV summary report: <https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf>
- WHO complementary-feeding guideline (6–23 months): <https://www.who.int/publications/i/item/9789240081864>
- USDA FoodData Central (food composition data): <https://fdc.nal.usda.gov/>
- Lidl Romania online catalogues: <https://www.lidl.ro/c/cataloage-online/s10019911>
- Lidl Târgu Mureș, Strada Livezeni 6: <https://www.lidl.ro/s/ro-RO/cautare-magazin/targu-mures/strada-livezeni-6/>
