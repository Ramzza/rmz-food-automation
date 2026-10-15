import {
  buildShoppingList,
  generateWeeklyMenu,
  matchDetectedFoods,
  parseCatalogItems,
  parseInventoryEntries,
  parseRecipes,
  SOURCE_REFERENCES,
  summarizeNutrition,
  toShoppingCsv,
  type CatalogItem,
  type InventoryEntry,
  type NutrientValues,
  type Recipe,
  type ShoppingLine,
  type WeeklyMenu
} from "./domain.js";

const STORAGE_KEYS = {
  catalog: "rmz-food-automation.catalog.v1",
  recipes: "rmz-food-automation.recipes.v1",
  inventory: "rmz-food-automation.inventory.v1"
} as const;

const MEAL_LABELS = {
  breakfast: "Breakfast",
  snack1: "Snack 1 — toddler only",
  lunch: "Lunch",
  snack2: "Snack 2 — toddler only",
  dinner: "Dinner"
} as const;

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Application root element is missing.");
}

root.innerHTML = `
  <main class="shell">
    <header class="hero">
      <p class="eyebrow">LOCAL FAMILY MEAL PLANNER</p>
      <h1>Good food, thoughtfully planned.</h1>
      <p class="intro">A seven-day menu and shopping list for two adults and an 18-month-old, grounded in your current Lidl Târgu Mureș catalogue.</p>
    </header>

    <section class="notice" aria-label="Important nutrition and child-safety information">
      <strong>Food and child-safety note</strong>
      <p>Nutrition figures are estimates, not medical advice or personal targets. Review allergens, choking hazards, food texture, and each recipe with a qualified health professional. Confirm every fridge-photo suggestion before adding it to your pantry.</p>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">01 / YOUR DATA</p>
          <h2>Catalogue, recipes, and pantry</h2>
        </div>
        <label class="date-field" for="plan-start-date">
          Menu start date
          <input id="plan-start-date" type="date" />
        </label>
      </div>
      <p class="muted">Paste JSON arrays. The app keeps these in this browser only. Catalogue entries need official Lidl product, catalogue, and Târgu Mureș store links with dates. Recipe quantities are for the declared household portions.</p>
      <div class="data-grid">
        <label class="data-field" for="catalog-data">
          <span>Catalogue products</span>
          <textarea id="catalog-data" rows="9" spellcheck="false">[]</textarea>
        </label>
        <label class="data-field" for="recipe-data">
          <span>Recipes</span>
          <textarea id="recipe-data" rows="9" spellcheck="false">[]</textarea>
        </label>
        <label class="data-field" for="inventory-data">
          <span>Pantry / confirmed fridge items</span>
          <textarea id="inventory-data" rows="9" spellcheck="false">[]</textarea>
        </label>
      </div>
      <div class="actions">
        <button id="save-data" class="button button-secondary" type="button">Save data locally</button>
        <button id="generate-menu" class="button button-primary" type="button">Generate this week</button>
      </div>
      <p id="status" class="status" role="status" aria-live="polite">Add your sourced catalogue and recipe data to get started.</p>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">02 / YOUR WEEK</p>
          <h2>Family menu and nutrition estimates</h2>
        </div>
      </div>
      <div id="menu-output" class="empty-state">Your seven-day menu will appear here.</div>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">03 / WHAT'S IN THE FRIDGE?</p>
          <h2>Check a fridge photo</h2>
        </div>
        <span class="local-badge">LOCAL MODEL</span>
      </div>
      <p class="muted">The photo is sent to Ollama on this computer only. The model suggests names, not quantities. Match each suggestion to a catalogue item and confirm its amount before it changes your list.</p>
      <div class="upload-row">
        <label class="file-field" for="fridge-photo">
          <span>Choose a JPEG, PNG, or WebP photo (max 5 MB)</span>
          <input id="fridge-photo" type="file" accept="image/jpeg,image/png,image/webp" />
        </label>
        <button id="analyze-photo" class="button button-secondary" type="button">Recognize food locally</button>
      </div>
      <div id="fridge-suggestions" class="suggestions empty-state">No photo suggestions yet.</div>
      <button id="confirm-fridge-items" class="button button-secondary" type="button" disabled>Confirm selected pantry items</button>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">04 / READY TO SHOP</p>
          <h2>Shopping list</h2>
        </div>
        <button id="export-csv" class="button button-primary" type="button" disabled>Download CSV for Sheets</button>
      </div>
      <div id="shopping-output" class="empty-state">Generate a menu to calculate your shopping list.</div>
    </section>

    <footer class="footer">
      <h2>Nutrition references</h2>
      <p>Use these official sources when entering nutrient values and reviewing age-appropriate guidance.</p>
      <ul id="source-list"></ul>
      <p class="fine-print">Catalogue listings are not a guarantee of store stock. The app does not scrape Lidl or send recipe, pantry, or photo data to a cloud service.</p>
    </footer>
  </main>
`;

let currentMenu: WeeklyMenu | null = null;

initializeFields();
renderSources();
element<HTMLButtonElement>("#save-data").addEventListener("click", saveData);
element<HTMLButtonElement>("#generate-menu").addEventListener("click", generateMenu);
element<HTMLButtonElement>("#analyze-photo").addEventListener("click", analyzePhoto);
element<HTMLButtonElement>("#confirm-fridge-items").addEventListener("click", confirmFridgeItems);
element<HTMLButtonElement>("#export-csv").addEventListener("click", exportCsv);
for (const selector of ["#catalog-data", "#recipe-data", "#inventory-data"]) {
  element<HTMLTextAreaElement>(selector).addEventListener("input", invalidateMenu);
}
element<HTMLInputElement>("#plan-start-date").addEventListener("change", invalidateMenu);

function initializeFields(): void {
  const fields = [
    { selector: "#catalog-data", key: STORAGE_KEYS.catalog },
    { selector: "#recipe-data", key: STORAGE_KEYS.recipes },
    { selector: "#inventory-data", key: STORAGE_KEYS.inventory }
  ];
  try {
    for (const field of fields) {
      const stored = localStorage.getItem(field.key);
      if (stored !== null) {
        element<HTMLTextAreaElement>(field.selector).value = stored;
      }
    }
  } catch (error) {
    setStatus(`Could not load browser-local data: ${errorMessage(error)}`, true);
  }
  element<HTMLInputElement>("#plan-start-date").value = localDateString();
}

function readData(): {
  catalog: CatalogItem[];
  recipes: Recipe[];
  inventory: InventoryEntry[];
} {
  return {
    catalog: parseCatalogItems(readJsonField("#catalog-data", "Catalogue")),
    recipes: parseRecipes(readJsonField("#recipe-data", "Recipe")),
    inventory: parseInventoryEntries(readJsonField("#inventory-data", "Pantry"))
  };
}

function readJsonField(selector: string, label: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(element<HTMLTextAreaElement>(selector).value) as unknown;
  } catch (error) {
    const reason = errorMessage(error);
    throw new Error(`${label} data must be valid JSON: ${reason}`);
  }
  return parsed;
}

function saveData(): void {
  invalidateMenu();
  try {
    const data = readData();
    persistData(data);
    setStatus("Catalogue, recipes, and pantry saved in this browser.");
  } catch (error) {
    setStatus(errorMessage(error), true);
  }
}

function invalidateMenu(): void {
  currentMenu = null;
  element<HTMLDivElement>("#menu-output").textContent =
    "Data changed. Generate the menu again to refresh your plan.";
  renderShoppingList([], []);
}

function generateMenu(): void {
  invalidateMenu();

  try {
    const data = readData();
    persistData(data);
    const startDate = element<HTMLInputElement>("#plan-start-date").value;
    const menu = generateWeeklyMenu({
      recipes: data.recipes,
      catalog: data.catalog,
      startDate
    });
    currentMenu = menu;
    renderMenu(menu, data.catalog);
    renderShoppingList(data.catalog, data.inventory);
    setStatus("Seven days planned using current, linked Lidl catalogue entries.");
  } catch (error) {
    element<HTMLDivElement>("#menu-output").textContent = errorMessage(error);
    setStatus(errorMessage(error), true);
  }
}

async function analyzePhoto(): Promise<void> {
  const photo = element<HTMLInputElement>("#fridge-photo").files?.[0];
  if (!photo) {
    setStatus("Choose a fridge photo before starting recognition.", true);
  } else {
    const button = element<HTMLButtonElement>("#analyze-photo");
    button.disabled = true;
    setStatus("Sending the image to your local Ollama model…");
    try {
      const formData = new FormData();
      formData.append("image", photo);
      const response = await fetch("/api/fridge", { method: "POST", body: formData });
      const body: unknown = await response.json();
      if (!response.ok) {
        const reason = isRecord(body) && typeof body.error === "string" ? body.error : response.statusText;
        throw new Error(reason || `Local recognition failed with HTTP ${response.status}.`);
      }
      const names = readDetectedNames(body);
      const data = readData();
      const suggestions = matchDetectedFoods(names, data.catalog);
      renderFridgeSuggestions(suggestions, data.catalog);
      setStatus(
        `${suggestions.length} suggestion(s) returned. Review matches and quantities before confirming.`
      );
    } catch (error) {
      setStatus(errorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  }
}

function readDetectedNames(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Local vision API returned an invalid response.");
  }
  const names: string[] = [];
  for (const item of value.items) {
    if (typeof item !== "string") {
      throw new Error("Local vision API returned an invalid food name.");
    }
    names.push(item);
  }
  return names;
}

function renderFridgeSuggestions(
  suggestions: Array<{ detectedName: string; productId: string | null }>,
  catalog: CatalogItem[]
): void {
  const container = element<HTMLDivElement>("#fridge-suggestions");
  const confirmButton = element<HTMLButtonElement>("#confirm-fridge-items");
  container.replaceChildren();
  confirmButton.disabled = suggestions.length === 0;
  if (suggestions.length === 0) {
    container.textContent = "No foods were recognized. You can update pantry JSON manually.";
  } else {
    for (const [index, suggestion] of suggestions.entries()) {
      const row = document.createElement("div");
      row.className = "suggestion-row";
      row.dataset.index = String(index);

      const checkboxLabel = document.createElement("label");
      checkboxLabel.className = "check-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("aria-label", `Confirm ${suggestion.detectedName}`);
      checkboxLabel.append(checkbox, document.createTextNode(" Confirm"));

      const detected = document.createElement("strong");
      detected.textContent = suggestion.detectedName;

      const select = document.createElement("select");
      select.setAttribute("aria-label", `Catalogue product for ${suggestion.detectedName}`);
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Choose catalogue item";
      select.append(blank);
      for (const item of catalog) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.name} (${item.unit})`;
        if (item.id === suggestion.productId) {
          option.selected = true;
        }
        select.append(option);
      }

      const quantityLabel = document.createElement("label");
      quantityLabel.className = "quantity-field";
      quantityLabel.textContent = "Amount on hand";
      const quantity = document.createElement("input");
      quantity.type = "number";
      quantity.min = "0.001";
      quantity.step = "any";
      quantity.value = "1";
      quantity.setAttribute("aria-label", `Amount of ${suggestion.detectedName} on hand`);
      quantityLabel.append(quantity);

      row.append(checkboxLabel, detected, select, quantityLabel);
      container.append(row);
    }
  }
}

function confirmFridgeItems(): void {
  try {
    const data = readData();
    const rows = element<HTMLDivElement>("#fridge-suggestions").querySelectorAll(".suggestion-row");
    const additions: InventoryEntry[] = [];
    for (const row of rows) {
      const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const select = row.querySelector<HTMLSelectElement>("select");
      const quantityField = row.querySelector<HTMLInputElement>('input[type="number"]');
      if (!checkbox || !select || !quantityField) {
        throw new Error("Fridge suggestion controls are missing.");
      }
      if (checkbox.checked) {
        const item = data.catalog.find((catalogItem) => catalogItem.id === select.value);
        const quantity = Number(quantityField.value);
        if (!item) {
          throw new Error("Choose a catalogue product for every confirmed fridge item.");
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(`Enter a positive amount for ${item.name}.`);
        }
        additions.push({ productId: item.id, quantity, unit: item.unit });
      }
    }

    const merged = new Map<string, InventoryEntry>();
    for (const entry of data.inventory) {
      const previous = merged.get(entry.productId);
      merged.set(entry.productId, {
        ...entry,
        quantity: entry.quantity + (previous?.quantity ?? 0)
      });
    }
    for (const entry of additions) {
      const previous = merged.get(entry.productId);
      if (previous && previous.unit !== entry.unit) {
        throw new Error(`Pantry units do not match for ${entry.productId}.`);
      }
      merged.set(entry.productId, {
        ...entry,
        quantity: entry.quantity + (previous?.quantity ?? 0)
      });
    }
    data.inventory = [...merged.values()];
    element<HTMLTextAreaElement>("#inventory-data").value = JSON.stringify(data.inventory, null, 2);
    persistData(data);
    if (currentMenu) {
      renderShoppingList(data.catalog, data.inventory);
    }
    setStatus(
      additions.length > 0
        ? `${additions.length} confirmed item(s) added to the pantry and shopping list updated.`
        : "No fridge items were selected."
    );
  } catch (error) {
    setStatus(errorMessage(error), true);
  }
}

function renderMenu(menu: WeeklyMenu, catalog: CatalogItem[]): void {
  const container = element<HTMLDivElement>("#menu-output");
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  container.replaceChildren();

  for (const day of menu.days) {
    const dayCard = document.createElement("article");
    dayCard.className = "day-card";
    const heading = document.createElement("h3");
    heading.textContent = formatDate(day.date);
    dayCard.append(heading);

    for (const meal of day.meals) {
      const mealCard = document.createElement("section");
      mealCard.className = "meal-card";
      const mealHeading = document.createElement("h4");
      mealHeading.textContent = `${MEAL_LABELS[meal.slot]}: ${meal.recipe.name}`;
      mealCard.append(mealHeading);

      if (meal.recipe.nutrition.adult) {
        const adultNutrition = document.createElement("p");
        adultNutrition.className = "nutrition-line";
        adultNutrition.textContent = `Per adult portion: ${formatNutrients(meal.recipe.nutrition.adult)}`;
        mealCard.append(adultNutrition);
      }
      const toddlerNutrition = document.createElement("p");
      toddlerNutrition.className = "nutrition-line";
      toddlerNutrition.textContent = `Per toddler portion: ${formatNutrients(meal.recipe.nutrition.toddler)}`;
      mealCard.append(toddlerNutrition);

      const source = createLink(meal.recipe.nutritionSourceUrl, "Nutrition source");
      mealCard.append(source);
      const ingredientList = document.createElement("ul");
      ingredientList.className = "ingredient-links";
      for (const ingredient of meal.recipe.ingredients) {
        const item = catalogById.get(ingredient.productId);
        if (!item) {
          throw new Error(`Missing catalogue product "${ingredient.productId}" while displaying menu.`);
        }
        const listItem = document.createElement("li");
        listItem.append(
          createLink(item.productUrl, `${item.name} — ${ingredient.quantity} ${ingredient.unit}`),
          document.createTextNode(" · "),
          createLink(item.catalogUrl, "catalogue")
        );
        ingredientList.append(listItem);
      }
      mealCard.append(ingredientList);
      dayCard.append(mealCard);
    }

    const totals = summarizeNutrition(day);
    const summary = document.createElement("p");
    summary.className = "daily-summary";
    summary.textContent = `Planned-meal totals (not full-day intake) — per adult: ${formatNutrients(totals.perAdult)} · toddler: ${formatNutrients(totals.perToddler)}`;
    dayCard.append(summary);
    container.append(dayCard);
  }
}

function renderShoppingList(catalog: CatalogItem[], inventory: InventoryEntry[]): void {
  const container = element<HTMLDivElement>("#shopping-output");
  const exportButton = element<HTMLButtonElement>("#export-csv");
  if (!currentMenu) {
    container.textContent = "Generate a menu to calculate your shopping list.";
    exportButton.disabled = true;
  } else {
    const lines = buildShoppingList(currentMenu, catalog, inventory);
    container.replaceChildren();
    exportButton.disabled = lines.length === 0;
    if (lines.length === 0) {
      container.textContent = "Nothing to buy based on the confirmed pantry quantities.";
    } else {
      const list = document.createElement("ul");
      list.className = "shopping-items";
      for (const line of lines) {
        const item = document.createElement("li");
        item.append(
          document.createTextNode(`${formatQuantity(line.quantity)} ${line.unit} `),
          createLink(line.productUrl, line.productName),
          document.createTextNode(" · "),
          createLink(line.catalogUrl, "catalogue")
        );
        list.append(item);
      }
      container.append(list);
    }
  }
}

function exportCsv(): void {
  try {
    if (!currentMenu) {
      throw new Error("Generate a menu before exporting a shopping list.");
    }
    const data = readData();
    const shoppingList: ShoppingLine[] = buildShoppingList(
      currentMenu,
      data.catalog,
      data.inventory
    );
    const csv = toShoppingCsv(shoppingList);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `shopping-list-${currentMenu.startDate}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setStatus("Shopping list CSV downloaded.");
  } catch (error) {
    setStatus(errorMessage(error), true);
  }
}

function persistData(data: {
  catalog: CatalogItem[];
  recipes: Recipe[];
  inventory: InventoryEntry[];
}): void {
  const catalogJson = JSON.stringify(data.catalog, null, 2);
  const recipesJson = JSON.stringify(data.recipes, null, 2);
  const inventoryJson = JSON.stringify(data.inventory, null, 2);
  localStorage.setItem(STORAGE_KEYS.catalog, catalogJson);
  localStorage.setItem(STORAGE_KEYS.recipes, recipesJson);
  localStorage.setItem(STORAGE_KEYS.inventory, inventoryJson);
  element<HTMLTextAreaElement>("#catalog-data").value = catalogJson;
  element<HTMLTextAreaElement>("#recipe-data").value = recipesJson;
  element<HTMLTextAreaElement>("#inventory-data").value = inventoryJson;
}

function renderSources(): void {
  const list = element<HTMLUListElement>("#source-list");
  for (const source of SOURCE_REFERENCES) {
    const item = document.createElement("li");
    item.append(createLink(source.url, source.name));
    list.append(item);
  }
}

function formatNutrients(values: NutrientValues): string {
  const number = (value: number) => value.toLocaleString("en", { maximumFractionDigits: 1 });
  return `${number(values.energyKcal)} kcal · protein ${number(values.proteinGrams)} g · carbohydrate ${number(values.carbohydrateGrams)} g · fat ${number(values.fatGrams)} g · fibre ${number(values.fiberGrams)} g · salt ${number(values.saltGrams)} g`;
}

function formatQuantity(value: number): string {
  return value.toLocaleString("en", { maximumFractionDigits: 3 });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function localDateString(): string {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 10);
}

function createLink(url: string, label: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = url;
  link.textContent = label;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Required page element is missing: ${selector}`);
  }
  return node;
}

function setStatus(message: string, isError = false): void {
  const status = element<HTMLParagraphElement>("#status");
  status.textContent = message;
  status.classList.toggle("status-error", isError);
}

function errorMessage(error: unknown): string {
  let message = "An unexpected error occurred.";
  if (error instanceof Error) {
    message = error.message;
  }
  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
