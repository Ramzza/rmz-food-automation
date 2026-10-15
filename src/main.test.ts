// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogItem, MealSlot, NutrientValues, Recipe } from "./domain.js";

const START_DATE = "2026-10-12";

const catalog: CatalogItem[] = [
  {
    id: "oats",
    name: "Rolled oats",
    ingredientKey: "rolled oats",
    unit: "g",
    productUrl: "https://www.lidl.ro/p/rolled-oats/p1001",
    catalogUrl: "https://www.lidl.ro/c/cataloage-online/s10019911",
    storeUrl: "https://www.lidl.ro/s/ro-RO/cautare-magazin/targu-mures/strada-livezeni-6/",
    validFrom: START_DATE,
    validUntil: "2026-10-18"
  }
];

const nutrients: NutrientValues = {
  energyKcal: 100,
  proteinGrams: 10,
  carbohydrateGrams: 20,
  fatGrams: 5,
  fiberGrams: 3,
  saltGrams: 0.1
};

const recipes: Recipe[] = (
  ["breakfast", "snack1", "lunch", "snack2", "dinner"] as MealSlot[]
).map((slot) => {
  const snack = slot === "snack1" || slot === "snack2";
  return {
    id: slot,
    name: `${slot} oats`,
    slot,
    serves: snack ? { adults: 0, toddler: 1 } : { adults: 2, toddler: 1 },
    ingredients: [{ productId: "oats", quantity: 100, unit: "g" }],
    nutrition: {
      ...(snack ? {} : { adult: nutrients }),
      toddler: nutrients
    },
    nutritionSourceUrl: "https://fdc.nal.usda.gov/food-details/123/nutrients",
    toddlerSafetyReviewed: true
  };
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
});

async function mountApp(): Promise<void> {
  await import("./main.js");
}

function setValidData(): void {
  getElement<HTMLTextAreaElement>("#catalog-data").value = JSON.stringify(catalog);
  getElement<HTMLTextAreaElement>("#recipe-data").value = JSON.stringify(recipes);
  getElement<HTMLTextAreaElement>("#inventory-data").value = "[]";
  getElement<HTMLInputElement>("#plan-start-date").value = START_DATE;
}

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Test element missing: ${selector}`);
  }
  return element;
}

describe("PRD-001, PRD-002, and PRD-004: browser meal-planning workflow", () => {
  it("renders a complete week, per-person nutrition, official sources, and linked shopping items", async () => {
    await mountApp();
    setValidData();

    getElement<HTMLButtonElement>("#generate-menu").click();

    expect(document.querySelectorAll("#menu-output .day-card")).toHaveLength(7);
    expect(document.querySelectorAll("#menu-output .meal-card")).toHaveLength(35);
    expect(document.querySelectorAll("#menu-output .ingredient-links a")).toHaveLength(70);
    expect(getElement<HTMLDivElement>("#menu-output").textContent).toContain("Per adult portion");
    expect(getElement<HTMLDivElement>("#menu-output").textContent).toContain("Per toddler portion");
    expect(getElement<HTMLDivElement>("#menu-output").textContent).toContain("not full-day intake");
    expect(document.querySelector(".notice")?.textContent).toContain("choking hazards");
    expect(getElement<HTMLUListElement>("#source-list").textContent).toContain("EFSA");
    expect(getElement<HTMLDivElement>("#shopping-output").textContent).toContain("3,500 g");
    expect(getElement<HTMLDivElement>("#shopping-output").querySelector("a")?.href).toContain(
      "lidl.ro"
    );
    expect(getElement<HTMLButtonElement>("#export-csv").disabled).toBe(false);
    expect(localStorage.getItem("rmz-food-automation.recipes.v1")).toContain("breakfast");
  });

  it("shows JSON errors instead of generating a partial menu", async () => {
    await mountApp();
    getElement<HTMLTextAreaElement>("#catalog-data").value = "{invalid";
    getElement<HTMLTextAreaElement>("#recipe-data").value = "[]";

    getElement<HTMLButtonElement>("#generate-menu").click();

    expect(getElement<HTMLParagraphElement>("#status").textContent).toContain(
      "Catalogue data must be valid JSON"
    );
    expect(document.querySelectorAll("#menu-output .day-card")).toHaveLength(0);
    expect(getElement<HTMLButtonElement>("#export-csv").disabled).toBe(true);
  });

  it("invalidates an old plan after catalogue, recipe, pantry, or date edits", async () => {
    await mountApp();
    setValidData();
    getElement<HTMLButtonElement>("#generate-menu").click();
    expect(getElement<HTMLButtonElement>("#export-csv").disabled).toBe(false);

    const recipesField = getElement<HTMLTextAreaElement>("#recipe-data");
    recipesField.value = "[]";
    recipesField.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getElement<HTMLDivElement>("#menu-output").textContent).toContain("Data changed");
    expect(getElement<HTMLButtonElement>("#export-csv").disabled).toBe(true);
  });

  it("restores locally saved catalogue data and reports successful manual saves", async () => {
    localStorage.setItem("rmz-food-automation.catalog.v1", JSON.stringify(catalog));
    await mountApp();

    expect(getElement<HTMLTextAreaElement>("#catalog-data").value).toContain("Rolled oats");
    setValidData();
    getElement<HTMLButtonElement>("#save-data").click();

    expect(getElement<HTMLParagraphElement>("#status").textContent).toContain("saved in this browser");
    expect(localStorage.getItem("rmz-food-automation.inventory.v1")).toBe("[]");
  });
});

describe("PRD-005 and PRD-007: user-confirmed local fridge recognition", () => {
  it("sends the photo to the local API and subtracts only confirmed pantry amounts", async () => {
    await mountApp();
    setValidData();
    getElement<HTMLButtonElement>("#generate-menu").click();

    const fileInput = getElement<HTMLInputElement>("#fridge-photo");
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["photo"], "fridge.png", { type: "image/png" })]
    });
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/fridge");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ items: ["Rolled oats"] })
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    getElement<HTMLButtonElement>("#analyze-photo").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".suggestion-row")).toHaveLength(1);
    });

    const row = document.querySelector(".suggestion-row");
    if (!row) {
      throw new Error("Fridge suggestion did not render.");
    }
    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const quantity = row.querySelector<HTMLInputElement>('input[type="number"]');
    if (!checkbox || !quantity) {
      throw new Error("Fridge suggestion controls did not render.");
    }
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    quantity.value = "3000";
    getElement<HTMLButtonElement>("#confirm-fridge-items").click();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getElement<HTMLDivElement>("#shopping-output").textContent).toContain("500 g");
    expect(localStorage.getItem("rmz-food-automation.inventory.v1")).toContain('"quantity": 3000');
  });

  it("explains missing photos and failed local-model requests", async () => {
    await mountApp();
    getElement<HTMLButtonElement>("#analyze-photo").click();
    expect(getElement<HTMLParagraphElement>("#status").textContent).toContain(
      "Choose a fridge photo"
    );

    const fileInput = getElement<HTMLInputElement>("#fridge-photo");
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["photo"], "fridge.png", { type: "image/png" })]
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        json: async () => ({ error: "Local Ollama is unavailable." })
      }))
    );

    getElement<HTMLButtonElement>("#analyze-photo").click();
    await vi.waitFor(() => {
      expect(getElement<HTMLParagraphElement>("#status").textContent).toContain(
        "Local Ollama is unavailable"
      );
    });
  });
});

describe("PRD-006: browser CSV download", () => {
  it("downloads the current shopping list with a Sheets-compatible filename", async () => {
    await mountApp();
    setValidData();
    getElement<HTMLButtonElement>("#generate-menu").click();

    const createObjectUrl = vi.fn(() => "blob:local-shopping-list");
    const revokeObjectUrl = vi.fn();
    const DownloadURL = class extends URL {};
    Object.defineProperty(DownloadURL, "createObjectURL", { value: createObjectUrl });
    Object.defineProperty(DownloadURL, "revokeObjectURL", { value: revokeObjectUrl });
    vi.stubGlobal("URL", DownloadURL);

    const downloadedNames: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloadedNames.push(this.download);
    });

    getElement<HTMLButtonElement>("#export-csv").click();

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:local-shopping-list");
    expect(downloadedNames).toEqual(["shopping-list-2026-10-12.csv"]);
    expect(getElement<HTMLParagraphElement>("#status").textContent).toContain("CSV downloaded");
  });
});
