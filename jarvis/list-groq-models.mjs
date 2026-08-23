import axios from "axios";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const apiKey = process.env.GROQ_API_KEY;
try {
  const res = await axios.get("https://api.groq.com/openai/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  console.log("Groq models:");
  for (const m of res.data.data) {
    console.log(`- ${m.id}`);
  }
} catch (e) {
  console.error("Failed to list Groq models:", e.message);
}
