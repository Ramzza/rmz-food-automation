# Architecture

## Overview

The app uses the Next.js App Router with React, TypeScript, and Tailwind CSS. Pages and route handlers live under `src/app`; the interactive planner is a React client component in `src/components/meal-planner.tsx`. Pure planning and nutrition rules stay in `src/domain.ts` so they can be tested without network access.

The browser owns catalogue entries, recipes, pantry data, the generated menu, and shopping list. The `/api/fridge` Next.js route accepts photos in memory and forwards them only to the fixed local Ollama API at `http://127.0.0.1:11434/api/chat`. It does not store photos or add a cloud AI integration. `OLLAMA_VISION_MODEL` selects the local vision model.

Tailwind CSS is loaded through the PostCSS plugin in `postcss.config.mjs`; global app styles are in `src/app/globals.css` and `src/style.css`. The current interface uses native, accessible HTML controls, so it does not need an additional component library.

## Data flow

1. The user imports or edits catalogue and recipe JSON in the browser. Catalogue entries must include official Lidl product, current catalogue, and Târgu Mureș store URLs plus valid dates.
2. The planner selects recipes only when every ingredient maps to a current catalogue entry; nutrition values and their source links are shown with the menu.
3. The shopping-list function totals recipe quantities, subtracts user-confirmed pantry quantities, and preserves source links.
4. The user may upload a fridge photo. Ollama returns names only; the user maps and confirms products and quantities before the pantry is updated.
5. CSV is generated in the browser and downloaded locally.

## Trust boundaries and limitations

- The development and production Next.js servers bind to `127.0.0.1`; the app is intended for local use.
- Catalogue links, nutrition data, and recipes are user-maintained; the application does not scrape Lidl or claim store inventory.
- A valid Lidl URL is provenance evidence entered by the user, not independent confirmation that a product is currently stocked.
- Nutrition values are estimates with visible source URLs. EFSA and WHO links provide guidance, not individualized dietary prescriptions.
- Vision output may be wrong. It never updates inventory or removes shopping items without user confirmation.
- Browser data stays in local storage. Photo bytes are held in memory for the Ollama request and are not written to disk by the app.
- Tests live under `tests/src` and mirror the application source structure.
