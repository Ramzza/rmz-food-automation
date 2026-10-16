import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../src/app/api/fridge/route.js";
import { identifyFridgeItems } from "../../../../../src/vision.js";

vi.mock("../../../../../src/vision.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../src/vision.js")>();
  return { ...actual, identifyFridgeItems: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createRequest(image?: File): Request {
  const formData = new FormData();
  if (image) {
    formData.set("image", image);
  }
  return new Request("http://localhost/api/fridge", { method: "POST", body: formData });
}

describe("PRD-005 and PRD-007: Next.js local image API", () => {
  it("keeps uploaded bytes in memory and returns names for user review", async () => {
    vi.mocked(identifyFridgeItems).mockImplementation(async (image, mimeType) => {
      expect(image).toEqual(new Uint8Array([1, 2, 3]));
      expect(mimeType).toBe("image/png");
      return ["banana"];
    });

    const response = await POST(
      createRequest(new File([new Uint8Array([1, 2, 3])], "fridge.png", { type: "image/png" }))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: ["banana"] });
    expect(identifyFridgeItems).toHaveBeenCalledOnce();
  });

  it("rejects unsupported and oversized uploads without calling the vision model", async () => {
    const unsupported = await POST(
      createRequest(new File(["not an image"], "notes.txt", { type: "text/plain" }))
    );
    const oversized = await POST(
      createRequest(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "fridge.png", { type: "image/png" })
      )
    );

    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({ error: "Image type must be JPEG, PNG, or WebP." });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "Fridge image exceeds the 5 MB limit." });
    expect(identifyFridgeItems).not.toHaveBeenCalled();
  });

  it("returns a clear error if no image was uploaded", async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Upload one JPEG, PNG, or WebP image." });
    expect(identifyFridgeItems).not.toHaveBeenCalled();
  });

  it("reports local model failures instead of returning an empty fridge", async () => {
    vi.mocked(identifyFridgeItems).mockRejectedValue(new Error("Ollama is unavailable."));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      createRequest(new File(["photo"], "fridge.jpg", { type: "image/jpeg" }))
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Local fridge recognition failed: Ollama is unavailable."
    });
    expect(console.error).toHaveBeenCalledOnce();
  });
});
