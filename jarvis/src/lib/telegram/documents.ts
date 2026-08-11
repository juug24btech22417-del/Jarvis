// Telegram document parsing — branches on MIME / extension to extract
// text from PDFs, .docx, .txt. Image-typed "documents" (Telegram users
// sometimes send photos via the document pipeline) fall through to the
// vision pipeline so they still get a description.

import { describeImage } from "./vision";
// pdf-parse 2.x is ESM and exposes a named `default`-style callable; we
// import dynamically inside parseDocument to keep module-load light.
// mammoth is CJS: `mammoth.extractRawText({ buffer })`.

export interface ParsedDocument {
  text: string;
  meta: {
    pages?: number;
    mime: string;
    filename?: string;
    parser: "pdf-parse" | "mammoth" | "utf8" | "vision";
  };
}

export async function parseDocument(
  buff: Buffer,
  mime: string,
  filename: string
): Promise<ParsedDocument> {
  const lowerMime = mime.toLowerCase();
  const ext = (filename.split(".").pop() || "").toLowerCase();

  // 1. PDF — pdf-parse.
  if (lowerMime === "application/pdf" || ext === "pdf") {
    try {
      // pdf-parse v2 has a default export that accepts a Buffer.
      const mod: any = await import("pdf-parse");
      const fn = mod.default ?? mod.pdf ?? mod;
      const result = await fn(buff);
      return {
        text: result.text || "",
        meta: {
          pages: result.numpages,
          mime,
          filename,
          parser: "pdf-parse",
        },
      };
    } catch (err: any) {
      throw new Error(
        `pdf-parse failed (${err?.message || err}). ` +
          `If the PDF is image-only, OCR-via-vision will be attempted.`
      );
    }
  }

  // 2. DOCX — mammoth.
  if (
    lowerMime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    try {
      const mammoth: any = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buff });
      return {
        text: result.value || "",
        meta: { mime, filename, parser: "mammoth" },
      };
    } catch (err: any) {
      throw new Error(`mammoth docx parse failed: ${err?.message || err}`);
    }
  }

  // 3. Plain text — UTF-8.
  if (lowerMime.startsWith("text/") || ["txt", "md", "csv", "log"].includes(ext)) {
    return {
      text: buff.toString("utf8"),
      meta: { mime, filename, parser: "utf8" },
    };
  }

  // 4. Image-typed documents — fall through to vision.
  if (lowerMime.startsWith("image/")) {
    const text = await describeImage(
      buff,
      mime,
      `Describe or extract the text from the document image "${filename}".`
    );
    return {
      text,
      meta: { mime, filename, parser: "vision" },
    };
  }

  throw new Error(
    `Unsupported document type: ${filename} (${mime}). Supported: PDF, DOCX, TXT, image-*`
  );
}
