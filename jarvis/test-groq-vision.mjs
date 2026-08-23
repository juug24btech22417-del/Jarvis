import axios from "axios";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const apiKey = process.env.GROQ_API_KEY;
console.log("Using Groq API Key:", apiKey ? apiKey.slice(0, 15) + "..." : "not set");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const imageUrl = "https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=200";
const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
const base64Image = Buffer.from(response.data).toString("base64");
const dataUrl = `data:image/jpeg;base64,${base64Image}`;

try {
  const res = await axios.post(
    GROQ_URL,
    {
      model: "llama-3.2-11b-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image in detail." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.4,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );
  console.log("Groq status:", res.status);
  console.log("Groq response:", JSON.stringify(res.data?.choices?.[0]?.message?.content));
} catch (err) {
  console.error("Groq error:", err.response?.status, err.response?.data || err.message);
}
