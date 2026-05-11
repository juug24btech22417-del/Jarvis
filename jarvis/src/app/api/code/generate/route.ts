import { NextRequest, NextResponse } from "next/server";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Code generation system prompt
const CODE_SYSTEM_PROMPT = `You are JARVIS, an expert programmer. Generate clean, well-commented code.

RULES:
1. Provide only code, minimal explanation.
2. Include helpful comments.
3. Use best practices and make it highly runnable/functional.
4. CRITICAL: If asked for HTML, web, or frontend code, output EVERYTHING combined into a SINGLE, fully valid HTML file using <style> and <script> tags. DO NOT split into multiple files (no external styles.css or script.js), and do not add file headers like <!-- index.html --> inside the code string.
5. Do not include markdown code block syntax inside the "code" JSON string.

RESPOND IN THIS FORMAT:
{"language": "language_name", "code": "generated code", "description": "brief description"}`;

export async function POST(req: NextRequest) {
  try {
    if (!NVIDIA_API_KEY) {
      // Demo mode - return template code
      const { prompt } = await req.json();

      if (prompt.toLowerCase().includes("python")) {
        return NextResponse.json({
          success: true,
          language: "python",
          code: `# Generated Python code for: ${prompt}
def main():
    # TODO: Implement your logic here
    print("Hello from JARVIS!")

if __name__ == "__main__":
    main()`,
          description: "Python template",
        });
      }

      if (prompt.toLowerCase().includes("javascript") || prompt.toLowerCase().includes("js")) {
        return NextResponse.json({
          success: true,
          language: "javascript",
          code: `// Generated JavaScript code for: ${prompt}
function main() {
  // TODO: Implement your logic here
  console.log("Hello from JARVIS!");
}

main();`,
          description: "JavaScript template",
        });
      }

      return NextResponse.json({
        success: true,
        language: "generic",
        code: `// Code generation for: ${prompt}\n// Configure NVIDIA_API_KEY for AI-generated code`,
        description: "Template (API key not configured)",
      });
    }

    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt required" },
        { status: 400 }
      );
    }

    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: "meta/llama-3.3-70b-instruct",
        messages: [
          { role: "system", content: CODE_SYSTEM_PROMPT },
          { role: "user", content: `Generate code for: ${prompt}` },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Try to parse JSON response
    try {
      // First, strip markdown code blocks if the LLM wrapped the JSON
      let cleanContent = content;
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.replace(/^```json\n?/, "").replace(/\n?```$/, "");
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.replace(/^```\n?/, "").replace(/\n?```$/, "");
      }

      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return NextResponse.json({
          success: true,
          language: parsed.language || "unknown",
          code: parsed.code || content,
          description: parsed.description || "",
        });
      }
    } catch (e: any) {
      console.warn("Failed to parse LLM code generation response as JSON:", e.message);
      // Return raw content if parsing fails
    }

    return NextResponse.json({
      success: true,
      language: "unknown",
      code: content,
      description: "Generated code (fallback parsing)",
    });

  } catch (error) {
    console.error("Code generation error:", error);
    return NextResponse.json(
      { error: "Code generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
