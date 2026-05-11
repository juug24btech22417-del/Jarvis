"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, X, History, Keyboard, Trash2 } from "lucide-react";
import gsap from "gsap";

interface Calculation {
  id: string;
  expression: string;
  result: string;
  timestamp: number;
}

// Storage key for localStorage
const CALCULATOR_HISTORY_KEY = "jarvis_calculator_history";

export function useCalculatorHistory() {
  const [calculations, setCalculations] = useState<Calculation[]>([]);
  const [lastCalculation, setLastCalculation] = useState<Calculation | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CALCULATOR_HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCalculations(parsed);
          setLastCalculation(parsed[0] || null);
        }
      }
    } catch (e) {
      console.error("Failed to load calculator history:", e);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage whenever calculations change
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(CALCULATOR_HISTORY_KEY, JSON.stringify(calculations));
      } catch (e) {
        console.error("Failed to save calculator history:", e);
      }
    }
  }, [calculations, isLoaded]);

  const addCalculation = useCallback((expression: string, result: string) => {
    const calc: Calculation = {
      id: Math.random().toString(36).slice(2),
      expression,
      result,
      timestamp: Date.now(),
    };
    setLastCalculation(calc);
    setCalculations((prev) => [calc, ...prev].slice(0, 50)); // Keep last 50
  }, []);

  const clearHistory = useCallback(() => {
    setCalculations([]);
    setLastCalculation(null);
    localStorage.removeItem(CALCULATOR_HISTORY_KEY);
  }, []);

  const deleteCalculation = useCallback((id: string) => {
    setCalculations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (lastCalculation?.id === id) {
        setLastCalculation(filtered[0] || null);
      }
      return filtered;
    });
  }, [lastCalculation]);

  return {
    calculations,
    lastCalculation,
    isLoaded,
    addCalculation,
    clearHistory,
    deleteCalculation,
  };
}

export function CalculatorDisplay({
  lastCalculation,
  calculations,
  onClear,
  onDelete,
}: {
  lastCalculation: Calculation | null;
  calculations: Calculation[];
  onClear: () => void;
  onDelete?: (id: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Animate result on change
  useEffect(() => {
    if (resultRef.current && lastCalculation) {
      gsap.fromTo(
        resultRef.current,
        { scale: 0.8, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(1.7)" }
      );
    }
  }, [lastCalculation]);

  // Animate panel on mount
  useEffect(() => {
    if (panelRef.current) {
      gsap.fromTo(
        panelRef.current,
        { x: 50, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.4, ease: "power2.out" }
      );
    }
  }, []);

  if (!lastCalculation) return null;

  return (
    <>
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed top-24 right-6 z-40 w-72"
      >
        <div className="holographic-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-reactor-core" />
              <span className="font-orbitron text-reactor-core font-bold text-sm">
                CALCULATOR
              </span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setShowShortcuts(!showShortcuts)}
                className="p-1.5 hover:bg-reactor-core/20 rounded transition-colors"
                title="Keyboard shortcuts"
              >
                <Keyboard className="w-4 h-4 text-text-secondary" />
              </button>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="p-1.5 hover:bg-reactor-core/20 rounded transition-colors"
                title="Toggle history"
              >
                <History className="w-4 h-4 text-text-secondary" />
              </button>
              <button
                onClick={onClear}
                className="p-1.5 hover:bg-accent-red/20 rounded transition-colors"
                title="Clear history"
              >
                <X className="w-4 h-4 text-accent-red" />
              </button>
            </div>
          </div>

          {/* Keyboard Shortcuts Panel */}
          <AnimatePresence>
            {showShortcuts && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-3 p-3 bg-panel-glass/50 rounded-lg border border-panel-border overflow-hidden"
              >
                <h4 className="font-orbitron text-xs text-reactor-core mb-2">
                  KEYBOARD SHORTCUTS
                </h4>
                <div className="space-y-1 text-xs font-rajdhani">
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Enter</span>
                    <span className="text-reactor-core">Calculate</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Escape</span>
                    <span className="text-reactor-core">Clear/Stop</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Ctrl+H</span>
                    <span className="text-reactor-core">Toggle History</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Ctrl+K</span>
                    <span className="text-reactor-core">Shortcuts</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Last Calculation */}
          <div className="bg-panel-glass/50 p-3 rounded-lg border border-panel-border mb-3">
            <div
              className="text-xs text-text-secondary mb-1 truncate"
              title={lastCalculation.expression}
            >
              {lastCalculation.expression.length > 35
                ? lastCalculation.expression.slice(0, 35) + "..."
                : lastCalculation.expression}
            </div>
            <div
              ref={resultRef}
              className="font-orbitron text-2xl text-reactor-core text-right"
            >
              = {lastCalculation.result}
            </div>
          </div>

          {/* History */}
          <AnimatePresence>
            {showHistory && calculations.length > 1 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-2 max-h-56 overflow-y-auto"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-secondary/50">
                    {calculations.length - 1} previous calculations
                  </span>
                  <button
                    onClick={onClear}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-accent-red hover:bg-accent-red/10 rounded transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear All
                  </button>
                </div>

                {calculations.slice(1).map((calc, index) => (
                  <motion.div
                    key={calc.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-panel-glass/30 p-2 rounded-lg border border-panel-border/50 text-sm group hover:border-reactor-core/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-text-secondary/70 text-xs truncate">
                          {calc.expression}
                        </div>
                        <div className="text-reactor-core/80 font-orbitron text-right">
                          = {calc.result}
                        </div>
                      </div>
                      <button
                        onClick={() => onDelete?.(calc.id)}
                        className="ml-2 p-1 opacity-0 group-hover:opacity-100 hover:bg-accent-red/20 rounded transition-all"
                        title="Delete"
                      >
                        <X className="w-3 h-3 text-accent-red" />
                      </button>
                    </div>
                    <div className="text-[10px] text-text-secondary/40 mt-1">
                      {new Date(calc.timestamp).toLocaleTimeString()}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer */}
          <div className="mt-3 pt-2 border-t border-panel-border">
            <p className="text-[10px] text-text-secondary/40 text-center">
              {showHistory
                ? "Click calculation to use result"
                : "Press Ctrl+H for history"}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Keyboard Shortcut Help Toast */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50"
          >
            <div className="holographic-panel px-4 py-2">
              <p className="text-xs text-text-secondary">
                <span className="text-reactor-core font-bold">Tip:</span>{" "}
                Type math expressions directly in the command bar!
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Quick calculator button for manual entry
export function CalculatorButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="p-2 rounded-full bg-panel-glass hover:bg-reactor-core/20 transition-colors"
      title="Open calculator"
    >
      <Calculator className="w-4 h-4 text-reactor-core" />
    </motion.button>
  );
}

export default CalculatorDisplay;
