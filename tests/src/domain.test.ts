import { describe, expect, it } from "vitest";
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
  type MealSlot,
  type NutrientValues,
  type Recipe
} from "../../src/domain.js";

const catalogItem = (overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "oats",
  name: "Rolled oats",
  ingredientKey: "rolled oats",
  unit: "g",
  productUrl: "https://www.lidl.ro/p/rolled-oats/p1001",
  catalogUrl: "https://www.lidl.ro/c/cataloage-online/s10019911",
  storeUrl: "https://www.lidl.ro/s/ro-RO/cautare-magazin/targu-mures/strada-livezeni-6/",
  validFrom: "2026-10-12",
  validUntil: "2026-10-18",
  ...overrides
});

const nutrients = (energyKcal: number): NutrientValues => ({
  energyKcal,
  proteinGrams: energyKcal / 10,
  carbohydrateGrams: energyKcal / 5,
  fatGrams: energyKcal / 20,
  fiberGrams: energyKcal / 30,
  saltGrams: energyKcal / 1000
});

const recipe = (
  slot: MealSlot,
  id: string,
  adultEnergy = 100,
  toddlerEnergy = 50,
  overrides: Partial<Recipe> = {}
): Recipe => ({
  id,
  name: id,
  slot,
  serves:
    slot === "snack1" || slot === "snack2"
      ? { adults: 0, toddler: 1 }
      : { adults: 2, toddler: 1 },
  ingredients: [{ productId: "oats", quantity: 100, unit: "g" }],
  nutrition: {
    ...(slot === "snack1" || slot === "snack2" ? {} : { adult: nutrients(adultEnergy) }),
    toddler: nutrients(toddlerEnergy)
  },
  nutritionSourceUrl: "https://fdc.nal.usda.gov/food-details/123/nutrients",
  toddlerSafetyReviewed: true,
  ...overrides
});

const allSlots: MealSlot[] = ["breakfast", "snack1", "lunch", "snack2", "dinner"];

const weeklyRecipes = (): Recipe[] => [
  recipe("breakfast", "porridge"),
  recipe("snack1", "banana-snack"),
  recipe("lunch", "lentil-lunch", 200, 120),
  recipe("snack2", "yogurt-snack", 30, 25),
  recipe("dinner", "vegetable-dinner", 300, 150)
];

const makeMenu = (catalog: CatalogItem[] = [catalogItem()]) =>
  generateWeeklyMenu({
    recipes: weeklyRecipes(),
    catalog,
    startDate: "2026-10-12"
  });

describe("PRD-001: seven-day family menu", () => {
  it("generates seven days with the five required ordered meal slots", () => {
    const menu = makeMenu();

    expect(menu.days).toHaveLength(7);
    expect(menu.days.map((day) => day.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18"
    ]);
    expect(menu.days.flatMap((day) => day.meals)).toHaveLength(35);
    expect(menu.days[0].meals.map((meal) => meal.slot)).toEqual(allSlots);
  });

  it("assigns two adult portions and one toddler portion only to family meals", () => {
    const menu = makeMenu();

    for (const day of menu.days) {
      for (const meal of day.meals) {
        if (meal.slot === "snack1" || meal.slot === "snack2") {
          expect(meal.recipe.serves).toEqual({ adults: 0, toddler: 1 });
          expect(meal.recipe.nutrition.adult).toBeUndefined();
          expect(meal.recipe.nutrition.toddler).toBeDefined();
        } else {
          expect(meal.recipe.serves).toEqual({ adults: 2, toddler: 1 });
          expect(meal.recipe.nutrition.adult).toBeDefined();
          expect(meal.recipe.nutrition.toddler).toBeDefined();
        }
      }
    }
  });

  it("rotates eligible recipe choices by meal slot across the week", () => {
    const recipes = [...weeklyRecipes(), recipe("breakfast", "oat-pancakes")];
    const menu = generateWeeklyMenu({
      recipes,
      catalog: [catalogItem()],
      startDate: "2026-10-12"
    });

    expect(menu.days[0].meals[0].recipe.id).toBe("porridge");
    expect(menu.days[1].meals[0].recipe.id).toBe("oat-pancakes");
    expect(menu.days[2].meals[0].recipe.id).toBe("porridge");
  });

  it("rejects recipes that have not been reviewed for toddler suitability", () => {
    const unreviewed = weeklyRecipes().map((entry) =>
      entry.id === "banana-snack" ? { ...entry, toddlerSafetyReviewed: false } : entry
    );

    expect(() =>
      generateWeeklyMenu({
        recipes: unreviewed,
        catalog: [catalogItem()],
        startDate: "2026-10-12"
      })
    ).toThrow(/toddler suitability/i);
  });
});

describe("PRD-002: nutrition estimates and official references", () => {
  it("calculates daily per-adult and toddler nutrient totals", () => {
    const firstDay = makeMenu().days[0];
    const daily = summarizeNutrition(firstDay);

    expect(daily.perAdult.energyKcal).toBe(600);
    expect(daily.perToddler.energyKcal).toBe(395);
    expect(daily.perAdult.proteinGrams).toBe(60);
    expect(daily.perToddler.proteinGrams).toBe(39.5);
  });

  it("provides EFSA, WHO, and food-composition references", () => {
    expect(SOURCE_REFERENCES.map((source) => source.url)).toEqual(
      expect.arrayContaining([
        "https://multimedia.efsa.europa.eu/drvs/index.htm",
        "https://www.who.int/publications/i/item/9789240081864",
        "https://fdc.nal.usda.gov/"
      ])
    );
  });

  it("requires a nutrition source from an authoritative domain", () => {
    const invalid = weeklyRecipes().map((entry) =>
      entry.id === "porridge"
        ? { ...entry, nutritionSourceUrl: "https://example.com/nutrients" }
        : entry
    );

    expect(() =>
      generateWeeklyMenu({
        recipes: invalid,
        catalog: [catalogItem()],
        startDate: "2026-10-12"
      })
    ).toThrow(/official nutrition source/i);
  });
});

describe("PRD-003: Lidl Târgu Mureș catalogue provenance", () => {
  it("rejects non-Lidl product URLs", () => {
    expect(() =>
      generateWeeklyMenu({
        recipes: weeklyRecipes(),
        catalog: [catalogItem({ productUrl: "https://example.com/oats" })],
        startDate: "2026-10-12"
      })
    ).toThrow(/official Lidl product URL/i);
  });

  it("rejects non-Târgu Mureș store links and stale catalogue entries", () => {
    expect(() =>
      generateWeeklyMenu({
        recipes: weeklyRecipes(),
        catalog: [
          catalogItem({
            storeUrl: "https://www.lidl.ro/s/ro-RO/cautare-magazin/cluj/strada-1/"
          })
        ],
        startDate: "2026-10-12"
      })
    ).toThrow(/Târgu Mureș store URL/i);

    expect(() =>
      generateWeeklyMenu({
        recipes: weeklyRecipes(),
        catalog: [catalogItem({ validFrom: "2026-10-01", validUntil: "2026-10-11" })],
        startDate: "2026-10-12"
      })
    ).toThrow(/No current catalogue-backed recipe/i);
  });
});

describe("PRD-004: shopping list and pantry subtraction", () => {
  it("totals all menu quantities, subtracts confirmed pantry amounts, and retains links", () => {
    const menu = makeMenu();
    const shoppingList = buildShoppingList(menu, [catalogItem()], [
      { productId: "oats", quantity: 400, unit: "g" }
    ]);

    expect(shoppingList).toEqual([
      {
        productId: "oats",
        productName: "Rolled oats",
        productUrl: "https://www.lidl.ro/p/rolled-oats/p1001",
        catalogUrl: "https://www.lidl.ro/c/cataloage-online/s10019911",
        quantity: 3100,
        unit: "g"
      }
    ]);
  });

  it("rejects pantry quantities in a different unit", () => {
    expect(() =>
      buildShoppingList(makeMenu(), [catalogItem()], [
        { productId: "oats", quantity: 2, unit: "kg" }
      ])
    ).toThrow(/unit/i);
  });

  it("matches fridge suggestions exactly and leaves unknown names unassigned", () => {
    expect(matchDetectedFoods(["Rolled oats", "unknown food"], [catalogItem()])).toEqual([
      { detectedName: "Rolled oats", productId: "oats" },
      { detectedName: "unknown food", productId: null }
    ]);
  });
});

describe("PRD-006: Google Sheets CSV export", () => {
  it("quotes fields, protects formula-like names, and uses CRLF rows", () => {
    const csv = toShoppingCsv([
      {
        productId: "oats",
        productName: '=SUM("x"), oats',
        productUrl: "https://www.lidl.ro/p/rolled-oats/p1001",
        catalogUrl: "https://www.lidl.ro/c/cataloage-online/s10019911",
        quantity: 3,
        unit: "g"
      }
    ]);

    expect(csv).toContain('"\u0027=SUM(""x""), oats"');
    expect(csv).toContain("\r\n");
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("Catalogue and recipe data validation", () => {
  it("parses valid catalogue, recipe, and pantry JSON arrays", () => {
    expect(parseCatalogItems([catalogItem()])).toEqual([catalogItem()]);
    expect(parseRecipes(weeklyRecipes())).toEqual(weeklyRecipes());
    expect(parseInventoryEntries([{ productId: "oats", quantity: 50, unit: "g" }])).toEqual([
      { productId: "oats", quantity: 50, unit: "g" }
    ]);
  });

  it("surfaces malformed arrays, portion values, and pantry quantities", () => {
    expect(() => parseCatalogItems({ id: "oats" })).toThrow(/JSON array/i);
    expect(() => parseRecipes([{ ...weeklyRecipes()[0], id: "" }])).toThrow(/non-empty "id"/i);
    expect(() =>
      parseRecipes([
        {
          ...weeklyRecipes()[0],
          serves: { adults: 2, toddler: 0 }
        }
      ])
    ).toThrow(/two adults and one toddler/i);
    expect(() =>
      parseInventoryEntries([{ productId: "oats", quantity: -1, unit: "g" }])
    ).toThrow(/non-negative numeric/i);
  });
});
