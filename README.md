# rmz-food-automation

Local-first weekly meal planning and shopping-list assistant for two adults and an 18-month-old child.

## Stack

Next.js App Router, React, TypeScript, and Tailwind CSS. The current interface uses native accessible controls, so it does not need an additional component library.

## What it does

- Builds seven days of breakfast, lunch, and dinner for the family, plus two toddler-only snacks per day.
- Shows estimated nutrition per adult/toddler portion and daily totals, with official EFSA and WHO guidance links.
- Requires every ingredient to be linked to a user-confirmed Lidl product and current Lidl catalogue entry for Târgu Mureș.
- Totals a shopping list, subtracts confirmed pantry quantities, and exports a Google Sheets-compatible CSV.
- Can suggest foods from a fridge photo using a local Ollama vision model. Suggestions must be reviewed before they change the pantry.

## Local setup

Requirements: Node.js 22+, npm, and Ollama 0.7.0+ for photo recognition.

```sh
npm ci
cp .env.example .env
ollama --version
ollama pull qwen2.5vl:3b
npm run dev
```

Open <http://127.0.0.1:3000>. Next.js serves both the app and the `/api/fridge` photo endpoint, and binds only to `127.0.0.1`. Set `OLLAMA_VISION_MODEL` to use another locally installed Ollama vision model.

The default model is [Qwen2.5-VL 3B in the Ollama library](https://ollama.com/library/qwen2.5vl:3b). Check the model's license and requirements before redistributing or deploying it.

Recipe, catalogue, and pantry JSON are kept in the current browser's local storage. Add data in the app using the documented schemas. For catalogue items, include a product-specific Lidl URL, the current catalogue URL, the Târgu Mureș store URL, catalogue start/end dates, and the unit used by recipes. Recipes need a matching catalogue product ID for each ingredient, portions (`{ "adults": 2, "toddler": 1 }` for family meals; `{ "adults": 0, "toddler": 1 }` for snacks), and sourced nutrition values for adult and toddler portions. The planner refuses incomplete or unverified data instead of fabricating offers or nutrient values.

The official [Lidl Romania catalogue page](https://www.lidl.ro/c/cataloage-online/s10019911) and a [Lidl Târgu Mureș store page](https://www.lidl.ro/s/ro-RO/cautare-magazin/targu-mures/strada-livezeni-6/) are linked here for user verification. Catalogue listings do not guarantee local stock, and this MVP does not scrape Lidl or check live inventory.

## Data format

Catalogue, recipe, and pantry inputs are JSON arrays:

- **Catalogue item:** `id`, `name`, `ingredientKey`, `unit`, `productUrl`, `catalogUrl`, `storeUrl`, `validFrom`, and `validUntil`. Use the product-specific official Lidl page, the current Lidl catalogue, and an official Târgu Mureș store page. Dates use `YYYY-MM-DD`; the selected menu start date must fall within the catalogue date range.
- **Recipe:** `id`, `name`, `slot` (`breakfast`, `snack1`, `lunch`, `snack2`, or `dinner`), `serves`, `ingredients`, `nutrition`, `nutritionSourceUrl`, and `toddlerSafetyReviewed`. Family meals must declare `serves: { "adults": 2, "toddler": 1 }`; toddler snacks must declare `{ "adults": 0, "toddler": 1 }` and omit adult nutrition. Each ingredient contains `productId`, `quantity`, and the exact catalogue `unit`. Ingredient quantities are for the declared meal portions; nutrition values are per individual adult/toddler portion.
- **Nutrition values:** `energyKcal`, `proteinGrams`, `carbohydrateGrams`, `fatGrams`, `fiberGrams`, and `saltGrams`. Each recipe links its source; accepted sources include Lidl, EFSA, WHO, USDA, and EU domains.
- **Pantry item:** `productId`, `quantity`, and `unit`. Use a confirmed amount in the same unit as the catalogue item.

The planner selects only from this user-curated recipe library and rotates eligible recipes by slot. It checks links, dates, portions, sourced nutrition fields, and toddler-review flags, but it does not verify catalogue page contents or independently assess diet quality. Replace any example or placeholder values with evidence from the official sources before planning.

## Nutrition and child-safety notes

Nutrition totals are estimates from the source attached to each recipe and cover planned meals only; milk, drinks, and unplanned foods may not be included. See the [EFSA Dietary Reference Values](https://multimedia.efsa.europa.eu/drvs/index.htm), [EFSA summary report](https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf), and [WHO complementary-feeding guideline for ages 6–23 months](https://www.who.int/publications/i/item/9789240081864). [USDA FoodData Central](https://fdc.nal.usda.gov/) is an official food-composition data source.

This app does not provide medical advice or individualized nutrient targets. Check allergies, choking hazards, food texture, and the child's needs with a qualified health professional. Vision-model output can be wrong; confirm every item and quantity.

## Development

```sh
npm test
npm run typecheck
npm run build
```

See [PRD.md](PRD.md) for stable requirements and test mappings, and [ARCHITECTURE.md](ARCHITECTURE.md) for data flow and trust boundaries.

Automated tests live under `tests/src`, mirroring the application modules under `src`.
