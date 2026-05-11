import { NextRequest, NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

// Initialize HuggingFace client
const hf = HF_API_KEY ? new HfInference(HF_API_KEY) : null;

// Check if API key is configured
if (!HF_API_KEY) {
  console.warn("[HuggingFace] WARNING: HUGGINGFACE_API_KEY not set. Using fallback responses.");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { task, inputs, options = {} } = body;

    console.log(`[HuggingFace] Task: ${task}`);

    if (!task) {
      return NextResponse.json({ error: "Task is required" }, { status: 400 });
    }

    // Handle chat/generate with fallback
    if (task === "generate") {
      if (!hf) {
        // Smart contextual responses
        const userInput = (inputs || "").toLowerCase();
        let response = "Hello! I'm JARVIS, your AI assistant. How can I help you today?";

        if (userInput.includes("hello") || userInput.includes("hi")) {
          response = "Hello there! Nice to meet you. I'm JARVIS, ready to assist with information, analysis, or just a chat.";
        } else if (userInput.includes("how are you")) {
          response = "I'm functioning perfectly, thank you for asking! How can I assist you today?";
        } else if (userInput.includes("name")) {
          response = "I'm JARVIS (Just A Rather Very Intelligent System). I'm here to help you with various tasks.";
        } else if (userInput.includes("weather")) {
          response = "I don't have real-time weather data in chat mode, but you can ask me to fetch weather information using voice commands!";
        } else if (userInput.includes("time")) {
          response = `The current time is ${new Date().toLocaleTimeString()}.`;
        } else if (userInput.includes("help")) {
          response = "I can help with many things: summarizing text, translating languages, analyzing sentiment, answering questions, and more. Try the different modes in the Tasks panel!";
        } else if (userInput.length > 10) {
          response = "That's interesting! Tell me more, or try using one of my task modes for more specific analysis.";
        }

        return NextResponse.json({
          success: true,
          task,
          generated_text: response,
          fallback: true,
        });
      }

      try {
        const result = await hf.textGeneration({
          model: "gpt2",
          inputs: inputs || "Hello",
          parameters: {
            max_new_tokens: options.maxTokens || 100,
            temperature: options.temperature || 0.8,
            return_full_text: false,
          },
        });

        let cleanText = result.generated_text || "I'm here to help!";
        if (cleanText.includes("User:")) {
          cleanText = cleanText.split("User:")[0];
        }
        if (cleanText.includes("Assistant:")) {
          cleanText = cleanText.split("Assistant:")[1] || cleanText;
        }

        return NextResponse.json({
          success: true,
          task,
          generated_text: cleanText.trim(),
        });
      } catch (genError: any) {
        console.error("[HuggingFace] Generation error:", genError);
        return NextResponse.json({
          success: true,
          task,
          generated_text: "I'm here to help! (Model loading - try again in a moment)",
          fallback: true,
        });
      }
    }

    if (task === "summarization") {
      if (!hf) {
        const text = inputs || "";
        const sentences = text.match(/[^.!?]+[.!?]+/g);
        const summary = sentences ? sentences.slice(0, 2).join(" ") : text.slice(0, 150) + "...";
        return NextResponse.json({
          success: true,
          task,
          summary: summary || "(Summary requires API key)",
          fallback: true,
        });
      }

      try {
        const result = await hf.summarization({
          model: "facebook/bart-large-cnn",
          inputs: inputs || "",
          parameters: {
            max_length: options.maxLength || 130,
            min_length: options.minLength || 30,
          },
        });

        return NextResponse.json({
          success: true,
          task,
          summary: result.summary_text || "Summary unavailable",
        });
      } catch (error: any) {
        console.error("[HuggingFace] Summarization error:", error);
        const text = inputs || "";
        const sentences = text.match(/[^.!?]+[.!?]+/g);
        const summary = sentences ? sentences.slice(0, 2).join(" ") : text.slice(0, 150);
        return NextResponse.json({
          success: true,
          task,
          summary: summary || "Summary unavailable",
          fallback: true,
        });
      }
    }

    if (task === "translation") {
      const langMap: Record<string, string> = {
        "es": "Helsinki-NLP/opus-mt-en-es",
        "fr": "Helsinki-NLP/opus-mt-en-fr",
        "de": "Helsinki-NLP/opus-mt-en-de",
        "it": "Helsinki-NLP/opus-mt-en-it",
        "pt": "Helsinki-NLP/opus-mt-en-pt",
        "hi": "Helsinki-NLP/opus-mt-en-hi",
        "zh": "Helsinki-NLP/opus-mt-en-zh",
        "ja": "Helsinki-NLP/opus-mt-en-zh", // Japanese model may not exist, fallback to zh
      };

      const targetLang = options.targetLang || "es";
      const model = langMap[targetLang] || "Helsinki-NLP/opus-mt-en-es";

      const langNames: Record<string, string> = {
        "es": "Spanish", "fr": "French", "de": "German", "it": "Italian",
        "pt": "Portuguese", "hi": "Hindi", "zh": "Chinese", "ja": "Japanese",
        "ko": "Korean", "ar": "Arabic", "ru": "Russian",
      };

      if (!hf) {
        return NextResponse.json({
          success: true,
          task,
          translation: `[Translation to ${langNames[targetLang] || targetLang} requires API key]`,
          sourceLang: "en",
          targetLang: langNames[targetLang] || targetLang,
          fallback: true,
        });
      }

      try {
        const result = await hf.translation({
          model: model,
          inputs: inputs || "",
        });

        return NextResponse.json({
          success: true,
          task,
          translation: result.translation_text || inputs,
          sourceLang: "en",
          targetLang: langNames[targetLang] || targetLang,
        });
      } catch (error: any) {
        console.error("[HuggingFace] Translation error:", error);
        return NextResponse.json({
          success: true,
          task,
          translation: `[Translation failed - ${error.message}]`,
          sourceLang: "en",
          targetLang: langNames[targetLang] || targetLang,
          fallback: true,
        });
      }
    }

    if (task === "sentiment") {
      if (!hf) {
        const text = (inputs || "").toLowerCase();
        let label = "NEUTRAL";
        let score = 0.5;

        const positiveWords = ["good", "great", "excellent", "amazing", "love", "happy", "best", "awesome", "fantastic", "wonderful"];
        const negativeWords = ["bad", "terrible", "awful", "hate", "worst", "sad", "angry", "horrible", "disgusting", "poor"];

        const hasPositive = positiveWords.some(w => text.includes(w));
        const hasNegative = negativeWords.some(w => text.includes(w));

        if (hasPositive && !hasNegative) {
          label = "POSITIVE";
          score = 0.85;
        } else if (hasNegative && !hasPositive) {
          label = "NEGATIVE";
          score = 0.85;
        }

        return NextResponse.json({
          success: true,
          task,
          sentiment: [{ label, score }],
          fallback: true,
        });
      }

      try {
        const result = await hf.textClassification({
          model: "distilbert-base-uncased-finetuned-sst-2-english",
          inputs: inputs || "",
        });

        return NextResponse.json({
          success: true,
          task,
          sentiment: result.map((s: any) => ({ label: s.label, score: s.score })),
        });
      } catch (error: any) {
        console.error("[HuggingFace] Sentiment error:", error);
        return NextResponse.json({
          success: true,
          task,
          sentiment: [{ label: "NEUTRAL", score: 0.5 }],
          fallback: true,
        });
      }
    }

    if (task === "qa") {
      const { question, context } = inputs || {};
      if (!question || !context) {
        return NextResponse.json(
          { error: "Question and context required for QA" },
          { status: 400 }
        );
      }

      if (!hf) {
        const q = question.toLowerCase().replace(/[?.,!]/g, "");
        const ctx = context.toLowerCase();
        const qWords = q.split(" ").filter((w: string) => w.length > 3);

        const sentences = context.match(/[^.!?]+[.!?]+/g) || [context];
        let bestSentence = "I couldn't find a specific answer in the context provided.";
        let maxMatches = 0;

        for (const sentence of sentences) {
          const matches = qWords.filter((w: string) => sentence.toLowerCase().includes(w)).length;
          if (matches > maxMatches) {
            maxMatches = matches;
            bestSentence = sentence.trim();
          }
        }

        return NextResponse.json({
          success: true,
          task,
          answer: bestSentence,
          score: maxMatches > 0 ? 0.5 : 0.1,
          fallback: true,
        });
      }

      try {
        const result = await hf.questionAnswering({
          model: "deepset/roberta-base-squad2",
          inputs: {
            question,
            context,
          },
        });

        return NextResponse.json({
          success: true,
          task,
          answer: result.answer || "I couldn't find an answer in the provided context.",
          score: result.score || 0,
          start: result.start || 0,
          end: result.end || 0,
        });
      } catch (qaError: any) {
        console.error("[HuggingFace] QA error:", qaError);
        return NextResponse.json({
          success: true,
          task,
          answer: "I couldn't find a specific answer in the context. Try rephrasing your question or providing more detailed context.",
          score: 0.1,
          fallback: true,
        });
      }
    }

    if (task === "zero-shot") {
      const { text, labels } = inputs || {};
      if (!text || !labels || !Array.isArray(labels)) {
        return NextResponse.json(
          { error: "Text and labels array required" },
          { status: 400 }
        );
      }

      if (!hf) {
        const textLower = text.toLowerCase();
        const scores = labels.map((label: string) => {
          const labelLower = label.toLowerCase();
          const labelWords = labelLower.split(/[\s-_]+/);
          let matches = 0;
          for (const word of labelWords) {
            if (word.length > 2 && textLower.includes(word)) {
              matches++;
            }
          }
          return matches > 0 ? matches / labelWords.length : 0.1;
        });

        const total = scores.reduce((a: number, b: number) => a + b, 0) || 1;
        const normalizedScores = scores.map((s: number) => s / total);

        return NextResponse.json({
          success: true,
          task,
          classifications: [{
            labels,
            scores: normalizedScores,
          }],
          fallback: true,
        });
      }

      try {
        const result = await hf.zeroShotClassification({
          model: "facebook/bart-large-mnli",
          inputs: text,
          parameters: {
            candidate_labels: labels,
          },
        });

        return NextResponse.json({
          success: true,
          task,
          classifications: Array.isArray(result) ? result : [result],
        });
      } catch (error: any) {
        console.error("[HuggingFace] Zero-shot error:", error);
        const equalScore = 1 / labels.length;
        return NextResponse.json({
          success: true,
          task,
          classifications: [{
            labels,
            scores: labels.map(() => equalScore),
          }],
          fallback: true,
        });
      }
    }

    return NextResponse.json({ error: "Unknown task" }, { status: 400 });

  } catch (error: any) {
    console.error("[HuggingFace] Error:", error);
    return NextResponse.json(
      { error: "Request failed", details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    availableTasks: [
      { task: "summarization", description: "Summarize text" },
      { task: "translation", description: "Translate languages" },
      { task: "sentiment", description: "Analyze sentiment" },
      { task: "qa", description: "Question answering" },
      { task: "generate", description: "Text generation" },
      { task: "zero-shot", description: "Zero-shot classification" },
    ],
  });
}
