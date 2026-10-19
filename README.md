# rmz-food-automation

Local-first weekly meal planning and shopping-list assistant for two adults and an 18-month-old child.

## What it does

- Builds seven days of breakfast, lunch, and dinner for the family, plus two toddler-only snacks per day.
- Shows estimated nutrition per adult/toddler portion and daily totals, with official EFSA and WHO guidance links.
- Requires every ingredient to be linked to a user-confirmed Lidl product and current Lidl catalogue entry for Târgu Mureș.
- Totals a shopping list, subtracts confirmed pantry quantities, and exports a Google Sheets-compatible CSV.
- Can suggest foods from a fridge photo using a local Ollama vision model. Suggestions must be reviewed before they change the pantry.

## Local setup

Requirements: Node.js 22+, npm, and Ollama 0.7.0+ for photo recognition.

### Install Ollama

Install Ollama from a terminal before continuing:

**Windows (PowerShell):**

```powershell
irm https://ollama.com/install.ps1 | iex
```

**Ubuntu (Terminal):**

```sh
curl -fsSL https://ollama.com/install.sh | sh
```

On Windows, open a new terminal after installation. The `ollama --version` command below verifies the CLI is available. See Ollama's [Windows](https://docs.ollama.com/windows) and [Linux](https://docs.ollama.com/linux) documentation for system requirements and troubleshooting.

```sh
npm ci
cp .env.example .env
ollama --version
ollama pull qwen2.5vl:3b
npm run dev
```

Open the local Vite URL printed by npm. The API listens only on `127.0.0.1:3001`; Vite proxies photo requests to it. Set `OLLAMA_VISION_MODEL` to use another locally installed Ollama vision model.

The default model is [Qwen2.5-VL 3B in the Ollama library](https://ollama.com/library/qwen2.5vl:3b), using the `qwen2.5vl:3b` tag.

### Model license and deployment requirements

- **Ollama/runtime:** This tag requires Ollama 0.7.0 or newer. The Ollama listing reports a Q4_K_M model with 3.75B parameters and a 3.2 GB download. That is the download size, not a RAM/VRAM minimum; the listing does not specify a minimum. Actual memory use depends on available CPU/GPU resources and workload. Ollama's default context is 4,096 tokens; larger contexts and higher-resolution images can need more resources. See the [Ollama FAQ](https://docs.ollama.com/faq) and [hardware support](https://docs.ollama.com/gpu).
- **License discrepancy:** The Ollama listing labels its packaged license Apache-2.0, while [Qwen's official model card](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct) identifies the license as `qwen-research` and provides a [Qwen Research License Agreement](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE). That agreement permits use only for non-commercial purposes; commercial use requires a separate license from Alibaba Cloud. These published terms conflict, so do not rely on the Ollama label alone: obtain written licensing clarification before redistributing the model or deploying it commercially.
- **Qwen agreement obligations:** If redistributing under the Qwen agreement, provide recipients with a copy of the agreement, mark modified files, and include its required attribution in a `Notice` file: “Qwen is licensed under the Qwen RESEARCH LICENSE AGREEMENT, Copyright (c) Alibaba Cloud. All Rights Reserved.” The agreement also requires “Built with Qwen” or “Improved using Qwen” in documentation when Qwen materials or outputs are used to create, train, fine-tune, or improve a distributed AI model.

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
