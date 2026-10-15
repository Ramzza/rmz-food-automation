"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
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
} from "../domain";

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

type PlannerData = {
  catalog: CatalogItem[];
  recipes: Recipe[];
  inventory: InventoryEntry[];
};

type FridgeSuggestion = {
  detectedName: string;
  productId: string;
  selected: boolean;
  quantity: string;
};

export default function MealPlanner() {
  const [catalogText, setCatalogText] = useState("[]");
  const [recipeText, setRecipeText] = useState("[]");
  const [inventoryText, setInventoryText] = useState("[]");
  const [startDate, setStartDate] = useState("");
  const [status, setStatus] = useState({
    message: "Add your sourced catalogue and recipe data to get started.",
    isError: false
  });
  const [menuMessage, setMenuMessage] = useState("Your seven-day menu will appear here.");
  const [menu, setMenu] = useState<WeeklyMenu | null>(null);
  const [plannedData, setPlannedData] = useState<PlannerData | null>(null);
  const [shoppingLines, setShoppingLines] = useState<ShoppingLine[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<FridgeSuggestion[]>([]);
  const [suggestionCatalog, setSuggestionCatalog] = useState<CatalogItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    try {
      const storedCatalog = localStorage.getItem(STORAGE_KEYS.catalog);
      const storedRecipes = localStorage.getItem(STORAGE_KEYS.recipes);
      const storedInventory = localStorage.getItem(STORAGE_KEYS.inventory);
      if (storedCatalog !== null) {
        setCatalogText(storedCatalog);
      }
      if (storedRecipes !== null) {
        setRecipeText(storedRecipes);
      }
      if (storedInventory !== null) {
        setInventoryText(storedInventory);
      }
    } catch (error) {
      setStatus({
        message: `Could not load browser-local data: ${errorMessage(error)}`,
        isError: true
      });
    }
    setStartDate(localDateString());
  }, []);

  function updateStatus(message: string, isError = false): void {
    setStatus({ message, isError });
  }

  function readData(): PlannerData {
    return {
      catalog: parseCatalogItems(readJsonField(catalogText, "Catalogue")),
      recipes: parseRecipes(readJsonField(recipeText, "Recipe")),
      inventory: parseInventoryEntries(readJsonField(inventoryText, "Pantry"))
    };
  }

  function persistData(data: PlannerData): void {
    const catalogJson = JSON.stringify(data.catalog, null, 2);
    const recipesJson = JSON.stringify(data.recipes, null, 2);
    const inventoryJson = JSON.stringify(data.inventory, null, 2);
    localStorage.setItem(STORAGE_KEYS.catalog, catalogJson);
    localStorage.setItem(STORAGE_KEYS.recipes, recipesJson);
    localStorage.setItem(STORAGE_KEYS.inventory, inventoryJson);
    setCatalogText(catalogJson);
    setRecipeText(recipesJson);
    setInventoryText(inventoryJson);
  }

  function invalidateMenu(): void {
    setMenu(null);
    setPlannedData(null);
    setShoppingLines([]);
    setMenuMessage("Data changed. Generate the menu again to refresh your plan.");
  }

  function saveData(): void {
    invalidateMenu();
    try {
      const data = readData();
      persistData(data);
      updateStatus("Catalogue, recipes, and pantry saved in this browser.");
    } catch (error) {
      updateStatus(errorMessage(error), true);
    }
  }

  function generateMenu(): void {
    invalidateMenu();
    try {
      const data = readData();
      persistData(data);
      const nextMenu = generateWeeklyMenu({
        recipes: data.recipes,
        catalog: data.catalog,
        startDate
      });
      const lines = buildShoppingList(nextMenu, data.catalog, data.inventory);
      setMenu(nextMenu);
      setPlannedData(data);
      setShoppingLines(lines);
      setMenuMessage("");
      updateStatus("Seven days planned using current, linked Lidl catalogue entries.");
    } catch (error) {
      const message = errorMessage(error);
      setMenuMessage(message);
      updateStatus(message, true);
    }
  }

  async function analyzePhoto(): Promise<void> {
    if (!photo) {
      updateStatus("Choose a fridge photo before starting recognition.", true);
    } else {
      setIsAnalyzing(true);
      updateStatus("Sending the image to your local Ollama model…");
      try {
        const formData = new FormData();
        formData.append("image", photo);
        const response = await fetch("/api/fridge", { method: "POST", body: formData });
        const body: unknown = await response.json();
        if (!response.ok) {
          const reason =
            isRecord(body) && typeof body.error === "string" ? body.error : response.statusText;
          throw new Error(reason || `Local recognition failed with HTTP ${response.status}.`);
        }
        const names = readDetectedNames(body);
        const data = readData();
        const matches = matchDetectedFoods(names, data.catalog);
        setSuggestionCatalog(data.catalog);
        setSuggestions(
          matches.map((match) => ({
            detectedName: match.detectedName,
            productId: match.productId ?? "",
            selected: false,
            quantity: "1"
          }))
        );
        updateStatus(
          `${matches.length} suggestion(s) returned. Review matches and quantities before confirming.`
        );
      } catch (error) {
        updateStatus(errorMessage(error), true);
      } finally {
        setIsAnalyzing(false);
      }
    }
  }

  function confirmFridgeItems(): void {
    try {
      const data = readData();
      const additions: InventoryEntry[] = [];
      for (const suggestion of suggestions) {
        if (suggestion.selected) {
          const item = data.catalog.find((catalogItem) => catalogItem.id === suggestion.productId);
          const quantity = Number(suggestion.quantity);
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
      const nextData = { ...data, inventory: [...merged.values()] };
      persistData(nextData);
      if (menu) {
        setPlannedData(nextData);
        setShoppingLines(buildShoppingList(menu, nextData.catalog, nextData.inventory));
      }
      updateStatus(
        additions.length > 0
          ? `${additions.length} confirmed item(s) added to the pantry and shopping list updated.`
          : "No fridge items were selected."
      );
    } catch (error) {
      updateStatus(errorMessage(error), true);
    }
  }

  function exportCsv(): void {
    try {
      if (!menu || !plannedData) {
        throw new Error("Generate a menu before exporting a shopping list.");
      }
      const lines = buildShoppingList(menu, plannedData.catalog, plannedData.inventory);
      const csv = toShoppingCsv(lines);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `shopping-list-${menu.startDate}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      updateStatus("Shopping list CSV downloaded.");
    } catch (error) {
      updateStatus(errorMessage(error), true);
    }
  }

  function changeCatalog(event: ChangeEvent<HTMLTextAreaElement>): void {
    setCatalogText(event.currentTarget.value);
    invalidateMenu();
  }

  function changeRecipes(event: ChangeEvent<HTMLTextAreaElement>): void {
    setRecipeText(event.currentTarget.value);
    invalidateMenu();
  }

  function changeInventory(event: ChangeEvent<HTMLTextAreaElement>): void {
    setInventoryText(event.currentTarget.value);
    invalidateMenu();
  }

  function changeStartDate(event: ChangeEvent<HTMLInputElement>): void {
    setStartDate(event.currentTarget.value);
    invalidateMenu();
  }

  function updateSuggestion(
    index: number,
    updates: Partial<Pick<FridgeSuggestion, "productId" | "quantity" | "selected">>
  ): void {
    setSuggestions((current) =>
      current.map((suggestion, suggestionIndex) =>
        suggestionIndex === index ? { ...suggestion, ...updates } : suggestion
      )
    );
  }

  return (
    <main className="shell mx-auto w-full max-w-[1060px] px-4 py-8 sm:py-10">
      <header className="hero">
        <p className="eyebrow">LOCAL FAMILY MEAL PLANNER</p>
        <h1>Good food, thoughtfully planned.</h1>
        <p className="intro">
          A seven-day menu and shopping list for two adults and an 18-month-old, grounded in your
          current Lidl Târgu Mureș catalogue.
        </p>
      </header>

      <section className="notice" aria-label="Important nutrition and child-safety information">
        <strong>Food and child-safety note</strong>
        <p>
          Nutrition figures are estimates, not medical advice or personal targets. Review allergens,
          choking hazards, food texture, and each recipe with a qualified health professional.
          Confirm every fridge-photo suggestion before adding it to your pantry.
        </p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / YOUR DATA</p>
            <h2>Catalogue, recipes, and pantry</h2>
          </div>
          <label className="date-field" htmlFor="plan-start-date">
            Menu start date
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              id="plan-start-date"
              type="date"
              value={startDate}
              onChange={changeStartDate}
            />
          </label>
        </div>
        <p className="muted">
          Paste JSON arrays. The app keeps these in this browser only. Catalogue entries need
          official Lidl product, catalogue, and Târgu Mureș store links with dates. Recipe quantities
          are for the declared household portions.
        </p>
        <div className="data-grid grid gap-4 md:grid-cols-3">
          <label className="data-field" htmlFor="catalog-data">
            <span>Catalogue products</span>
            <textarea
              className="w-full rounded-lg border border-slate-300 bg-white p-3"
              id="catalog-data"
              rows={9}
              spellCheck={false}
              value={catalogText}
              onChange={changeCatalog}
            />
          </label>
          <label className="data-field" htmlFor="recipe-data">
            <span>Recipes</span>
            <textarea
              className="w-full rounded-lg border border-slate-300 bg-white p-3"
              id="recipe-data"
              rows={9}
              spellCheck={false}
              value={recipeText}
              onChange={changeRecipes}
            />
          </label>
          <label className="data-field" htmlFor="inventory-data">
            <span>Pantry / confirmed fridge items</span>
            <textarea
              className="w-full rounded-lg border border-slate-300 bg-white p-3"
              id="inventory-data"
              rows={9}
              spellCheck={false}
              value={inventoryText}
              onChange={changeInventory}
            />
          </label>
        </div>
        <div className="actions">
          <button
            className="button button-secondary rounded-lg px-4 py-2"
            type="button"
            onClick={saveData}
          >
            Save data locally
          </button>
          <button
            className="button button-primary rounded-lg px-4 py-2"
            type="button"
            onClick={generateMenu}
          >
            Generate this week
          </button>
        </div>
        <p className={`status ${status.isError ? "status-error" : ""}`} role="status" aria-live="polite">
          {status.message}
        </p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">02 / YOUR WEEK</p>
            <h2>Family menu and nutrition estimates</h2>
          </div>
        </div>
        {menu ? (
          <div id="menu-output">
            {menu.days.map((day) => {
              const totals = summarizeNutrition(day);
              return (
                <article className="day-card" key={day.date}>
                  <h3>{formatDate(day.date)}</h3>
                  {day.meals.map((meal, mealIndex) => (
                    <section className="meal-card" key={`${meal.slot}-${mealIndex}`}>
                      <h4>
                        {MEAL_LABELS[meal.slot]}: {meal.recipe.name}
                      </h4>
                      {meal.recipe.nutrition.adult ? (
                        <p className="nutrition-line">
                          Per adult portion: {formatNutrients(meal.recipe.nutrition.adult)}
                        </p>
                      ) : null}
                      <p className="nutrition-line">
                        Per toddler portion: {formatNutrients(meal.recipe.nutrition.toddler)}
                      </p>
                      <a
                        href={meal.recipe.nutritionSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Nutrition source
                      </a>
                      <ul className="ingredient-links">
                        {meal.recipe.ingredients.map((ingredient, ingredientIndex) => {
                          const item = plannedData?.catalog.find(
                            (catalogItem) => catalogItem.id === ingredient.productId
                          );
                          if (!item) {
                            throw new Error(
                              `Missing catalogue product "${ingredient.productId}" while displaying menu.`
                            );
                          }
                          return (
                            <li key={`${ingredient.productId}-${ingredientIndex}`}>
                              <a href={item.productUrl} target="_blank" rel="noopener noreferrer">
                                {item.name} — {ingredient.quantity} {ingredient.unit}
                              </a>
                              {" · "}
                              <a href={item.catalogUrl} target="_blank" rel="noopener noreferrer">
                                catalogue
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                  <p className="daily-summary">
                    Planned-meal totals (not full-day intake) — per adult:{" "}
                    {formatNutrients(totals.perAdult)} · toddler: {formatNutrients(totals.perToddler)}
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state" id="menu-output">
            {menuMessage}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">03 / WHAT&apos;S IN THE FRIDGE?</p>
            <h2>Check a fridge photo</h2>
          </div>
          <span className="local-badge">LOCAL MODEL</span>
        </div>
        <p className="muted">
          The photo is sent to Ollama on this computer only. The model suggests names, not
          quantities. Match each suggestion to a catalogue item and confirm its amount before it
          changes your list.
        </p>
        <div className="upload-row">
          <label className="file-field" htmlFor="fridge-photo">
            <span>Choose a JPEG, PNG, or WebP photo (max 5 MB)</span>
            <input
              id="fridge-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
          <button
            className="button button-secondary rounded-lg px-4 py-2"
            type="button"
            disabled={isAnalyzing}
            onClick={analyzePhoto}
          >
            {isAnalyzing ? "Recognizing…" : "Recognize food locally"}
          </button>
        </div>
        <div id="fridge-suggestions" className="suggestions empty-state">
          {suggestions.length === 0 ? (
            "No photo suggestions yet."
          ) : (
            suggestions.map((suggestion, index) => (
              <div className="suggestion-row" key={`${suggestion.detectedName}-${index}`}>
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label={`Confirm ${suggestion.detectedName}`}
                    checked={suggestion.selected}
                    onChange={(event) => updateSuggestion(index, { selected: event.currentTarget.checked })}
                  />
                  {" Confirm"}
                </label>
                <strong>{suggestion.detectedName}</strong>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  aria-label={`Catalogue product for ${suggestion.detectedName}`}
                  value={suggestion.productId}
                  onChange={(event) => updateSuggestion(index, { productId: event.currentTarget.value })}
                >
                  <option value="">Choose catalogue item</option>
                  {suggestionCatalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.unit})
                    </option>
                  ))}
                </select>
                <label className="quantity-field">
                  Amount on hand
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    type="number"
                    min="0.001"
                    step="any"
                    value={suggestion.quantity}
                    aria-label={`Amount of ${suggestion.detectedName} on hand`}
                    onChange={(event) => updateSuggestion(index, { quantity: event.currentTarget.value })}
                  />
                </label>
              </div>
            ))
          )}
        </div>
        <button
          className="button button-secondary rounded-lg px-4 py-2"
          id="confirm-fridge-items"
          type="button"
          disabled={suggestions.length === 0}
          onClick={confirmFridgeItems}
        >
          Confirm selected pantry items
        </button>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">04 / READY TO SHOP</p>
            <h2>Shopping list</h2>
          </div>
          <button
            className="button button-primary rounded-lg px-4 py-2"
            id="export-csv"
            type="button"
            disabled={!menu || shoppingLines.length === 0}
            onClick={exportCsv}
          >
            Download CSV for Sheets
          </button>
        </div>
        {!menu ? (
          <div className="empty-state" id="shopping-output">
            Generate a menu to calculate your shopping list.
          </div>
        ) : shoppingLines.length === 0 ? (
          <div className="empty-state" id="shopping-output">
            Nothing to buy based on the confirmed pantry quantities.
          </div>
        ) : (
          <ul className="shopping-items" id="shopping-output">
            {shoppingLines.map((line) => (
              <li key={line.productId}>
                {formatQuantity(line.quantity)} {line.unit}{" "}
                <a href={line.productUrl} target="_blank" rel="noopener noreferrer">
                  {line.productName}
                </a>
                {" · "}
                <a href={line.catalogUrl} target="_blank" rel="noopener noreferrer">
                  catalogue
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="footer">
        <h2>Nutrition references</h2>
        <p>Use these official sources when entering nutrient values and reviewing age-appropriate guidance.</p>
        <ul id="source-list">
          {SOURCE_REFERENCES.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.name}
              </a>
            </li>
          ))}
        </ul>
        <p className="fine-print">
          Catalogue listings are not a guarantee of store stock. The app does not scrape Lidl or
          send recipe, pantry, or photo data to a cloud service.
        </p>
      </footer>
    </main>
  );
}

function readJsonField(text: string, label: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} data must be valid JSON: ${errorMessage(error)}`);
  }
  return parsed;
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
