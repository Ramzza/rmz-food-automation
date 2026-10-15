export const DEFAULT_VISION_MODEL = "qwen2.5vl:3b";
export const OLLAMA_CHAT_URL = "http://127.0.0.1:11434/api/chat";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function parseVisionResponse(content: string): string[] {
  let jsonText = content.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error("Local vision model did not return valid JSON.");
  }

  if (!isRecord(decoded) || !Array.isArray(decoded.items)) {
    throw new Error('Local vision response must contain an "items" array.');
  }

  const names: string[] = [];
  const seenNames = new Set<string>();
  for (const value of decoded.items) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Local vision response contains invalid item names.");
    }
    const name = value.trim();
    const normalized = name.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("ro");
    if (!seenNames.has(normalized)) {
      seenNames.add(normalized);
      names.push(name);
    }
  }

  return names;
}

export async function identifyFridgeItems(
  image: Uint8Array,
  mimeType: string,
  fetcher: typeof fetch = fetch
): Promise<string[]> {
  if (image.byteLength === 0) {
    throw new Error("Fridge image cannot be empty.");
  }
  if (image.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Fridge image exceeds the 5 MB limit.");
  }
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("Image type must be JPEG, PNG, or WebP.");
  }

  const model = process.env.OLLAMA_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
  const response = await fetcher(OLLAMA_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content:
            'Identify only food items visibly present in this fridge photo. Omit uncertain items. Do not infer quantities, ingredients, labels, or hidden contents. Return JSON only in this shape: {"items":["food name"]}.',
          images: [Buffer.from(image).toString("base64")]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with HTTP ${response.status}.`);
  }

  const decoded: unknown = await response.json();
  if (!isRecord(decoded) || !isRecord(decoded.message) || typeof decoded.message.content !== "string") {
    throw new Error("Ollama returned an invalid vision response.");
  }

  return parseVisionResponse(decoded.message.content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
