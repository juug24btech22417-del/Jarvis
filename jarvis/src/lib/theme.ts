// Ultra-immersive theme system for JARVIS
// Each theme completely transforms the entire UI experience

export type ThemeId = "arc-blue" | "batman" | "stealth" | "ironman" | "crimson" | "quantum";

// Font style options
export type FontStyle = "tech" | "gothic" | "elegant" | "futuristic";

// Reactor geometry types
export type ReactorGeometry = "classic-arc" | "bat-symbol" | "iron-arc" | "quantum-orb";

export interface ThemeConfig {
  // Identity
  name: string;
  description: string;

  // Font styling
  fontStyle: FontStyle;
  fontFamily: string;

  // Core color palette
  colors: {
    primary: string;      // Main accent
    secondary: string;    // Secondary accent
    accent: string;       // Highlights
    glow: string;         // Glow effects
    dim: string;          // Subtle elements
    danger: string;       // Errors/warnings
    success: string;      // Success states
  };

  // Reactor specific colors
  reactor: {
    core: string;
    coreEmissive: string;
    innerRing: string;
    middleRing: string;
    outerRing: string;
    particle: string;
    ambient: string;
    geometry: ReactorGeometry;
  };

  // Background gradient stops
  background: {
    gradientFrom: string;
    gradientVia: string;
    gradientTo: string;
    particleOpacity: number;
    scanLineOpacity: number;
  };

  // UI Panel styling
  panels: {
    glass: string;
    border: string;
    borderGlow: string;
    textPrimary: string;
    textSecondary: string;
    bracketColor: string;
  };

  // Typography glow effects
  typography: {
    headingGlow: string;
    textGlow: string;
    intensity: number;
  };

  // Special effects
  effects: {
    fogColor: string;
    fogDensity: number;
    bloomStrength: number;
    scanSpeed: number;
    pulseSpeed: number;
  };

  // Status colors
  status: {
    online: string;
    offline: string;
    warning: string;
    error: string;
  };
}

// ===== THEME DEFINITIONS =====

export const REACTOR_THEMES: Record<ThemeId, ThemeConfig> = {
  // === ARC BLUE === Classic JARVIS
  "arc-blue": {
    name: "Arc Reactor",
    description: "Classic Stark Industries interface",
    fontStyle: "tech",
    fontFamily: "'Rajdhani', sans-serif",

    colors: {
      primary: "#00D4FF",
      secondary: "#00B4E6",
      accent: "#7DF9FF",
      glow: "#7DF9FF",
      dim: "#004466",
      danger: "#FF2D55",
      success: "#00FF9D",
    },

    reactor: {
      core: "#00D4FF",
      coreEmissive: "#00AADD",
      innerRing: "#00D4FF",
      middleRing: "#00B4E6",
      outerRing: "#0099CC",
      particle: "#00D4FF",
      ambient: "#001122",
      geometry: "classic-arc",
    },

    background: {
      gradientFrom: "#020810",
      gradientVia: "#051020",
      gradientTo: "#020810",
      particleOpacity: 0.6,
      scanLineOpacity: 0.03,
    },

    panels: {
      glass: "rgba(0, 180, 255, 0.06)",
      border: "rgba(0, 212, 255, 0.3)",
      borderGlow: "rgba(0, 212, 255, 0.1)",
      textPrimary: "#E8F4FF",
      textSecondary: "#7EB8D4",
      bracketColor: "#00D4FF",
    },

    typography: {
      headingGlow: "0 0 20px rgba(0, 212, 255, 0.5), 0 0 40px rgba(0, 212, 255, 0.3)",
      textGlow: "0 0 10px rgba(0, 212, 255, 0.3)",
      intensity: 1,
    },

    effects: {
      fogColor: "#00D4FF",
      fogDensity: 0.02,
      bloomStrength: 1.5,
      scanSpeed: 1,
      pulseSpeed: 1,
    },

    status: {
      online: "#00FF9D",
      offline: "#FF2D55",
      warning: "#FF6B2B",
      error: "#FF2D55",
    },
  },

  // === BATMAN === Dark and brooding
  "batman": {
    name: "Dark Knight",
    description: "The Gotham City vigilante interface",
    fontStyle: "gothic",
    fontFamily: "'Orbitron', sans-serif",

    colors: {
      primary: "#FFD700",
      secondary: "#B8860B",
      accent: "#FFA500",
      glow: "#FFD700",
      dim: "#2A2A00",
      danger: "#FF4500",
      success: "#9ACD32",
    },

    reactor: {
      core: "#FFD700",
      coreEmissive: "#B8860B",
      innerRing: "#FFD700",
      middleRing: "#DAA520",
      outerRing: "#8B6914",
      particle: "#FFD700",
      ambient: "#111111",
      geometry: "bat-symbol",
    },

    background: {
      gradientFrom: "#0A0A0A",
      gradientVia: "#1A1A1A",
      gradientTo: "#0A0A0A",
      particleOpacity: 0.4,
      scanLineOpacity: 0.02,
    },

    panels: {
      glass: "rgba(255, 215, 0, 0.05)",
      border: "rgba(255, 215, 0, 0.25)",
      borderGlow: "rgba(255, 215, 0, 0.08)",
      textPrimary: "#FFD700",
      textSecondary: "#B8860B",
      bracketColor: "#FFD700",
    },

    typography: {
      headingGlow: "0 0 20px rgba(255, 215, 0, 0.4), 0 0 40px rgba(255, 215, 0, 0.2)",
      textGlow: "0 0 8px rgba(255, 215, 0, 0.2)",
      intensity: 0.9,
    },

    effects: {
      fogColor: "#1A1A1A",
      fogDensity: 0.05,
      bloomStrength: 1.2,
      scanSpeed: 0.5,
      pulseSpeed: 0.7,
    },

    status: {
      online: "#9ACD32",
      offline: "#FF4500",
      warning: "#FFA500",
      error: "#FF4500",
    },
  },

  // === STEALTH === Covert ops
  "stealth": {
    name: "Stealth Mode",
    description: "Invisible to detection",
    fontStyle: "tech",
    fontFamily: "'Rajdhani', sans-serif",

    colors: {
      primary: "#88CC00",
      secondary: "#669900",
      accent: "#AADD55",
      glow: "#88CC00",
      dim: "#1A3300",
      danger: "#CC3300",
      success: "#88CC00",
    },

    reactor: {
      core: "#88CC00",
      coreEmissive: "#669900",
      innerRing: "#88CC00",
      middleRing: "#669900",
      outerRing: "#447700",
      particle: "#88CC00",
      ambient: "#051005",
      geometry: "classic-arc",
    },

    background: {
      gradientFrom: "#051005",
      gradientVia: "#0A1A0A",
      gradientTo: "#051005",
      particleOpacity: 0.5,
      scanLineOpacity: 0.02,
    },

    panels: {
      glass: "rgba(136, 204, 0, 0.04)",
      border: "rgba(136, 204, 0, 0.2)",
      borderGlow: "rgba(136, 204, 0, 0.05)",
      textPrimary: "#AADD88",
      textSecondary: "#779955",
      bracketColor: "#88CC00",
    },

    typography: {
      headingGlow: "0 0 15px rgba(136, 204, 0, 0.3)",
      textGlow: "none",
      intensity: 0.7,
    },

    effects: {
      fogColor: "#051005",
      fogDensity: 0.08,
      bloomStrength: 0.8,
      scanSpeed: 0.3,
      pulseSpeed: 0.5,
    },

    status: {
      online: "#88CC00",
      offline: "#CC3300",
      warning: "#CC9900",
      error: "#CC3300",
    },
  },

  // === IRON MAN === Red and gold
  "ironman": {
    name: "Mark 85",
    description: "Tony Stark's signature interface",
    fontStyle: "elegant",
    fontFamily: "'Orbitron', sans-serif",

    colors: {
      primary: "#FF3131",
      secondary: "#FFD700",
      accent: "#FF6B6B",
      glow: "#FFD700",
      dim: "#330000",
      danger: "#FF0000",
      success: "#FFD700",
    },

    reactor: {
      core: "#FFFFFF",
      coreEmissive: "#00D4FF",
      innerRing: "#FF3131",
      middleRing: "#FFD700",
      outerRing: "#CC0000",
      particle: "#FFD700",
      ambient: "#220000",
      geometry: "iron-arc",
    },

    background: {
      gradientFrom: "#1A0000",
      gradientVia: "#2A0000",
      gradientTo: "#1A0000",
      particleOpacity: 0.7,
      scanLineOpacity: 0.04,
    },

    panels: {
      glass: "rgba(255, 49, 49, 0.08)",
      border: "rgba(255, 49, 49, 0.4)",
      borderGlow: "rgba(255, 49, 49, 0.15)",
      textPrimary: "#FFD700",
      textSecondary: "#FFA07A",
      bracketColor: "#FFD700",
    },

    typography: {
      headingGlow: "0 0 20px rgba(255, 215, 0, 0.5), 0 0 40px rgba(255, 49, 49, 0.3)",
      textGlow: "0 0 8px rgba(255, 215, 0, 0.3)",
      intensity: 1.1,
    },

    effects: {
      fogColor: "#FF3131",
      fogDensity: 0.03,
      bloomStrength: 2,
      scanSpeed: 1.2,
      pulseSpeed: 1.3,
    },

    status: {
      online: "#FFD700",
      offline: "#FF3131",
      warning: "#FFA500",
      error: "#FF3131",
    },
  },

  // === CRIMSON === Blood red
  "crimson": {
    name: "Crimson",
    description: "Deep red interface",
    fontStyle: "tech",
    fontFamily: "'Rajdhani', sans-serif",

    colors: {
      primary: "#FF3131",
      secondary: "#DC143C",
      accent: "#FF6B6B",
      glow: "#FF6B6B",
      dim: "#3A0000",
      danger: "#FF0000",
      success: "#32CD32",
    },

    reactor: {
      core: "#FF3131",
      coreEmissive: "#CC0000",
      innerRing: "#FF3131",
      middleRing: "#DC143C",
      outerRing: "#8B0000",
      particle: "#FF3131",
      ambient: "#1A0000",
      geometry: "classic-arc",
    },

    background: {
      gradientFrom: "#1A0000",
      gradientVia: "#2A0000",
      gradientTo: "#1A0000",
      particleOpacity: 0.6,
      scanLineOpacity: 0.03,
    },

    panels: {
      glass: "rgba(255, 49, 49, 0.06)",
      border: "rgba(255, 49, 49, 0.35)",
      borderGlow: "rgba(255, 49, 49, 0.1)",
      textPrimary: "#FFD700",
      textSecondary: "#FFA07A",
      bracketColor: "#FF3131",
    },

    typography: {
      headingGlow: "0 0 20px rgba(255, 49, 49, 0.5), 0 0 40px rgba(255, 49, 49, 0.3)",
      textGlow: "0 0 10px rgba(255, 49, 49, 0.3)",
      intensity: 1,
    },

    effects: {
      fogColor: "#FF3131",
      fogDensity: 0.03,
      bloomStrength: 1.8,
      scanSpeed: 1,
      pulseSpeed: 1.1,
    },

    status: {
      online: "#32CD32",
      offline: "#FF0000",
      warning: "#FFA500",
      error: "#FF0000",
    },
  },

  // === QUANTUM === Purple/Cyan ethereal
  "quantum": {
    name: "Quantum Reality",
    description: "Beyond conventional physics",
    fontStyle: "futuristic",
    fontFamily: "'Orbitron', sans-serif",

    colors: {
      primary: "#BF00FF",
      secondary: "#00FFFF",
      accent: "#E0B0FF",
      glow: "#00FFFF",
      dim: "#2A0044",
      danger: "#FF1493",
      success: "#00FF7F",
    },

    reactor: {
      core: "#FFFFFF",
      coreEmissive: "#BF00FF",
      innerRing: "#BF00FF",
      middleRing: "#00FFFF",
      outerRing: "#9400D3",
      particle: "#00FFFF",
      ambient: "#0A001A",
      geometry: "quantum-orb",
    },

    background: {
      gradientFrom: "#0A001A",
      gradientVia: "#1A0033",
      gradientTo: "#0A001A",
      particleOpacity: 0.8,
      scanLineOpacity: 0.05,
    },

    panels: {
      glass: "rgba(191, 0, 255, 0.08)",
      border: "rgba(191, 0, 255, 0.4)",
      borderGlow: "rgba(0, 255, 255, 0.15)",
      textPrimary: "#00FFFF",
      textSecondary: "#DA70D6",
      bracketColor: "#BF00FF",
    },

    typography: {
      headingGlow: "0 0 20px rgba(191, 0, 255, 0.5), 0 0 40px rgba(0, 255, 255, 0.3)",
      textGlow: "0 0 10px rgba(0, 255, 255, 0.3)",
      intensity: 1.2,
    },

    effects: {
      fogColor: "#BF00FF",
      fogDensity: 0.04,
      bloomStrength: 2.5,
      scanSpeed: 1.5,
      pulseSpeed: 2,
    },

    status: {
      online: "#00FF7F",
      offline: "#FF1493",
      warning: "#FFD700",
      error: "#FF1493",
    },
  },
};

// Get current theme from DOM
export function getCurrentTheme(): ThemeId {
  if (typeof window === "undefined") return "arc-blue";
  const theme = document.documentElement.getAttribute("data-theme") as ThemeId;
  return theme && REACTOR_THEMES[theme] ? theme : "arc-blue";
}

// Get theme config
export function getThemeConfig(theme?: ThemeId): ThemeConfig {
  const t = theme || getCurrentTheme();
  return REACTOR_THEMES[t] || REACTOR_THEMES["arc-blue"];
}

// Apply theme CSS variables - call this when theme changes
export function syncThemeToCSS(theme?: ThemeId): void {
  if (typeof window === "undefined") return;

  const config = getThemeConfig(theme);
  const root = document.documentElement;

  // Set theme attribute
  root.setAttribute("data-theme", theme || "arc-blue");

  // Core colors
  root.style.setProperty("--reactor-core", config.colors.primary);
  root.style.setProperty("--reactor-glow", config.colors.glow);
  root.style.setProperty("--accent-color", config.colors.accent);

  // Background
  root.style.setProperty("--bg-gradient-from", config.background.gradientFrom);
  root.style.setProperty("--bg-gradient-via", config.background.gradientVia);
  root.style.setProperty("--bg-gradient-to", config.background.gradientTo);

  // Panels
  root.style.setProperty("--panel-glass", config.panels.glass);
  root.style.setProperty("--panel-border", config.panels.border);
  root.style.setProperty("--panel-border-glow", config.panels.borderGlow);
  root.style.setProperty("--panel-bracket", config.panels.bracketColor);

  // Text
  root.style.setProperty("--text-primary", config.panels.textPrimary);
  root.style.setProperty("--text-secondary", config.panels.textSecondary);

  // Typography effects
  root.style.setProperty("--heading-glow", config.typography.headingGlow);
  root.style.setProperty("--text-glow", config.typography.textGlow);

  // Status
  root.style.setProperty("--status-online", config.status.online);
  root.style.setProperty("--status-offline", config.status.offline);
  root.style.setProperty("--status-warning", config.status.warning);
  root.style.setProperty("--status-error", config.status.error);

  // Font
  root.style.setProperty("--theme-font", config.fontFamily);

  // Apply font class to body
  document.body.style.fontFamily = config.fontFamily;
}

// Generate dynamic CSS for animations
export function generateThemeCSS(theme: ThemeId): string {
  const config = getThemeConfig(theme);

  return `
    @keyframes theme-pulse {
      0%, 100% {
        box-shadow: 0 0 20px ${config.colors.glow}66,
                    0 0 40px ${config.colors.glow}44,
                    0 0 60px ${config.colors.glow}22;
      }
      50% {
        box-shadow: 0 0 30px ${config.colors.glow}88,
                    0 0 60px ${config.colors.glow}66,
                    0 0 90px ${config.colors.glow}44;
      }
    }

    @keyframes theme-scan {
      0% { transform: translateY(-100%); }
      100% { transform: translateY(100vh); }
    }
  `;
}
