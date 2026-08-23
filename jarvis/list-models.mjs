import axios from "axios";

try {
  const res = await axios.get("https://openrouter.ai/api/v1/models");
  const freeModels = res.data.data.filter(m => m.id.endsWith(":free"));
  console.log("Free models count:", freeModels.length);
  for (const m of freeModels) {
    // Check if it's multimodal/vision
    const isMultimodal = m.description?.toLowerCase().includes("vision") || 
                         m.description?.toLowerCase().includes("multimodal") ||
                         m.description?.toLowerCase().includes("image") ||
                         m.id.toLowerCase().includes("vision");
    console.log(`- ${m.id} (${isMultimodal ? "VISION" : "TEXT ONLY"})`);
  }
} catch (e) {
  console.error("Failed to list models:", e.message);
}
