"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Image,
  Wand2,
  Download,
  RefreshCw,
  Loader2,
  Sparkles,
  Palette,
} from "lucide-react";

interface GeneratedImage {
  url: string;
  prompt: string;
  provider: string;
}

const STYLE_PRESETS = [
  { name: "Minimalist", prompt: "minimalist, clean design, simple colors" },
  { name: "Futuristic", prompt: "futuristic, sci-fi, neon lights, high tech" },
  { name: "Vintage", prompt: "vintage, retro, aged, classic style" },
  { name: "Abstract", prompt: "abstract art, colorful, artistic, creative" },
  { name: "Realistic", prompt: "photorealistic, detailed, 8k, professional" },
  { name: "Cartoon", prompt: "cartoon style, colorful, playful, animated" },
];

export default function ImageGeneratorPanel() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

  const generateImage = async () => {
    if (!prompt) return;
    setLoading(true);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          provider: "pollinations",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedImage({
          url: data.imageUrl,
          prompt,
          provider: data.provider,
        });
      }
    } catch (err) {
      console.error("Failed to generate image:", err);
    } finally {
      setLoading(false);
    }
  };

  const applyStyle = (style: typeof STYLE_PRESETS[0]) => {
    setSelectedStyle(style.name);
    setPrompt((prev) => {
      const basePrompt = prev.replace(
        /,\s*(minimalist|futuristic|vintage|abstract|realistic|cartoon).*$/i,
        ""
    );
      return `${basePrompt}, ${style.prompt}`;
    });
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-purple-900/20 to-pink-900/20 rounded-2xl border border-fuchsia-500/30 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-fuchsia-500/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 flex items-center justify-center">
            <Wand2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-fuchsia-400">Visual Idea Generator</h3>
            <p className="text-xs text-fuchsia-400/60">AI-Powered Image Creation</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Prompt Input */}
        <div className="space-y-3">
          <div className="relative">
            <Sparkles className="absolute left-4 top-3.5 w-5 h-5 text-fuchsia-400/60" />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your image idea... e.g., A minimalist coffee shop logo with steam rising from a cup, earth tones, modern design"
              className="w-full h-24 pl-12 pr-4 py-3 bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-xl text-white placeholder-fuchsia-400/40 focus:border-fuchsia-400 focus:outline-none resize-none"
            />
          </div>

          {/* Style Presets */}
          <div>
            <label className="text-fuchsia-400/60 text-xs font-medium mb-2 block flex items-center gap-1">
              <Palette className="w-3 h-3" />
              Style Presets
            </label>
            <div className="flex flex-wrap gap-2">
              {STYLE_PRESETS.map((style) => (
                <button
                  key={style.name}
                  onClick={() => applyStyle(style)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedStyle === style.name
                      ? "bg-fuchsia-500 text-white"
                      : "bg-fuchsia-500/10 text-fuchsia-400 hover:bg-fuchsia-500/20"
                  }`}
                >
                  {style.name}
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={generateImage}
            disabled={loading || !prompt}
            className="w-full py-3 bg-gradient-to-r from-fuchsia-500 to-pink-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 hover:from-fuchsia-400 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Image className="w-5 h-5" />
                Generate Image
              </>
            )}
          </button>
        </div>

        {/* Generated Image */}
        {generatedImage && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-3"
          >
            <div className="relative group">
              <img
                src={generatedImage.url}
                alt={generatedImage.prompt}
                className="w-full rounded-xl border border-fuchsia-500/30"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center gap-2">
                <a
                  href={generatedImage.url}
                  download
                  className="p-2 bg-white/20 rounded-lg text-white hover:bg-white/30 transition-all"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="w-5 h-5" />
                </a>
                <button
                  onClick={() => setGeneratedImage(null)}
                  className="p-2 bg-white/20 rounded-lg text-white hover:bg-white/30 transition-all"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="bg-fuchsia-500/10 rounded-lg p-3 border border-fuchsia-500/20">
              <p className="text-xs text-fuchsia-400/60 mb-1">Prompt</p>
              <p className="text-sm text-fuchsia-100/80">{generatedImage.prompt}</p>
              <p className="text-xs text-fuchsia-400/40 mt-2">
                Provider: {generatedImage.provider}
              </p>
            </div>
          </motion.div>
        )}

        {/* Tips */}
        {!generatedImage && (
          <div className="bg-fuchsia-500/5 rounded-xl p-4 border border-fuchsia-500/20">
            <h4 className="text-sm font-medium text-fuchsia-400 mb-3">
              Tips for Better Results
            </h4>
            <ul className="space-y-2 text-xs text-fuchsia-100/60">
              <li>• Be specific: "modern minimalist coffee shop logo" vs "logo"</li>
              <li>• Include style: "digital art", "photorealistic", "oil painting"</li>
              <li>• Add details: "soft lighting", "vibrant colors", "4k resolution"</li>
              <li>• Mention composition: "wide shot", "close-up", "symmetrical"</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
