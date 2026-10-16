// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MealPlanner from "../../../src/components/meal-planner";
import type { CatalogItem, MealSlot, NutrientValues, Recipe } from "../../../src/domain.js";

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
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setValidData(): void {
  fireEvent.change(screen.getByLabelText("Catalogue products"), {
    target: { value: JSON.stringify(catalog) }
  });
  fireEvent.change(screen.getByLabelText("Recipes"), {
    target: { value: JSON.stringify(recipes) }
  });
  fireEvent.change(screen.getByLabelText("Pantry / confirmed fridge items"), {
    target: { value: "[]" }
  });
  fireEvent.change(screen.getByLabelText("Menu start date"), {
    target: { value: START_DATE }
  });
}

function generatePlan(): void {
  fireEvent.click(screen.getByRole("button", { name: "Generate this week" }));
}

describe("PRD-001, PRD-002, and PRD-004: React meal-planning workflow", () => {
  it("renders the complete week, sourced nutrition, safety note, and linked shopping items", () => {
    render(<MealPlanner />);
    setValidData();
    generatePlan();

    expect(document.querySelectorAll("#menu-output .day-card")).toHaveLength(7);
    expect(document.querySelectorAll("#menu-output .meal-card")).toHaveLength(35);
    expect(document.querySelectorAll("#menu-output .ingredient-links a")).toHaveLength(70);
    expect(screen.getAllByText(/Per adult portion/)).toHaveLength(21);
    expect(screen.getAllByText(/Per toddler portion/)).toHaveLength(35);
    expect(screen.getAllByText(/not full-day intake/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Important nutrition and child-safety information").textContent).toContain(
      "choking hazards"
    );
    expect(screen.getByText(/EFSA Dietary Reference Values/)).toBeTruthy();
    expect(screen.getByText(/3,500 g/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download CSV for Sheets" }).hasAttribute("disabled")).toBe(
      false
    );
    expect(localStorage.getItem("rmz-food-automation.recipes.v1")).toContain("breakfast");
  });

  it("shows invalid JSON errors instead of generating a partial menu", () => {
    render(<MealPlanner />);
    fireEvent.change(screen.getByLabelText("Catalogue products"), {
      target: { value: "{invalid" }
    });
    fireEvent.change(screen.getByLabelText("Recipes"), { target: { value: "[]" } });

    generatePlan();

    expect(screen.getByRole("status").textContent).toContain("Catalogue data must be valid JSON");
    expect(document.querySelectorAll("#menu-output .day-card")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Download CSV for Sheets" }).hasAttribute("disabled")).toBe(
      true
    );
  });

  it("invalidates an old plan after catalogue, recipe, pantry, or date edits", () => {
    render(<MealPlanner />);
    setValidData();
    generatePlan();
    expect(screen.getByRole("button", { name: "Download CSV for Sheets" }).hasAttribute("disabled")).toBe(
      false
    );

    fireEvent.change(screen.getByLabelText("Recipes"), { target: { value: "[]" } });

    expect(screen.getByText(/Data changed\. Generate the menu again/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download CSV for Sheets" }).hasAttribute("disabled")).toBe(
      true
    );
  });

  it("restores browser-local data and reports successful manual saves", () => {
    localStorage.setItem("rmz-food-automation.catalog.v1", JSON.stringify(catalog));
    render(<MealPlanner />);

    expect(screen.getByLabelText("Catalogue products").textContent).toContain("Rolled oats");
    setValidData();
    fireEvent.click(screen.getByRole("button", { name: "Save data locally" }));

    expect(screen.getByRole("status").textContent).toContain("saved in this browser");
    expect(localStorage.getItem("rmz-food-automation.inventory.v1")).toBe("[]");
  });
});

describe("PRD-005 and PRD-007: user-confirmed local fridge recognition", () => {
  it("sends a photo to the local API and subtracts only confirmed pantry amounts", async () => {
    render(<MealPlanner />);
    setValidData();
    generatePlan();

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
    fireEvent.change(screen.getByLabelText(/Choose a JPEG/), {
      target: { files: [new File(["photo"], "fridge.png", { type: "image/png" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Recognize food locally" }));

    await screen.findByLabelText("Confirm Rolled oats");
    const checkbox = screen.getByLabelText("Confirm Rolled oats") as HTMLInputElement;
    const quantity = screen.getByLabelText("Amount of Rolled oats on hand") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    fireEvent.change(quantity, { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm selected pantry items" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByText(/500 g/)).toBeTruthy();
    expect(localStorage.getItem("rmz-food-automation.inventory.v1")).toContain('"quantity": 3000');
  });

  it("explains missing photos and failed local-model requests", async () => {
    render(<MealPlanner />);
    fireEvent.click(screen.getByRole("button", { name: "Recognize food locally" }));
    expect(screen.getByRole("status").textContent).toContain("Choose a fridge photo");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        json: async () => ({ error: "Local Ollama is unavailable." })
      }))
    );
    fireEvent.change(screen.getByLabelText(/Choose a JPEG/), {
      target: { files: [new File(["photo"], "fridge.png", { type: "image/png" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Recognize food locally" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Local Ollama is unavailable");
    });
  });

  it("rejects invalid quantities for selected pantry suggestions", async () => {
    render(<MealPlanner />);
    setValidData();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ items: ["Rolled oats"] })
      }))
    );
    fireEvent.change(screen.getByLabelText(/Choose a JPEG/), {
      target: { files: [new File(["photo"], "fridge.png", { type: "image/png" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Recognize food locally" }));
    const checkbox = await screen.findByLabelText("Confirm Rolled oats");
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("Amount of Rolled oats on hand"), {
      target: { value: "0" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm selected pantry items" }));

    expect(screen.getByRole("status").textContent).toContain("Enter a positive amount");
    expect(localStorage.getItem("rmz-food-automation.inventory.v1")).toBeNull();
  });
});

describe("PRD-006: browser CSV download", () => {
  it("downloads the current shopping list with a Sheets-compatible filename", () => {
    render(<MealPlanner />);
    setValidData();
    generatePlan();

    const createObjectUrl = vi.fn(() => "blob:local-shopping-list");
    const revokeObjectUrl = vi.fn();
    class DownloadURL extends URL {}
    Object.defineProperty(DownloadURL, "createObjectURL", { value: createObjectUrl });
    Object.defineProperty(DownloadURL, "revokeObjectURL", { value: revokeObjectUrl });
    vi.stubGlobal("URL", DownloadURL);

    const downloadedNames: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloadedNames.push(this.download);
    });
    fireEvent.click(screen.getByRole("button", { name: "Download CSV for Sheets" }));

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:local-shopping-list");
    expect(downloadedNames).toEqual(["shopping-list-2026-10-12.csv"]);
    expect(screen.getByRole("status").textContent).toContain("CSV downloaded");
  });
});
