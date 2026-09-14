// Macro types — the data model for the Record & Replay system.
//
// A Macro is a named sequence of Steps. Each Step is a single browser
// action (navigate, click, type, fill, wait, etc.) that can be replayed.

/** Every possible action the recorder can capture. */
export type StepAction =
  | "goto"          // Navigate to URL
  | "click"         // Click an element
  | "type"          // Type text into an input
  | "fill"          // Set input value directly (for React/controlled inputs)
  | "select"        // Select dropdown value
  | "press"         // Keyboard key press
  | "wait"          // Wait for a selector or timeout
  | "screenshot"    // Take a screenshot
  | "scroll"        // Scroll the page
  | "hover"         // Hover over an element
  | "autofill"      // Ghost Protocol autofill on current page
  | "submit"        // Submit a form
  | "launch"        // Launch a desktop app or URL
  | "focus";        // Bring a window to foreground

export interface MacroStep {
  id: string;
  action: StepAction;
  /** CSS selector or URL depending on action */
  target?: string;
  /** Value to type/fill/select */
  value?: string;
  /** Extra options (timeout, key name, scroll direction, etc.) */
  options?: Record<string, unknown>;
  /** Human-readable description auto-generated during recording */
  description?: string;
  /** Screenshot taken before this step (base64, optional) */
  screenshotBefore?: string;
  /** Duration this step took in ms during last replay */
  lastDurationMs?: number;
  /** Whether this step succeeded during last replay */
  lastSuccess?: boolean;
}

export interface Macro {
  id: string;
  name: string;
  description?: string;
  steps: MacroStep[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /** How many times this macro has been replayed */
  replayCount: number;
  /** Last time this macro was replayed */
  lastReplayedAt?: string;
  /** Tags for organization */
  tags: string[];
  /** Whether this macro is a Ghost Protocol form fill */
  isFormFill: boolean;
  /** The URL this macro targets (if form fill) */
  targetUrl?: string;
  /** Runtime parameters referenced as {{name}} inside steps */
  variables?: MacroVariable[];
}

export interface MacroRecordingSession {
  id: string;
  macroId: string;
  startedAt: string;
  steps: MacroStep[];
  isRecording: boolean;
  /** Playwright page reference (not serialized) */
  pageRef?: unknown;
}

export interface MacroReplayResult {
  macroId: string;
  macroName: string;
  success: boolean;
  totalSteps: number;
  stepsCompleted: number;
  stepsFailed: number;
  durationMs: number;
  results: Array<{
    stepId: string;
    success: boolean;
    error?: string;
    durationMs: number;
    /** How the click/type target was resolved (uia | ocr | window-relative | absolute) */
    resolvedBy?: string;
  }>;
  screenshotPath?: string;
}

/**
 * A named runtime parameter for a macro. Steps reference it as {{name}}
 * (in step.value, step.target, or options.uia.name) and the value is
 * substituted at replay time — one macro, infinite uses.
 */
export interface MacroVariable {
  name: string;
  description?: string;
  defaultValue?: string;
}

/** Serialized form of a macro for storage/transport (no runtime refs). */
export interface StoredMacro extends Omit<Macro, "steps"> {
  steps: Omit<MacroStep, "screenshotBefore">[];
}
