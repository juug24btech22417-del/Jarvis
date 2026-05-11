import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// Local LLM integration via Ollama
// Ollama runs models locally: https://ollama.ai

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";

interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
}

async function queryOllama(prompt: string, model: string = "llama2"): Promise<OllamaResponse> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  return response.json();
}

async function checkOllamaRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function readDocument(filePath: string): Promise<string> {
  const fullPath = filePath.startsWith("/") || filePath.includes(":")
    ? filePath
    : join(process.cwd(), filePath);

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  const content = await readFile(fullPath, "utf-8");
  return content;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, query, filePath, model = "llama2" } = body;

    // Check if Ollama is available
    const isOllamaRunning = await checkOllamaRunning();

    if (!isOllamaRunning) {
      return NextResponse.json({
        success: false,
        mode: "offline",
        error: "Ollama not running",
        setup: {
          instructions: [
            "1. Install Ollama from https://ollama.ai",
            "2. Start Ollama: ollama serve",
            "3. Pull a model: ollama pull llama2",
            "4. Set OLLAMA_URL in .env.local (default: http://localhost:11434)",
          ],
          windows: "Download from ollama.ai, run 'ollama serve' in terminal",
          mac: "brew install ollama && ollama serve",
          linux: "curl -fsSL https://ollama.ai/install.sh | sh && ollama serve",
        },
        // Fallback: use NVIDIA API if available
        fallback: process.env.NVIDIA_API_KEY ? "nvidia" : "none",
      }, {
        status: 503,
      });
    }

    switch (action) {
      case "chat": {
        if (!query) {
          return NextResponse.json(
            { error: "Query required" },
            { status: 400 }
          );
        }

        const result = await queryOllama(query, model);
        return NextResponse.json({
          success: true,
          mode: "local",
          model: result.model,
          response: result.response,
        });
      }

      case "summarize": {
        const { text } = body;
        if (!text) {
          return NextResponse.json(
            { error: "Text required" },
            { status: 400 }
          );
        }

        const prompt = `Summarize the following text concisely:\n\n${text.slice(0, 4000)}`;
        const result = await queryOllama(prompt, model);
        return NextResponse.json({
          success: true,
          mode: "local",
          summary: result.response,
        });
      }

      case "query-document": {
        if (!filePath || !query) {
          return NextResponse.json(
            { error: "File path and query required" },
            { status: 400 }
          );
        }

        const content = await readDocument(filePath);
        const truncatedContent = content.slice(0, 3000);
        const prompt = `Based on the following document, answer this question: "${query}"\n\nDocument:\n${truncatedContent}`;

        const result = await queryOllama(prompt, model);
        return NextResponse.json({
          success: true,
          mode: "local",
          file: filePath,
          query,
          answer: result.response,
          documentLength: content.length,
        });
      }

      case "list-models": {
        try {
          const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
          const data = await response.json();
          return NextResponse.json({
            success: true,
            models: data.models || [],
          });
        } catch (e) {
          return NextResponse.json({
            success: true,
            models: [],
            note: "Could not fetch models list",
          });
        }
      }

      default:
        return NextResponse.json(
          {
            error: "Unknown action",
            available: ["chat", "summarize", "query-document", "list-models"],
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Local LLM error:", error);
    return NextResponse.json(
      { error: "Local LLM request failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const isOllamaRunning = await checkOllamaRunning();

  return NextResponse.json({
    success: true,
    status: isOllamaRunning ? "online" : "offline",
    description: "Local LLM processing with Ollama",
    benefits: [
      "100% free (no API costs)",
      "Works offline",
      "Private (data never leaves your machine)",
      "Fast (no network latency)",
    ],
    availableModels: [
      { name: "llama2", size: "3.8GB", description: "General purpose" },
      { name: "llama2:13b", size: "7.3GB", description: "Better quality" },
      { name: "mistral", size: "4.1GB", description: "Fast and capable" },
      { name: "codellama", size: "3.8GB", description: "Code generation" },
      { name: "vicuna", size: "3.8GB", description: "Chat optimized" },
    ],
    setup: {
      step1: "Install Ollama from https://ollama.ai",
      step2: "Run: ollama serve",
      step3: "Pull model: ollama pull llama2",
      step4: "Start using local LLM",
    },
    usage: {
      endpoint: "/api/local-llm",
      actions: {
        chat: { description: "Chat with local LLM", params: ["query", "model"] },
        summarize: { description: "Summarize text", params: ["text", "model"] },
        "query-document": { description: "Query a local file", params: ["filePath", "query"] },
        "list-models": { description: "Show installed models", params: [] },
      },
    },
  });
}
