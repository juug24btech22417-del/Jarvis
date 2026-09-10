"use client";

import { useState } from "react";
import { useJarvisStore } from "@/store/jarvis.store";

interface Props {
  onDone: (greeting: string) => void;
}

interface OnboardQuestion {
  key: Key;
  label: string;
  placeholder: string;
  hint?: string;
  optional?: boolean;
}

type Key = "name" | "work" | "goals" | "callHim" | "people" | "interests";

const QUESTIONS: OnboardQuestion[] = [
  {
    key: "name",
    label: "First, your name.",
    placeholder: "Dhruv",
  },
  {
    key: "work",
    label: "What do you do — work, study, building something?",
    placeholder: "Interning at CodeAlpha, final year CS",
  },
  {
    key: "goals",
    label: "What are you chasing right now? Main goals.",
    placeholder: "Crack a full-time offer, ship IronGrid",
    optional: true,
  },
  {
    key: "callHim",
    label: "What should I call you?",
    placeholder: "Boss",
    hint: "Boss, Sir, or your name — your call.",
  },
  {
    key: "people",
    label: "Who matters most right now? (comma separated)",
    placeholder: "dad, Rahul, Ananya",
    hint: "I'll quietly remember — and occasionally ask about them.",
    optional: true,
  },
  {
    key: "interests",
    label: "What do you do when you're not working?",
    placeholder: "Cricket, space documentaries, lo-fi",
    optional: true,
  },
];

export default function OnboardingModal({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<Key, string>>({
    name: "",
    work: "",
    goals: "",
    callHim: "",
    people: "",
    interests: "",
  });
  const [saving, setSaving] = useState(false);
  const addMessage = useJarvisStore((s) => s.addMessage);

  const q = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;

  const next = async () => {
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/companion/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers),
      });
      const data = await res.json();
      const name = answers.name.trim() || "Boss";
      const callHim = answers.callHim.trim() || "Boss";
      const closing = `Profile saved, ${callHim}. I know your name, your work${answers.goals.trim() ? ", what you're chasing" : ""}${
        answers.people.trim() ? ", and the people who matter" : ""
      }. From here on, I'm not just running protocols — I'm with you, ${name.split(" ")[0]}.`;

      addMessage({ role: "assistant", content: closing });
      onDone(closing);
    } catch {
      onDone("Profile saved locally. We can finish introductions later, Boss.");
    } finally {
      setSaving(false);
    }
  };

  const back = () => setStep((s) => Math.max(0, s - 1));
  const skip = () => next(); // optional questions can be skipped

  const val = answers[q.key];
  const canProceed = q.optional || val.trim().length > 0 || q.key === "callHim";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-8 shadow-[0_0_60px_rgba(6,182,212,0.15)]">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
          <span className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">
            Initial Calibration
          </span>
          <span className="ml-auto text-xs text-slate-500">
            {step + 1} / {QUESTIONS.length}
          </span>
        </div>

        <p className="mb-2 text-lg text-slate-100">{q.label}</p>
        {q.hint && <p className="mb-4 text-sm text-slate-500">{q.hint}</p>}
        {!q.hint && <div className="mb-4" />}

        <input
          autoFocus
          value={val}
          onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canProceed) next();
          }}
          placeholder={q.placeholder}
          className="w-full rounded-lg border border-cyan-500/20 bg-slate-900/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60"
        />

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={back}
            disabled={step === 0}
            className="text-sm text-slate-500 transition hover:text-slate-300 disabled:opacity-30"
          >
            ← Back
          </button>
          <div className="flex items-center gap-3">
            {q.optional && (
              <button
                onClick={skip}
                className="text-sm text-slate-500 transition hover:text-slate-300"
              >
                Skip
              </button>
            )}
            <button
              onClick={next}
              disabled={!canProceed || saving}
              className="rounded-lg bg-cyan-500/90 px-5 py-2 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-40"
            >
              {saving ? "Saving…" : isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
