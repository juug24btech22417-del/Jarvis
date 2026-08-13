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

  // 1. PDF — pdf-parse v2 (class-based API, requires Uint8Array not Buffer).
  if (lowerMime === "application/pdf" || ext === "pdf") {
    try {
      let PDFParseClass: any;
      try {
        const mod: any = await import("pdf-parse");
        PDFParseClass = mod.PDFParse ?? mod.default?.PDFParse;
      } catch (importErr: any) {
        // pdf-parse v2 has a known cold-load bug where it tries to
        // fetch a test fixture file on first import and throws when
        // running in a Next.js server environment. Re-import once
        // without the side-effect path by catching and re-trying.
        console.warn("[documents] pdf-parse cold-load error (retrying):", importErr?.message);
        const mod: any = await import("pdf-parse");
        PDFParseClass = mod.PDFParse ?? mod.default?.PDFParse;
      }

      // pdf-parse v2 exports a named `PDFParse` class.
      // It rejects Node Buffer — convert to plain Uint8Array first.
      if (typeof PDFParseClass !== "function") {
        throw new Error(
          `pdf-parse module did not export PDFParse class. Keys: ${Object.keys(await import("pdf-parse")).join(", ")}`
        );
      }
      const u8 = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength);
      const parser = new PDFParseClass(u8);
      const result = await parser.getText();
      return {
        text: result.text || "",
        meta: {
          pages: result.total ?? result.pages?.length,
          mime,
          filename,
          parser: "pdf-parse",
        },
      };
    } catch (err: any) {
      const cause = err?.message || String(err);
      console.error("[documents] PDF parse error:", cause);
      throw new Error(
        `pdf-parse failed (${cause}). ` +
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
