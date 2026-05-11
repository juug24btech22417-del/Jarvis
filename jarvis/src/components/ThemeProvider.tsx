"use client";

import { useEffect, useState } from "react";
import { useJarvisStore, Theme } from "@/store/jarvis.store";
import { syncThemeToCSS } from "@/lib/theme";

const VALID_THEMES: Theme[] = ["arc-blue", "crimson", "stealth", "quantum", "batman", "ironman"];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useJarvisStore();
  const [mounted, setMounted] = useState(false);

  // Initialize theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("jarvis-theme") as Theme;
    if (savedTheme && VALID_THEMES.includes(savedTheme)) {
      setTheme(savedTheme);
    }
    setMounted(true);
  }, [setTheme]);

  // Sync theme to DOM and CSS variables whenever it changes
  useEffect(() => {
    if (!mounted) return;

    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("jarvis-theme", theme);
    syncThemeToCSS(theme);
  }, [theme, mounted]);

  // Listen for theme changes from other components (like CommandBar)
  useEffect(() => {
    if (!mounted) return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "data-theme") {
          const newTheme = document.documentElement.getAttribute("data-theme") as Theme;
          if (newTheme && VALID_THEMES.includes(newTheme) && newTheme !== theme) {
            setTheme(newTheme);
          }
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });

    return () => observer.disconnect();
  }, [mounted, theme, setTheme]);

  return <>{children}</>;
}
