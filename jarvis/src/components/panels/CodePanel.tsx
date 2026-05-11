"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, Download, FileCode } from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";
import { useState } from "react";

// Simple syntax highlighting function
function highlightCode(code: string, language: string): string {
  // Replace HTML entities
  let highlighted = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Basic syntax highlighting
  if (language === "javascript" || language === "typescript" || language === "js") {
    // Keywords
    highlighted = highlighted.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|new|this)\b/g, '<span style="color: #FF79C6;">$1</span>');
    // Functions
    highlighted = highlighted.replace(/(\w+)(\s*\()/g, '<span style="color: #50FA7B;">$1</span>$2');
    // Strings
    highlighted = highlighted.replace(/(".*?"|'.*?'|`.*?`)/g, '<span style="color: #F1FA8C;">$1</span>');
    // Comments
    highlighted = highlighted.replace(/(\/\/.*$)/gm, '<span style="color: #6272A4;">$1</span>');
  } else if (language === "python" || language === "py") {
    // Keywords
    highlighted = highlighted.replace(/\b(def|class|return|if|else|elif|for|while|import|from|try|except|with|as|lambda|None|True|False)\b/g, '<span style="color: #FF79C6;">$1</span>');
    // Functions
    highlighted = highlighted.replace(/(\w+)(\s*\()/g, '<span style="color: #50FA7B;">$1</span>$2');
    // Strings
    highlighted = highlighted.replace(/(".*?"|'.*?'|""".*?"""|'''.*?''')/g, '<span style="color: #F1FA8C;">$1</span>');
    // Comments
    highlighted = highlighted.replace(/(#.*$)/gm, '<span style="color: #6272A4;">$1</span>');
  } else if (language === "html" || language === "css") {
    // Tags
    highlighted = highlighted.replace(/(&lt;\/?[\w-]+)/g, '<span style="color: #FF79C6;">$1</span>');
    // Attributes
    highlighted = highlighted.replace(/(\w+)=/g, '<span style="color: #50FA7B;">$1</span>=');
    // Strings
    highlighted = highlighted.replace(/(".*?")/g, '<span style="color: #F1FA8C;">$1</span>');
  }

  return highlighted;
}

export default function CodePanel() {
  const { generatedCode, clearGeneratedCode, activePanel, setActivePanel } = useJarvisStore();
  const [copied, setCopied] = useState(false);

  if (activePanel !== "code" || !generatedCode) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy errors
    }
  };

  const handleDownload = () => {
    const extension = getFileExtension(generatedCode.language);
    const filename = `generated-code.${extension}`;
    const blob = new Blob([generatedCode.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getFileExtension = (lang: string): string => {
    const extensions: Record<string, string> = {
      javascript: "js",
      typescript: "ts",
      python: "py",
      html: "html",
      css: "css",
      java: "java",
      cpp: "cpp",
      c: "c",
      csharp: "cs",
      go: "go",
      rust: "rs",
      ruby: "rb",
      php: "php",
      swift: "swift",
      kotlin: "kt",
      sql: "sql",
      json: "json",
      xml: "xml",
      yaml: "yml",
      markdown: "md",
    };
    return extensions[lang.toLowerCase()] || "txt";
  };

  const highlightedCode = highlightCode(generatedCode.code, generatedCode.language);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed top-20 right-4 z-40 w-[600px] max-h-[80vh] bg-slate-900/95 border border-cyan-500/30 rounded-lg overflow-hidden shadow-2xl shadow-cyan-500/20"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-cyan-500/20">
          <div className="flex items-center gap-2">
            <FileCode className="w-5 h-5 text-cyan-400" />
            <div>
              <p className="text-sm text-cyan-400 font-medium">
                Generated {generatedCode.language.toUpperCase()} Code
              </p>
              {generatedCode.description && (
                <p className="text-xs text-cyan-400/60">{generatedCode.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-2 hover:bg-cyan-500/20 rounded transition-colors group"
              title="Copy to clipboard"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4 text-cyan-400 group-hover:text-cyan-300" />
              )}
            </button>
            <button
              onClick={handleDownload}
              className="p-2 hover:bg-cyan-500/20 rounded transition-colors group"
              title="Download file"
            >
              <Download className="w-4 h-4 text-cyan-400 group-hover:text-cyan-300" />
            </button>
            <button
              onClick={() => {
                setActivePanel(null);
                clearGeneratedCode();
              }}
              className="p-2 hover:bg-red-500/20 rounded transition-colors group"
              title="Close"
            >
              <X className="w-4 h-4 text-cyan-400 group-hover:text-red-400" />
            </button>
          </div>
        </div>

        {/* Code Display */}
        <div className="p-4 overflow-auto max-h-[60vh]">
          <pre
            className="font-mono text-sm text-gray-300 leading-relaxed whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-slate-800/60 border-t border-cyan-500/20 text-xs text-cyan-400/50">
          Press the copy button to copy code to clipboard
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
