import { PDFParse } from "pdf-parse";

try {
  const buff = Buffer.from([]);
  const u8 = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength);
  const parser = new PDFParse(u8);
  const text = await parser.getText();
  console.log("Parsed text successfully:", text);
} catch (e) {
  console.log("Result with Uint8Array:", e.name, "-", e.message);
}
