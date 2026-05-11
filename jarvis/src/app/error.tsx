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
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-deep-space text-text-primary p-8">
      <h2 className="text-2xl font-orbitron mb-4 text-red-500">SYSTEM ERROR</h2>
      <p className="text-text-secondary mb-6 font-rajdhani">
        {error.message || "Something went wrong with JARVIS."}
      </p>
      <button
        onClick={reset}
        className="px-6 py-3 bg-reactor-core text-white font-rajdhani font-semibold rounded hover:bg-reactor-core/80 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
