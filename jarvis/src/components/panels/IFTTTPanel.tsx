"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  BookOpen,
  CheckSquare,
  Mail,
  FileSpreadsheet,
  Bell,
  AtSign,
  Calendar,
  Send,
  Loader2,
  ExternalLink,
  Check,
  AlertCircle,
} from "lucide-react";

const APPLETS = [
  { id: "save_to_notion", name: "Save to Notion", icon: BookOpen, color: "text-purple-400" },
  { id: "add_todoist_task", name: "Add Todoist Task", icon: CheckSquare, color: "text-red-400" },
  { id: "send_email", name: "Send Email", icon: Mail, color: "text-blue-400" },
  { id: "log_to_sheets", name: "Log to Sheets", icon: FileSpreadsheet, color: "text-green-400" },
  { id: "send_notification", name: "Notification", icon: Bell, color: "text-yellow-400" },
  { id: "tweet", name: "Post Tweet", icon: AtSign, color: "text-sky-400" },
  { id: "create_calendar_event", name: "Calendar Event", icon: Calendar, color: "text-indigo-400" },
];

export default function IFTTTPanel() {
  const [selectedApplet, setSelectedApplet] = useState(APPLETS[0].id);
  const [value1, setValue1] = useState("");
  const [value2, setValue2] = useState("");
  const [value3, setValue3] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const handleTrigger = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ifttt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applet: selectedApplet,
          values: {
            value1,
            ...(value2 && { value2 }),
            ...(value3 && { value3 }),
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: data.message });
      } else {
        if (data.setup || data.error?.includes("key")) {
          setShowSetup(true);
        }
        setResult({ success: false, message: data.error || "Failed" });
      }
    } catch (err) {
      setResult({ success: false, message: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const currentApplet = APPLETS.find((a) => a.id === selectedApplet);

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-indigo-900/20 to-blue-900/20 rounded-2xl border border-indigo-500/30 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-indigo-500/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-indigo-400">IFTTT Automation</h3>
            <p className="text-xs text-indigo-400/60">Connect Your Apps</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Applet Selector */}
        <div className="grid grid-cols-2 gap-2">
          {APPLETS.map((applet) => (
            <button
              key={applet.id}
              onClick={() => {
                setSelectedApplet(applet.id);
                setValue1("");
                setValue2("");
                setValue3("");
                setResult(null);
              }}
              className={`p-3 rounded-xl text-left transition-all border ${
                selectedApplet === applet.id
                  ? "bg-indigo-500 border-indigo-400"
                  : "bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <applet.icon className={`w-4 h-4 ${applet.color}`} />
                <span className="text-xs font-medium text-white">{applet.name}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Setup Warning */}
        {showSetup && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-medium text-yellow-400 mb-2">Setup Required</h4>
                <ol className="text-xs text-yellow-100/70 space-y-1 list-decimal list-inside">
                  <li>Go to ifttt.com/maker_webhooks</li>
                  <li>Click &ldquo;Documentation&rdquo; and copy your key</li>
                  <li>Add to .env.local: IFTTT_WEBHOOK_KEY=your_key</li>
                  <li>Create applets with matching event names</li>
                </ol>
                <a
                  href="https://ifttt.com/maker_webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-xs text-yellow-400 hover:underline"
                >
                  Open IFTTT Webhooks
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Value Inputs */}
        <div className="space-y-3">
          <div>
            <label className="text-indigo-400 text-xs font-medium mb-1 block">
              {selectedApplet === "save_to_notion" && "Article URL"}
              {selectedApplet === "add_todoist_task" && "Task Name"}
              {selectedApplet === "send_email" && "Subject"}
              {selectedApplet === "log_to_sheets" && "Data to Log"}
              {selectedApplet === "send_notification" && "Message"}
              {selectedApplet === "tweet" && "Tweet Text"}
              {selectedApplet === "create_calendar_event" && "Event Title"}
            </label>
            <input
              type="text"
              value={value1}
              onChange={(e) => setValue1(e.target.value)}
              placeholder="Enter value..."
              className="w-full px-4 py-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-white placeholder-indigo-400/40 focus:border-indigo-400 focus:outline-none"
            />
          </div>

          {["send_email", "create_calendar_event"].includes(selectedApplet) && (
            <div>
              <label className="text-indigo-400 text-xs font-medium mb-1 block">
                {selectedApplet === "send_email" ? "Email Body" : "Event Date"}
              </label>
              {
                selectedApplet === "send_email" ? (
                  <textarea
                    value={value2}
                    onChange={(e) => setValue2(e.target.value)}
                    placeholder="Enter message..."
                    className="w-full h-20 px-4 py-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-white placeholder-indigo-400/40 focus:border-indigo-400 focus:outline-none resize-none"
                  />
                ) : (
                  <input
                    type="datetime-local"
                    value={value2}
                    onChange={(e) => setValue2(e.target.value)}
                    className="w-full px-4 py-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-white focus:border-indigo-400 focus:outline-none"
                  />
                )
              }
            </div>
          )}

          <button
            onClick={handleTrigger}
            disabled={loading || !value1}
            className="w-full py-3 bg-gradient-to-r from-indigo-500 to-blue-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 hover:from-indigo-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Triggering...
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                Trigger {currentApplet?.name}
              </>
            )}
          </button>
        </div>

        {/* Result */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-xl border ${
              result.success
                ? "bg-green-500/10 border-green-500/30"
                : "bg-red-500/10 border-red-500/30"
            }`}
          >
            <div className="flex items-center gap-3">
              {result.success ? (
                <Check className="w-5 h-5 text-green-400" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400" />
              )}
              <p className={result.success ? "text-green-100" : "text-red-100"}>
                {result.message}
              </p>
            </div>
          </motion.div>
        )}

        {/* Info */}
        {!result && (
          <div className="bg-indigo-500/5 rounded-xl p-4 border border-indigo-500/20">
            <h4 className="text-sm font-medium text-indigo-400 mb-2">
              How It Works
            </h4>
            <p className="text-xs text-indigo-100/60">
              IFTTT (If This Then That) connects different apps. Create applets
              on IFTTT, then trigger them from JARVIS.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
