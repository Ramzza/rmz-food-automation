import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./server.js";

describe("PRD-005 and PRD-007: local image API", () => {
  it("holds the image in memory and returns names for user review", async () => {
    const analyze = vi.fn(async (image: Buffer, mimeType: string) => {
      expect(image.byteLength).toBeGreaterThan(0);
      expect(mimeType).toBe("image/png");
      return ["banana"];
    });

    const response = await request(createApp(analyze))
      .post("/api/fridge")
      .attach("image", Buffer.from([1, 2, 3]), {
        filename: "fridge.png",
        contentType: "image/png"
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: ["banana"] });
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("rejects unsupported uploads without calling the vision model", async () => {
    const analyze = vi.fn(async () => ["unexpected"]);

    const response = await request(createApp(analyze))
      .post("/api/fridge")
      .attach("image", Buffer.from("not an image"), {
        filename: "notes.txt",
        contentType: "text/plain"
      });

    expect(response.status).toBe(400);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("returns a clear error if no image was uploaded", async () => {
    const response = await request(createApp())
      .post("/api/fridge")
      .field("unexpected", "value");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Upload one JPEG, PNG, or WebP image." });
  });
});
