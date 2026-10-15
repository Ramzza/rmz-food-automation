# Architecture

## Overview

The application is a local TypeScript web app. The browser owns catalogue entries, recipes, pantry data, the generated menu, and shopping list. The planner and nutrition aggregation are pure functions in `src/domain.ts`, which keeps business rules testable without network access.

The Express server serves the built UI and exposes one photo-analysis endpoint. It binds to `127.0.0.1`, accepts images in memory only, and forwards them to the fixed local Ollama API at `http://127.0.0.1:11434/api/chat`. It has no cloud AI integration, database, or photo storage. `OLLAMA_VISION_MODEL` selects the local vision model.

## Data flow

1. The user imports or edits catalogue and recipe JSON in the browser. Catalogue entries must include official Lidl product, current catalogue, and Târgu Mureș store URLs plus valid dates.
2. The planner selects recipes only when every ingredient maps to a current catalogue entry; nutrition values and their source links are shown with the menu.
3. The shopping-list function totals recipe quantities, subtracts user-confirmed pantry quantities, and preserves source links.
4. The user may upload a fridge photo. Ollama returns names only; the user maps and confirms products and quantities before the pantry is updated.
5. CSV is generated in the browser and downloaded locally.

## Trust boundaries and limitations

- Catalogue links, nutrition data, and recipes are user-maintained; the application does not scrape Lidl or claim store inventory.
- A valid Lidl URL is provenance evidence entered by the user, not independent confirmation that a product is currently stocked.
- Nutrition values are estimates with visible source URLs. EFSA and WHO links provide guidance, not individualized dietary prescriptions.
- Vision output may be wrong. It never updates inventory or removes shopping items without user confirmation.
- Browser data stays in local storage. Photo bytes are held in memory for the Ollama request and are not written to disk by the app.
