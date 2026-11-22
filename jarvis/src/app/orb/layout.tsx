import type { Metadata } from "next";

// The orb is a borderless, transparent, always-on-top window (overlay/orb.js),
// so this route paints NOTHING of its own: no background, no chrome. The
// transparent-body rule lives in globals.css, keyed off `main.orb-surface`.
export const metadata: Metadata = {
  title: "JARVIS ORB",
  robots: { index: false, follow: false },
};

export default function OrbLayout({ children }: { children: React.ReactNode }) {
  return children;
}
