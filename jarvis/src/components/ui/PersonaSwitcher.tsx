"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Shield, Moon, Code, Lock } from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";
import {
  VOICE_PROFILES,
  PERSONA_ORDER,
  type PersonaId,
} from "@/lib/persona/voiceProfiles";
import { MANUAL_OVERRIDE_MS } from "@/lib/persona/autoSwitch";

const ICONS: Record<PersonaId, React.ComponentType<{ className?: string }>> = {
  stark: User,
  tactical: Shield,
  whisper: Moon,
  dev: Code,
};

const HUE_CLASS: Record<PersonaId, string> = {
  stark: "text-reactor-core",
  tactical: "text-accent-amber",
  whisper: "text-text-secondary/80",
  dev: "text-accent-green",
};

export default function PersonaSwitcher() {
  const persona = useJarvisStore((s) => s.persona);
  const personaOverride = useJarvisStore((s) => s.personaOverride);
  const personaOverrideExpiresAt = useJarvisStore(
    (s) => s.personaOverrideExpiresAt
  );
  const setPersonaOverride = useJarvisStore((s) => s.setPersonaOverride);

  const [open, setOpen] = useState(false);

  const activeProfile = VOICE_PROFILES[persona];
  const Icon = ICONS[persona];

  const pick = (id: PersonaId) => {
    setPersonaOverride(id, MANUAL_OVERRIDE_MS);
    setOpen(false);
  };

  const clearOverride = () => {
    setPersonaOverride(null);
    setOpen(false);
  };

  const isOverridden =
    personaOverride !== null &&
    personaOverrideExpiresAt !== null &&
    Date.now() < personaOverrideExpiresAt;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors hover:bg-panel-glass/60 ${
          isOverridden ? "border border-accent-amber/40" : ""
        }`}
        title={`Persona: ${activeProfile.label} — ${activeProfile.description}`}
      >
        <Icon className={`w-3.5 h-3.5 ${HUE_CLASS[persona]}`} />
        <span className={`text-[10px] font-orbitron tracking-wider uppercase ${HUE_CLASS[persona]}`}>
          {activeProfile.label}
        </span>
        {isOverridden && (
          <Lock className="w-2.5 h-2.5 text-accent-amber/70" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-1.5 z-50 w-72 bg-deep-space/95 border border-reactor-core/30 rounded-md shadow-[0_0_30px_rgba(0,243,255,0.2)] overflow-hidden"
            >
              <div className="px-3 py-2 border-b border-panel-border/40 text-[10px] font-orbitron text-text-secondary/60 tracking-widest uppercase">
                Persona
              </div>
              <ul className="py-1">
                {PERSONA_ORDER.map((id) => {
                  const p = VOICE_PROFILES[id];
                  const PIcon = ICONS[id];
                  const isActive = persona === id;
                  return (
                    <li key={id}>
                      <button
                        onClick={() => pick(id)}
                        className={`w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-panel-glass/40 transition-colors ${
                          isActive ? "bg-reactor-core/5" : ""
                        }`}
                      >
                        <PIcon
                          className={`w-4 h-4 flex-shrink-0 mt-0.5 ${HUE_CLASS[id]}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs font-orbitron tracking-wide ${HUE_CLASS[id]}`}
                            >
                              {p.label}
                            </span>
                            {isActive && (
                              <span className="text-[9px] font-rajdhani text-reactor-core/80 uppercase">
                                ACTIVE
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-text-secondary/60 font-rajdhani leading-snug mt-0.5">
                            {p.description}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {isOverridden && (
                <div className="px-3 py-2 border-t border-panel-border/40">
                  <button
                    onClick={clearOverride}
                    className="w-full text-[10px] font-rajdhani text-accent-amber/70 hover:text-accent-amber uppercase tracking-wider transition-colors"
                  >
                    Release manual override → return to auto
                  </button>
                </div>
              )}
              <div className="px-3 py-1.5 bg-panel-glass/20 text-[9px] text-text-secondary/40 font-rajdhani">
                Manual override lasts 30 min, then auto-switch resumes.
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}