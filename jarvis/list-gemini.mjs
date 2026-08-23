import axios from "axios";

try {
  const res = await axios.get("https://openrouter.ai/api/v1/models");
  const gemini = res.data.data.filter(m => m.id.toLowerCase().includes("gemini"));
  for (const m of gemini) {
    console.log(`- ${m.id} ($${m.pricing.prompt}/${m.pricing.completion})`);
  }
} catch (e) {
  console.error(e.message);
}
