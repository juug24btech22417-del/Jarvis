"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[jarvis/error.tsx] caught:", error);
  }, [error]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 10, 10, 0.95)",
        color: "#fca5a5",
        padding: 32,
        fontFamily: "monospace",
        zIndex: 9999,
        overflow: "auto",
      }}
    >
      <h2 style={{ margin: 0, color: "#fff" }}>JARVIS crashed during render</h2>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          marginTop: 16,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {error.message}
        {"\n\n"}
        {error.stack}
      </pre>
      <button
        onClick={reset}
        style={{
          marginTop: 16,
          padding: "8px 16px",
          background: "#0891b2",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
