import express, { type Express, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { MAX_IMAGE_BYTES, identifyFridgeItems } from "./src/vision.js";

export type ImageAnalyzer = (image: Buffer, mimeType: string) => Promise<string[]>;

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function createApp(analyze: ImageAnalyzer = identifyFridgeItems): Express {
  const app = express();
  const webRoot = resolve(process.cwd(), "dist");
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: MAX_IMAGE_BYTES },
    fileFilter: (_request, file, callback) => {
      if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
        callback(null, true);
      } else {
        callback(new Error("Upload one JPEG, PNG, or WebP image."));
      }
    }
  });

  app.post("/api/fridge", upload.single("image"), async (request: Request, response: Response) => {
    if (!request.file || request.file.size === 0) {
      response.status(400).json({ error: "Upload one JPEG, PNG, or WebP image." });
    } else {
      try {
        const items = await analyze(request.file.buffer, request.file.mimetype);
        response.json({ items });
      } catch (error) {
        console.error("Local fridge recognition failed:", error);
        const reason = error instanceof Error ? error.message : "Unknown local model error.";
        response.status(503).json({ error: `Local fridge recognition failed: ${reason}` });
      }
    }
  });

  app.use(
    (error: unknown, _request: Request, response: Response, next: NextFunction): void => {
      if (response.headersSent) {
        next(error);
      } else if (error instanceof multer.MulterError) {
        response.status(400).json({ error: `Photo upload failed: ${error.message}` });
      } else if (error instanceof Error) {
        response.status(400).json({ error: error.message });
      } else {
        console.error("Unexpected photo upload error:", error);
        response.status(500).json({ error: "Unexpected photo upload error." });
      }
    }
  );

  app.use(express.static(webRoot));
  app.get(/.*/, (_request, response) => {
    response.sendFile(resolve(webRoot, "index.html"), (error) => {
      if (error && !response.headersSent) {
        response.status(404).json({ error: "Build the web app before starting the server." });
      }
    });
  });

  return app;
}

const currentFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentFile && fileURLToPath(import.meta.url) === currentFile) {
  const port = Number(process.env.PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`Local fridge API and web server listening at http://127.0.0.1:${port}`);
  });
}
