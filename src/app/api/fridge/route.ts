import { MAX_IMAGE_BYTES, identifyFridgeItems } from "../../../vision";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request): Promise<Response> {
  let response: Response;

  try {
    const formData = await request.formData();
    const upload = formData.get("image");
    if (!(upload instanceof File) || upload.size === 0) {
      response = Response.json(
        { error: "Upload one JPEG, PNG, or WebP image." },
        { status: 400 }
      );
    } else if (upload.size > MAX_IMAGE_BYTES) {
      response = Response.json({ error: "Fridge image exceeds the 5 MB limit." }, { status: 400 });
    } else if (!ALLOWED_IMAGE_TYPES.has(upload.type)) {
      response = Response.json(
        { error: "Image type must be JPEG, PNG, or WebP." },
        { status: 400 }
      );
    } else {
      try {
        const image = new Uint8Array(await upload.arrayBuffer());
        const items = await identifyFridgeItems(image, upload.type);
        response = Response.json({ items });
      } catch (error) {
        console.error("Local fridge recognition failed:", error);
        response = Response.json(
          { error: `Local fridge recognition failed: ${errorMessage(error)}` },
          { status: 503 }
        );
      }
    }
  } catch (error) {
    response = Response.json(
      { error: `Invalid photo upload: ${errorMessage(error)}` },
      { status: 400 }
    );
  }

  return response;
}

function errorMessage(error: unknown): string {
  let message = "Unknown local model error.";
  if (error instanceof Error) {
    message = error.message;
  }
  return message;
}
