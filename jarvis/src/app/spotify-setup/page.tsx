"use client";

import { useState } from "react";

export default function SpotifySetup() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [step, setStep] = useState(1);

  const generateAuthUrl = () => {
    const trimmedId = clientId.trim();
    const trimmedSecret = clientSecret.trim();
    console.log("Generating auth URL...", { clientId: trimmedId.slice(0, 5) + "...", clientSecret: trimmedSecret.slice(0, 5) + "..." });

    const scopes = [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
      "streaming",
      "playlist-read-private",
      "playlist-read-collaborative",
    ];

    const params = new URLSearchParams({
      client_id: trimmedId,
      response_type: "code",
      redirect_uri: "http://127.0.0.1:3000/api/spotify/callback",
      scope: scopes.join(" "),
    });

    const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
    console.log("Auth URL:", url);
    setAuthUrl(url);
    setStep(2);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-reactor-core mb-6">Spotify Setup</h1>

        {step === 1 && (
          <div className="space-y-6">
            <div className="bg-panel-glass p-6 rounded-lg border border-panel-border">
              <h2 className="text-xl font-semibold text-text-primary mb-4">Step 1: Enter Credentials</h2>
              <p className="text-text-secondary mb-4">
                Get these from <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-reactor-core underline">Spotify Developer Dashboard</a>
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  console.log("Form submitted");
                  generateAuthUrl();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-text-secondary text-sm mb-2">Client ID</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full bg-background border border-panel-border rounded px-4 py-2 text-text-primary"
                    placeholder="Your Spotify Client ID"
                    required
                  />
                </div>

                <div>
                  <label className="block text-text-secondary text-sm mb-2">Client Secret</label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    className="w-full bg-background border border-panel-border rounded px-4 py-2 text-text-primary"
                    placeholder="Your Spotify Client Secret"
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="mt-6 w-full bg-reactor-core hover:bg-reactor-core/80 active:bg-reactor-core/60 text-white font-bold py-3 px-4 rounded transition-all"
                >
                  Generate Auth URL
                </button>
              </form>
            </div>

            <div className="bg-panel-glass p-6 rounded-lg border border-panel-border">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Setup Instructions</h3>
              <ol className="list-decimal list-inside text-text-secondary space-y-2">
                <li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-reactor-core underline">Spotify Developer Dashboard</a></li>
                <li>Create an app (give it any name)</li>
                <li>Add these Redirect URIs in the app settings:
                  <ul className="list-disc list-inside ml-4 mt-1 text-sm">
                    <li><code className="bg-panel-glass px-1 rounded">http://127.0.0.1:3000/api/spotify/callback</code></li>
                  </ul>
                </li>
                <li>Copy Client ID and Client Secret above</li>
                <li>Click Generate Auth URL</li>
              </ol>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bg-panel-glass p-6 rounded-lg border border-panel-border">
            <h2 className="text-xl font-semibold text-text-primary mb-4">Step 2: Authorize JARVIS</h2>
            <p className="text-text-secondary mb-4">
              Click the link below to authorize JARVIS to control your Spotify:
            </p>

            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-accent-green hover:bg-accent-green/80 text-white font-bold py-3 rounded text-center transition-colors"
            >
              Authorize with Spotify
            </a>

            <div className="mt-6 p-4 bg-background rounded border border-panel-border">
              <p className="text-text-secondary text-sm mb-2">After authorization, paste your refresh token here:</p>
              <input
                type="text"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                className="w-full bg-panel-glass border border-panel-border rounded px-4 py-2 text-text-primary mb-3"
                placeholder="Paste refresh token from the callback response"
              />

              {refreshToken && (
                <div className="mt-4">
                  <p className="text-text-secondary text-sm mb-2">Add this to your .env.local file:</p>
                  <code className="block bg-background p-3 rounded border border-panel-border text-sm font-mono text-reactor-core">
                    SPOTIFY_CLIENT_ID={clientId}<br/>
                    SPOTIFY_CLIENT_SECRET={clientSecret}<br/>
                    SPOTIFY_REFRESH_TOKEN={refreshToken}
                  </code>
                  <button
                    onClick={() => copyToClipboard(`SPOTIFY_CLIENT_ID=${clientId}\nSPOTIFY_CLIENT_SECRET=${clientSecret}\nSPOTIFY_REFRESH_TOKEN=${refreshToken}`)}
                    className="mt-2 text-sm text-reactor-core hover:underline"
                  >
                    Copy to clipboard
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => setStep(1)}
              className="mt-4 text-text-secondary hover:text-text-primary"
            >
              ← Back
            </button>
          </div>
        )}

        <div className="mt-8 text-center text-text-secondary text-sm">
          <p>Make sure JARVIS is running on <code className="text-reactor-core">127.0.0.1:3000</code></p>
        </div>
      </div>
    </div>
  );
}
