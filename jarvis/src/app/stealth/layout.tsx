import type { Metadata } from "next";

// The overlay runs in its own Chrome `--app=` window (launch-overlay.bat). An
// app window takes its title straight from the page's <title>, and
// SetWindowDisplayAffinity targets a WINDOW, so a stable, unmistakable title is
// what makes the overlay easy to find in the taskbar and in Win32 tooling.
export const metadata: Metadata = {
  title: "JARVIS OVERLAY",
  robots: { index: false, follow: false },
};

export default function StealthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
