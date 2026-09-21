"use client";

// Phone-as-arc-remote — scan the QR, phone becomes a media/volume/lock
// remote over Wi-Fi. Uses the existing `qrcode` dependency (already in
// package.json) to render the pairing code client-side.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Smartphone, Wifi } from "lucide-react";

export default function PhoneRemotePanel({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/remote/status");
        const data = await res.json();
        if (cancelled) return;
        if (data?.success && data.url) {
          setUrl(data.url);
          setHost(data.host || "");
          const QR = await import("qrcode");
          const dataUrl = await QR.toDataURL(data.url, {
            width: 220,
            margin: 1,
            color: { dark: "#00d4ff", light: "#04070d" },
          });
          if (!cancelled) setQrDataUrl(dataUrl);
        } else {
          setError(data?.error || "Broker failed to start");
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm holographic-panel rounded-xl p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-reactor-core" />
            <h2 className="font-orbitron text-reactor-core tracking-wider text-sm">
              ARC REMOTE
            </h2>
          </div>
          <button onClick={onClose} className="text-text-secondary/60 hover:text-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error ? (
          <div className="font-rajdhani text-sm text-accent-red py-8">
            {error}
          </div>
        ) : !qrDataUrl ? (
          <div className="font-rajdhani text-sm text-text-secondary py-8 animate-pulse">
            Spinning up the remote broker…
          </div>
        ) : (
          <>
            <img
              src={qrDataUrl}
              alt="Pair with your phone"
              className="mx-auto rounded-lg border border-panel-border/50"
            />
            <p className="font-rajdhani text-sm text-text-secondary mt-4">
              Scan with your phone — same Wi-Fi network as this PC.
            </p>
            <p className="font-rajdhani text-[11px] text-text-secondary/50 mt-2 break-all">
              {url}
            </p>
            <div className="flex items-center justify-center gap-2 mt-4 text-[11px] font-rajdhani text-text-secondary/60">
              <Wifi className="w-3 h-3" />
              host: {host || "this machine"} · trackpad · keys · media · apps
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
