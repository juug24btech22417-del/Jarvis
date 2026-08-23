import { PDFParse } from "pdf-parse";
import axios from "axios";

try {
  console.log("Downloading small sample PDF...");
  const response = await axios.get("https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", {
    responseType: "arraybuffer"
  });
  const buff = Buffer.from(response.data);
  const u8 = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength);

  console.log("Parsing PDF using PDFParse class...");
  const parser = new PDFParse(u8);
  const result = await parser.getText();
  
  console.log("Result keys:", Object.keys(result));
  console.log("Text content preview:", JSON.stringify(result.text.slice(0, 200)));
  console.log("Pages or other details:", result.pages ? result.pages.length : "no pages array");

  // Let's also check getInfo()
  const info = await parser.getInfo();
  console.log("Info keys:", Object.keys(info));
  console.log("Info details:", info);
} catch (e) {
  console.error("Failed:", e);
}
