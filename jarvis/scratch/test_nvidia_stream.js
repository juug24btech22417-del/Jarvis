const apiKey = "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";
const model = "meta/llama-3.1-8b-instruct";

async function test() {
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" }
        ],
        max_tokens: 10,
        temperature: 0.7,
        stream: true,
      }),
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (err) {
    console.error("Error:", err);
  }
}
test();
