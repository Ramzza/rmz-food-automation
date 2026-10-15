import { describe, expect, it } from "vitest";
import { identifyFridgeItems, parseVisionResponse } from "./vision.js";

describe("PRD-005: local fridge-photo recognition", () => {
  it("sends image bytes only to the Ollama loopback endpoint and returns candidate names", async () => {
    let requestUrl = "";
    let requestBody = "";
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({ message: { content: '{"items":["banana","milk"]}' } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const result = await identifyFridgeItems(new Uint8Array([1, 2]), "image/jpeg", fetcher);
    const payload = JSON.parse(requestBody) as {
      model: string;
      messages: Array<{ images: string[] }>;
    };

    expect(requestUrl).toBe("http://127.0.0.1:11434/api/chat");
    expect(payload.model).toBe("qwen2.5vl:3b");
    expect(payload.messages[0].images).toEqual(["AQI="]);
    expect(result).toEqual(["banana", "milk"]);
  });

  it("deduplicates normalized names and rejects malformed model output", () => {
    expect(parseVisionResponse('{"items":["Banana"," banana ","milk"]}')).toEqual([
      "Banana",
      "milk"
    ]);
    expect(() => parseVisionResponse('{"items":[{"name":"banana"}]}')).toThrow(
      /invalid item names/i
    );
  });

  it("rejects empty or unsupported image data before making a request", async () => {
    let requestCount = 0;
    const fetcher: typeof fetch = async () => {
      requestCount += 1;
      return new Response();
    };

    await expect(identifyFridgeItems(new Uint8Array(), "image/jpeg", fetcher)).rejects.toThrow(
      /empty/i
    );
    await expect(
      identifyFridgeItems(new Uint8Array([1]), "text/plain", fetcher)
    ).rejects.toThrow(/image type/i);
    expect(requestCount).toBe(0);
  });

  it("surfaces local model errors instead of treating them as an empty fridge", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("unavailable", { status: 503, statusText: "Unavailable" });

    await expect(
      identifyFridgeItems(new Uint8Array([1]), "image/png", fetcher)
    ).rejects.toThrow(/Ollama request failed/i);
  });
});
