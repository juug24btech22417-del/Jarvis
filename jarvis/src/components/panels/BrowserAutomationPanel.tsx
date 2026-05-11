"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  MousePointer,
  Keyboard,
  Camera,
  Clock,
  Code,
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  Plane,
  ShoppingCart,
  FileText,
  ExternalLink,
} from "lucide-react";

interface WorkflowResult {
  action: string;
  success: boolean;
  data?: string;
}

const WORKFLOWS = [
  {
    id: "search_flight",
    name: "Search Flight",
    icon: Plane,
    description: "Search flights on Google Flights",
    variables: ["origin", "destination"],
  },
  {
    id: "check_price",
    name: "Check Price",
    icon: ShoppingCart,
    description: "Check product price on Amazon",
    variables: ["product"],
  },
  {
    id: "form_fill",
    name: "Fill Form",
    icon: FileText,
    description: "Fill out contact forms",
    variables: ["url", "name", "email", "message"],
  },
];

export default function BrowserAutomationPanel() {
  const [selectedWorkflow, setSelectedWorkflow] = useState(WORKFLOWS[0].id);
  const [variables, setVariables] = useState<Record<string, string>>({
    origin: "NYC",
    destination: "LAX",
  });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WorkflowResult[] | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);

  const handleRun = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: selectedWorkflow,
          variables,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResults(data.results);
        // Find screenshot in results
        const screenshotResult = data.results.find(
          (r: WorkflowResult) => r.action === "screenshot"
        );
        if (screenshotResult?.data) {
          setScreenshot(screenshotResult.data);
        }
      }
    } catch (err) {
      console.error("Browser automation error:", err);
    } finally {
      setLoading(false);
    }
  };

  const currentWorkflow = WORKFLOWS.find((w) => w.id === selectedWorkflow);

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-violet-900/20 to-purple-900/20 rounded-2xl border border-violet-500/30 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-violet-500/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-violet-400">Browser Automation</h3>
            <p className="text-xs text-violet-400/60">Playwright-Powered</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Workflow Selector */}
        <div className="space-y-2">
          <label className="text-violet-400 text-xs font-medium">Select Workflow</label>
          <div className="space-y-2">
            {WORKFLOWS.map((workflow) => (
              <button
                key={workflow.id}
                onClick={() => {
                  setSelectedWorkflow(workflow.id);
                  setResults(null);
                  setScreenshot(null);
                  // Reset variables
                  const newVars: Record<string, string> = {};
                  workflow.variables.forEach((v) => {
                    newVars[v] = variables[v] || "";
                  });
                  setVariables(newVars);
                }}
                className={`w-full p-3 rounded-xl text-left transition-all ${
                  selectedWorkflow === workflow.id
                    ? "bg-violet-500 border-violet-400"
                    : "bg-violet-500/10 border-violet-500/30 hover:bg-violet-500/20"
                } border`}
              >
                <div className="flex items-center gap-3">
                  <workflow.icon className="w-5 h-5 text-violet-300" />
                  <div>
                    <p className="font-medium text-white">{workflow.name}</p>
                    <p className="text-xs text-violet-300/60">{workflow.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Variables Input */}
        {currentWorkflow && (
          <div className="space-y-3">
            <label className="text-violet-400 text-xs font-medium">Variables</label>
            {currentWorkflow.variables.map((variable) => (
              <div key={variable}>
                <label className="text-violet-300/60 text-xs mb-1 block capitalize">
                  {variable}
                </label>
                <input
                  type="text"
                  value={variables[variable] || ""}
                  onChange={(e) =>
                    setVariables({ ...variables, [variable]: e.target.value })
                  }
                  placeholder={`Enter ${variable}...`}
                  className="w-full px-4 py-2 bg-violet-500/10 border border-violet-500/30 rounded-xl text-white placeholder-violet-400/40 focus:border-violet-400 focus:outline-none text-sm"
                />
              </div>
            ))}

            <button
              onClick={handleRun}
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 hover:from-violet-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Running Automation...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Run Workflow
                </>
              )}
            </button>
          </div>
        )}

        {/* Results */}
        {results && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Screenshot */}
            {screenshot && (
              <div className="bg-violet-500/5 rounded-xl overflow-hidden border border-violet-500/20">
                <div className="p-2 border-b border-violet-500/20 flex items-center justify-between">
                  <span className="text-xs font-medium text-violet-400">Screenshot</span>
                  <a
                    href={screenshot}
                    download
                    className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Download
                  </a>
                </div>
                <img
                  src={screenshot}
                  alt="Automation Result"
                  className="w-full"
                />
              </div>
            )}

            {/* Action Results */}
            <div className="bg-violet-500/5 rounded-xl p-4 border border-violet-500/20">
              <h5 className="text-sm font-medium text-violet-400 mb-3">
                Action Log
              </h5>
              <div className="space-y-2">
                {results.map((result, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 p-2 bg-violet-500/10 rounded-lg"
                  >
                    {result.success ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className="text-sm text-violet-100 capitalize">
                      {result.action}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Info */}
        {!results && (
          <div className="bg-violet-500/5 rounded-xl p-4 border border-violet-500/20">
            <h4 className="text-sm font-medium text-violet-400 mb-3">
              Capabilities
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: MousePointer, label: "Click Elements" },
                { icon: Keyboard, label: "Fill Forms" },
                { icon: Camera, label: "Take Screenshots" },
                { icon: Clock, label: "Wait & Timeout" },
                { icon: Code, label: "Run JavaScript" },
                { icon: Globe, label: "Navigate URLs" },
              ].map((cap) => (
                <div
                  key={cap.label}
                  className="flex items-center gap-2 p-2 bg-violet-500/10 rounded-lg"
                >
                  <cap.icon className="w-4 h-4 text-violet-400" />
                  <span className="text-xs text-violet-100/70">{cap.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
