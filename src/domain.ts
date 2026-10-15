export const MEAL_SLOTS = ["breakfast", "snack1", "lunch", "snack2", "dinner"] as const;

export type MealSlot = (typeof MEAL_SLOTS)[number];

export interface NutrientValues {
  energyKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  fiberGrams: number;
  saltGrams: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  ingredientKey: string;
  unit: string;
  productUrl: string;
  catalogUrl: string;
  storeUrl: string;
  validFrom: string;
  validUntil: string;
}

export interface RecipeIngredient {
  productId: string;
  quantity: number;
  unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  slot: MealSlot;
  serves: {
    adults: number;
    toddler: number;
  };
  ingredients: RecipeIngredient[];
  nutrition: {
    adult?: NutrientValues;
    toddler: NutrientValues;
  };
  nutritionSourceUrl: string;
  toddlerSafetyReviewed: boolean;
}

export interface InventoryEntry {
  productId: string;
  quantity: number;
  unit: string;
}

export interface PlannedMeal {
  slot: MealSlot;
  recipe: Recipe;
}

export interface PlannedDay {
  date: string;
  meals: PlannedMeal[];
}

export interface WeeklyMenu {
  startDate: string;
  days: PlannedDay[];
}

export interface ShoppingLine {
  productId: string;
  productName: string;
  productUrl: string;
  catalogUrl: string;
  quantity: number;
  unit: string;
}

export interface SourceReference {
  id: string;
  name: string;
  url: string;
}

const NUTRIENT_KEYS: Array<keyof NutrientValues> = [
  "energyKcal",
  "proteinGrams",
  "carbohydrateGrams",
  "fatGrams",
  "fiberGrams",
  "saltGrams"
];

const ZERO_NUTRIENTS: NutrientValues = {
  energyKcal: 0,
  proteinGrams: 0,
  carbohydrateGrams: 0,
  fatGrams: 0,
  fiberGrams: 0,
  saltGrams: 0
};

export const SOURCE_REFERENCES: readonly SourceReference[] = [
  {
    id: "efsa-drvs",
    name: "EFSA Dietary Reference Values",
    url: "https://multimedia.efsa.europa.eu/drvs/index.htm"
  },
  {
    id: "who-complementary-feeding",
    name: "WHO complementary-feeding guideline (6–23 months)",
    url: "https://www.who.int/publications/i/item/9789240081864"
  },
  {
    id: "usda-fooddata-central",
    name: "USDA FoodData Central",
    url: "https://fdc.nal.usda.gov/"
  }
];

export function parseCatalogItems(value: unknown): CatalogItem[] {
  if (!Array.isArray(value)) {
    throw new Error("Catalogue data must be a JSON array.");
  }

  const items = value.map((entry, index) => {
    const label = `Catalogue item ${index + 1}`;
    const row = readRecord(entry, label);
    const item: CatalogItem = {
      id: readString(row, "id", label),
      name: readString(row, "name", label),
      ingredientKey: readString(row, "ingredientKey", label),
      unit: readString(row, "unit", label),
      productUrl: readString(row, "productUrl", label),
      catalogUrl: readString(row, "catalogUrl", label),
      storeUrl: readString(row, "storeUrl", label),
      validFrom: readString(row, "validFrom", label),
      validUntil: readString(row, "validUntil", label)
    };
    validateCatalogItem(item);
    return item;
  });

  return items;
}

export function parseRecipes(value: unknown): Recipe[] {
  if (!Array.isArray(value)) {
    throw new Error("Recipe data must be a JSON array.");
  }

  const recipes = value.map((entry, index) => {
    const label = `Recipe ${index + 1}`;
    const row = readRecord(entry, label);
    const slotText = readString(row, "slot", label);
    if (!isMealSlot(slotText)) {
      throw new Error(`${label} has an unknown meal slot.`);
    }

    const rawServes = readRecord(row.serves, `${label} portions`);
    const rawIngredients = row.ingredients;
    if (!Array.isArray(rawIngredients)) {
      throw new Error(`${label} ingredients must be an array.`);
    }
    const ingredients = rawIngredients.map((ingredient, ingredientIndex) => {
      const ingredientLabel = `${label} ingredient ${ingredientIndex + 1}`;
      const ingredientRow = readRecord(ingredient, ingredientLabel);
      return {
        productId: readString(ingredientRow, "productId", ingredientLabel),
        quantity: readPositiveNumber(ingredientRow, "quantity", ingredientLabel),
        unit: readString(ingredientRow, "unit", ingredientLabel)
      };
    });

    const rawNutrition = readRecord(row.nutrition, `${label} nutrition`);
    const recipe: Recipe = {
      id: readString(row, "id", label),
      name: readString(row, "name", label),
      slot: slotText,
      serves: {
        adults: readNonNegativeNumber(rawServes, "adults", `${label} portions`),
        toddler: readNonNegativeNumber(rawServes, "toddler", `${label} portions`)
      },
      ingredients,
      nutrition: {
        ...(rawNutrition.adult === undefined
          ? {}
          : { adult: readNutrients(rawNutrition.adult, `${label} adult nutrition`) }),
        toddler: readNutrients(rawNutrition.toddler, `${label} toddler nutrition`)
      },
      nutritionSourceUrl: readString(row, "nutritionSourceUrl", label),
      toddlerSafetyReviewed: readBoolean(row, "toddlerSafetyReviewed", label)
    };
    validateRecipe(recipe);
    return recipe;
  });

  return recipes;
}

export function parseInventoryEntries(value: unknown): InventoryEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("Pantry data must be a JSON array.");
  }

  const entries = value.map((entry, index) => {
    const label = `Pantry item ${index + 1}`;
    const row = readRecord(entry, label);
    return {
      productId: readString(row, "productId", label),
      quantity: readNonNegativeNumber(row, "quantity", label),
      unit: readString(row, "unit", label)
    };
  });

  return entries;
}

export function generateWeeklyMenu(input: {
  recipes: Recipe[];
  catalog: CatalogItem[];
  startDate: string;
}): WeeklyMenu {
  assertIsoDate(input.startDate, "Plan start date");
  if (!Array.isArray(input.recipes) || input.recipes.length === 0) {
    throw new Error("Add at least one recipe for each required meal slot.");
  }
  if (!Array.isArray(input.catalog)) {
    throw new Error("Catalogue data must be a JSON array.");
  }

  const catalogById = new Map<string, CatalogItem>();
  for (const item of input.catalog) {
    validateCatalogItem(item);
    if (catalogById.has(item.id)) {
      throw new Error(`Duplicate catalogue product ID: ${item.id}.`);
    }
    catalogById.set(item.id, item);
  }

  const recipeIds = new Set<string>();
  for (const recipe of input.recipes) {
    validateRecipe(recipe);
    if (recipeIds.has(recipe.id)) {
      throw new Error(`Duplicate recipe ID: ${recipe.id}.`);
    }
    recipeIds.add(recipe.id);
    for (const ingredient of recipe.ingredients) {
      const item = catalogById.get(ingredient.productId);
      if (!item) {
        throw new Error(
          `Recipe "${recipe.name}" references unknown catalogue product "${ingredient.productId}".`
        );
      }
      if (ingredient.unit !== item.unit) {
        throw new Error(
          `Recipe "${recipe.name}" uses ${ingredient.unit} for "${item.name}", but the catalogue unit is ${item.unit}.`
        );
      }
    }
  }

  const currentProductIds = new Set(
    input.catalog
      .filter((item) => input.startDate >= item.validFrom && input.startDate <= item.validUntil)
      .map((item) => item.id)
  );
  const candidatesBySlot = new Map<MealSlot, Recipe[]>();
  const missingSlots: MealSlot[] = [];

  for (const slot of MEAL_SLOTS) {
    const candidates = input.recipes.filter(
      (recipe) =>
        recipe.slot === slot &&
        recipe.ingredients.every((ingredient) => currentProductIds.has(ingredient.productId))
    );
    candidatesBySlot.set(slot, candidates);
    if (candidates.length === 0) {
      missingSlots.push(slot);
    }
  }

  if (missingSlots.length > 0) {
    throw new Error(
      `No current catalogue-backed recipe for required slot(s): ${missingSlots.join(", ")}.`
    );
  }

  const days: PlannedDay[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const meals: PlannedMeal[] = [];
    for (const slot of MEAL_SLOTS) {
      const candidates = candidatesBySlot.get(slot) ?? [];
      const selected = candidates[dayIndex % candidates.length];
      if (!selected) {
        throw new Error(`Could not select a recipe for ${slot}.`);
      }
      meals.push({ slot, recipe: selected });
    }
    days.push({ date: addDays(input.startDate, dayIndex), meals });
  }

  return { startDate: input.startDate, days };
}

export function summarizeNutrition(day: PlannedDay): {
  perAdult: NutrientValues;
  perToddler: NutrientValues;
} {
  const perAdult = { ...ZERO_NUTRIENTS };
  const perToddler = { ...ZERO_NUTRIENTS };

  for (const meal of day.meals) {
    validateRecipe(meal.recipe);
    if (meal.recipe.nutrition.adult) {
      addNutrients(perAdult, meal.recipe.nutrition.adult);
    }
    addNutrients(perToddler, meal.recipe.nutrition.toddler);
  }

  return { perAdult, perToddler };
}

export function buildShoppingList(
  menu: WeeklyMenu,
  catalog: CatalogItem[],
  inventory: InventoryEntry[] = []
): ShoppingLine[] {
  if (menu.days.length !== 7) {
    throw new Error("Shopping lists require a complete seven-day menu.");
  }

  const catalogById = new Map<string, CatalogItem>();
  for (const item of catalog) {
    validateCatalogItem(item);
    if (catalogById.has(item.id)) {
      throw new Error(`Duplicate catalogue product ID: ${item.id}.`);
    }
    catalogById.set(item.id, item);
  }

  const required = new Map<string, { quantity: number; unit: string }>();
  for (const day of menu.days) {
    for (const meal of day.meals) {
      validateRecipe(meal.recipe);
      for (const ingredient of meal.recipe.ingredients) {
        const item = catalogById.get(ingredient.productId);
        if (!item) {
          throw new Error(`Missing catalogue product "${ingredient.productId}" in shopping list.`);
        }
        if (menu.startDate < item.validFrom || menu.startDate > item.validUntil) {
          throw new Error(`Catalogue item "${item.name}" is not current for this menu.`);
        }
        if (ingredient.unit !== item.unit) {
          throw new Error(`Unit mismatch for "${item.name}" in shopping list.`);
        }
        const current = required.get(item.id);
        if (current && current.unit !== ingredient.unit) {
          throw new Error(`Unit mismatch for "${item.name}" in shopping list.`);
        }
        required.set(item.id, {
          quantity: (current?.quantity ?? 0) + ingredient.quantity,
          unit: ingredient.unit
        });
      }
    }
  }

  const onHand = new Map<string, number>();
  for (const entry of inventory) {
    const item = catalogById.get(entry.productId);
    if (!item) {
      throw new Error(`Pantry item references unknown catalogue product "${entry.productId}".`);
    }
    if (entry.unit !== item.unit) {
      throw new Error(`Pantry unit for "${item.name}" must be ${item.unit}.`);
    }
    if (!Number.isFinite(entry.quantity) || entry.quantity < 0) {
      throw new Error(`Pantry quantity for "${item.name}" must be a non-negative number.`);
    }
    onHand.set(entry.productId, (onHand.get(entry.productId) ?? 0) + entry.quantity);
  }

  const shoppingList: ShoppingLine[] = [];
  for (const [productId, amount] of required) {
    const item = catalogById.get(productId);
    if (!item) {
      throw new Error(`Missing catalogue product "${productId}" in shopping list.`);
    }
    const quantity = Math.max(0, amount.quantity - (onHand.get(productId) ?? 0));
    if (quantity > 0) {
      shoppingList.push({
        productId,
        productName: item.name,
        productUrl: item.productUrl,
        catalogUrl: item.catalogUrl,
        quantity,
        unit: amount.unit
      });
    }
  }

  return shoppingList.sort((left, right) => left.productName.localeCompare(right.productName, "ro"));
}

export function matchDetectedFoods(
  names: string[],
  catalog: CatalogItem[]
): Array<{ detectedName: string; productId: string | null }> {
  const normalizedCatalog = catalog.map((item) => {
    validateCatalogItem(item);
    return {
      item,
      name: normalizeFoodName(item.name),
      key: normalizeFoodName(item.ingredientKey)
    };
  });

  const matches = names.map((name) => {
    const detectedName = name.trim();
    if (detectedName.length === 0) {
      throw new Error("Detected food names cannot be empty.");
    }
    const normalizedName = normalizeFoodName(detectedName);
    const match = normalizedCatalog.find(
      ({ name: catalogName, key }) =>
        catalogName === normalizedName || key === normalizedName
    );
    return {
      detectedName,
      productId: match?.item.id ?? null
    };
  });

  return matches;
}

export function toShoppingCsv(lines: ShoppingLine[]): string {
  const rows = [
    "Ingredient,Product link,Catalog link,Quantity,Unit",
    ...lines.map((line) =>
      [
        line.productName,
        line.productUrl,
        line.catalogUrl,
        String(line.quantity),
        line.unit
      ]
        .map(escapeCsvField)
        .join(",")
    )
  ];

  return rows.join("\r\n");
}

function validateCatalogItem(item: CatalogItem): void {
  if (!item || typeof item !== "object") {
    throw new Error("Catalogue entries must be objects.");
  }
  assertNonEmptyString(item.id, "Catalogue product ID");
  assertNonEmptyString(item.name, "Catalogue product name");
  assertNonEmptyString(item.ingredientKey, "Catalogue ingredient key");
  assertNonEmptyString(item.unit, "Catalogue unit");

  const productUrl = readHttpsUrl(item.productUrl, "Product link");
  if (!isLidlHost(productUrl.hostname) || productUrl.pathname === "/") {
    throw new Error("Each ingredient needs a product-specific official Lidl product URL.");
  }

  const catalogUrl = readHttpsUrl(item.catalogUrl, "Catalogue link");
  const catalogPath = catalogUrl.pathname.toLocaleLowerCase("ro");
  if (!isLidlHost(catalogUrl.hostname) || !catalogPath.includes("catalo")) {
    throw new Error("Each ingredient needs an official Lidl catalogue URL.");
  }

  const storeUrl = readHttpsUrl(item.storeUrl, "Store link");
  if (!isLidlHost(storeUrl.hostname) || !storeUrl.pathname.toLocaleLowerCase("ro").includes("targu-mures")) {
    throw new Error("Each ingredient needs an official Târgu Mureș store URL.");
  }

  assertIsoDate(item.validFrom, "Catalogue start date");
  assertIsoDate(item.validUntil, "Catalogue end date");
  if (item.validFrom > item.validUntil) {
    throw new Error(`Catalogue dates are reversed for "${item.name}".`);
  }
}

function validateRecipe(recipe: Recipe): void {
  if (!recipe || typeof recipe !== "object") {
    throw new Error("Recipes must be objects.");
  }
  assertNonEmptyString(recipe.id, "Recipe ID");
  assertNonEmptyString(recipe.name, "Recipe name");
  if (!isMealSlot(recipe.slot)) {
    throw new Error(`Recipe "${recipe.name}" has an unknown meal slot.`);
  }
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    throw new Error(`Recipe "${recipe.name}" must have at least one ingredient.`);
  }
  if (!recipe.toddlerSafetyReviewed) {
    throw new Error(`Recipe "${recipe.name}" has not been reviewed for toddler suitability.`);
  }
  if (!recipe.serves || typeof recipe.serves !== "object") {
    throw new Error(`Recipe "${recipe.name}" must declare its portions.`);
  }
  if (!recipe.nutrition || typeof recipe.nutrition !== "object") {
    throw new Error(`Recipe "${recipe.name}" must include nutrition values.`);
  }

  const toddlerSnack = recipe.slot === "snack1" || recipe.slot === "snack2";
  const expectedAdults = toddlerSnack ? 0 : 2;
  if (recipe.serves.adults !== expectedAdults || recipe.serves.toddler !== 1) {
    throw new Error(
      toddlerSnack
        ? `Recipe "${recipe.name}" must serve one toddler and no adults.`
        : `Recipe "${recipe.name}" must serve two adults and one toddler.`
    );
  }
  if (toddlerSnack && recipe.nutrition.adult !== undefined) {
    throw new Error(`Toddler-only snack "${recipe.name}" must not include adult portions.`);
  }
  if (!toddlerSnack && recipe.nutrition.adult === undefined) {
    throw new Error(`Family meal "${recipe.name}" must include adult nutrition values.`);
  }
  validateNutrients(recipe.nutrition.toddler, `Toddler nutrition for "${recipe.name}"`);
  if (recipe.nutrition.adult) {
    validateNutrients(recipe.nutrition.adult, `Adult nutrition for "${recipe.name}"`);
  }

  const sourceUrl = readHttpsUrl(recipe.nutritionSourceUrl, "Nutrition source link");
  if (!isOfficialNutritionHost(sourceUrl.hostname)) {
    throw new Error(`Recipe "${recipe.name}" needs an official nutrition source URL.`);
  }

  for (const ingredient of recipe.ingredients) {
    assertNonEmptyString(ingredient.productId, `Ingredient product ID in "${recipe.name}"`);
    assertNonEmptyString(ingredient.unit, `Ingredient unit in "${recipe.name}"`);
    if (!Number.isFinite(ingredient.quantity) || ingredient.quantity <= 0) {
      throw new Error(`Ingredient quantity in "${recipe.name}" must be greater than zero.`);
    }
  }
}

function validateNutrients(values: NutrientValues, label: string): void {
  if (!values || typeof values !== "object") {
    throw new Error(`${label} is required.`);
  }
  for (const key of NUTRIENT_KEYS) {
    const value = values[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must contain non-negative numeric values.`);
    }
  }
}

function readNutrients(value: unknown, label: string): NutrientValues {
  const row = readRecord(value, label);
  return {
    energyKcal: readNonNegativeNumber(row, "energyKcal", label),
    proteinGrams: readNonNegativeNumber(row, "proteinGrams", label),
    carbohydrateGrams: readNonNegativeNumber(row, "carbohydrateGrams", label),
    fatGrams: readNonNegativeNumber(row, "fatGrams", label),
    fiberGrams: readNonNegativeNumber(row, "fiberGrams", label),
    saltGrams: readNonNegativeNumber(row, "saltGrams", label)
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} needs a non-empty "${key}" value.`);
  }
  return value.trim();
}

function readBoolean(row: Record<string, unknown>, key: string, label: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error(`${label} needs a boolean "${key}" value.`);
  }
  return value;
}

function readNonNegativeNumber(
  row: Record<string, unknown>,
  key: string,
  label: string
): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} needs a non-negative numeric "${key}" value.`);
  }
  return value;
}

function readPositiveNumber(row: Record<string, unknown>, key: string, label: string): number {
  const value = readNonNegativeNumber(row, key, label);
  if (value === 0) {
    throw new Error(`${label} needs a positive "${key}" value.`);
  }
  return value;
}

function assertNonEmptyString(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
}

function assertIsoDate(value: string, label: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
  if (!valid) {
    throw new Error(`${label} must use a real YYYY-MM-DD date.`);
  }
}

function readHttpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  return parsed;
}

function isMealSlot(value: string): value is MealSlot {
  let valid = false;
  for (const slot of MEAL_SLOTS) {
    if (slot === value) {
      valid = true;
    }
  }
  return valid;
}

function isLidlHost(hostname: string): boolean {
  return hostname === "lidl.ro" || hostname.endsWith(".lidl.ro");
}

function isOfficialNutritionHost(hostname: string): boolean {
  const allowedHosts = ["who.int", "efsa.europa.eu", "usda.gov", "europa.eu", "lidl.ro"];
  let allowed = false;
  for (const host of allowedHosts) {
    if (hostname === host || hostname.endsWith(`.${host}`)) {
      allowed = true;
    }
  }
  return allowed;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addNutrients(target: NutrientValues, values: NutrientValues): void {
  for (const key of NUTRIENT_KEYS) {
    target[key] += values[key];
  }
}

function normalizeFoodName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("ro");
}

function escapeCsvField(value: string): string {
  const formulaLike = /^[\s]*[=+\-@]/.test(value);
  const safeValue = formulaLike ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}
