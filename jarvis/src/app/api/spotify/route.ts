import { NextRequest, NextResponse } from "next/server";

// Spotify API endpoints
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com";

interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// Store tokens in memory (in production, use a database or secure storage)
let spotifyTokens: SpotifyTokens | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN?.trim();
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();

  console.log("Refreshing token...", {
    hasRefreshToken: !!refreshToken,
    refreshTokenLength: refreshToken?.length,
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
  });

  if (!refreshToken || !clientId || !clientSecret) {
    console.error("Missing Spotify credentials");
    return null;
  }

  try {
    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Token refresh failed:", response.status, errorData);
      // Store last error for debugging
      (globalThis as {spotifyLastError?: unknown}).spotifyLastError = errorData;
      throw new Error(`Token refresh failed: ${response.status} - ${errorData.error_description || errorData.error || 'Unknown'}`);
    }

    const data = await response.json();
    console.log("Token refreshed successfully, expires in:", data.expires_in);
    spotifyTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    return data.access_token;
  } catch (error) {
    console.error("Failed to refresh token:", error);
    return null;
  }
}

async function getValidAccessToken(): Promise<string | null> {
  // If we have a valid token, use it
  if (spotifyTokens && spotifyTokens.expires_at > Date.now() + 60000) {
    return spotifyTokens.access_token;
  }

  // Otherwise refresh
  return refreshAccessToken();
}

async function spotifyRequest(endpoint: string, options: RequestInit = {}) {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error("No valid access token");
  }

  const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.log("[Spotify API] Error response:", errorText.slice(0, 200));
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { error: { message: errorText || `HTTP ${response.status}` } };
    }
    throw new Error(error.error?.message || error.message || `Spotify API error: ${response.status}`);
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return { success: true };
  }

  const responseText = await response.text();
  if (!responseText) {
    return { success: true };
  }

  try {
    return JSON.parse(responseText);
  } catch {
    console.log("[Spotify API] Failed to parse response:", responseText.slice(0, 100));
    return { success: true, rawResponse: responseText };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, query, uri } = body;

    switch (action) {
      case "play": {
        console.log("[Spotify API] Play case started");
        try {
          // Resume playback or start playing a specific track/album/playlist
          if (uri) {
            console.log("[Spotify API] Playing URI:", uri);
            await spotifyRequest("/me/player/play", {
              method: "PUT",
              body: JSON.stringify({ uris: [uri] }),
            });
          } else {
            console.log("[Spotify API] Resuming playback");
            await spotifyRequest("/me/player/play", { method: "PUT" });
          }
          console.log("[Spotify API] Play request succeeded, returning success");
          return NextResponse.json({ success: true, action: "play" });
        } catch (error) {
          console.log("[Spotify API] Play request failed:", error);
          const errorMsg = String(error);
          if (errorMsg.includes("404") || errorMsg.includes("Device")) {
            // No active device - try to transfer to available device
            console.log("[Spotify API] No device error, trying to transfer...");
            try {
              const devices = await spotifyRequest("/me/player/devices");
              if (devices.devices?.length > 0) {
                const deviceId = devices.devices[0].id;
                await spotifyRequest("/me/player", {
                  method: "PUT",
                  body: JSON.stringify({ device_ids: [deviceId], play: true }),
                });
                console.log("[Spotify API] Transferred to device:", devices.devices[0].name);
                return NextResponse.json({ success: true, action: "play", device: devices.devices[0].name });
              }
            } catch (transferError) {
              console.error("[Spotify API] Failed to transfer:", transferError);
            }
            console.log("[Spotify API] No device found, returning 404");
            return NextResponse.json({
              success: false,
              error: "No active device. Open Spotify on your computer or phone first."
            }, { status: 404 });
          }
          console.log("[Spotify API] Re-throwing error:", errorMsg);
          throw error;
        }
      }

      case "pause": {
        await spotifyRequest("/me/player/pause", { method: "PUT" });
        return NextResponse.json({ success: true, action: "pause" });
      }

      case "next": {
        await spotifyRequest("/me/player/next", { method: "POST" });
        return NextResponse.json({ success: true, action: "next" });
      }

      case "previous": {
        await spotifyRequest("/me/player/previous", { method: "POST" });
        return NextResponse.json({ success: true, action: "previous" });
      }

      case "search": {
        if (!query) {
          return NextResponse.json({ error: "Query required" }, { status: 400 });
        }
        const results = await spotifyRequest(
          `/search?q=${encodeURIComponent(query)}&type=track,album,artist,playlist&limit=5`
        );
        return NextResponse.json({ success: true, results });
      }

      case "currentTrack": {
        const track = await spotifyRequest("/me/player/currently-playing");
        return NextResponse.json({ success: true, track });
      }

      case "devices": {
        const devices = await spotifyRequest("/me/player/devices");
        return NextResponse.json({ success: true, devices });
      }

      case "volume": {
        const volume = await spotifyRequest(`/me/player/volume?volume_percent=${body.volume}`, {
          method: "PUT",
        });
        return NextResponse.json({ success: true, action: "volume", volume });
      }

      case "shuffle": {
        await spotifyRequest(`/me/player/shuffle?state=${body.state}`, { method: "PUT" });
        return NextResponse.json({ success: true, action: "shuffle" });
      }

      case "repeat": {
        await spotifyRequest(`/me/player/repeat?state=${body.state}`, { method: "PUT" });
        return NextResponse.json({ success: true, action: "repeat" });
      }

      case "queue": {
        if (!uri) {
          return NextResponse.json({ error: "URI required" }, { status: 400 });
        }
        await spotifyRequest(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: "POST" });
        return NextResponse.json({ success: true, action: "queue" });
      }

      case "playlists": {
        const playlists = await spotifyRequest("/me/playlists?limit=20");
        return NextResponse.json({ success: true, playlists });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Spotify API] Error caught:", error);
    const errorMsg = String(error);
    const stack = error instanceof Error ? error.stack : "No stack";
    console.error("[Spotify API] Error stack:", stack);
    // Check for specific errors
    if (errorMsg.includes("401")) {
      return NextResponse.json(
        { error: "Invalid or expired token. Please re-authorize Spotify.", details: errorMsg },
        { status: 401 }
      );
    }
    if (errorMsg.includes("403")) {
      return NextResponse.json(
        { error: "Spotify Premium required for playback control.", details: errorMsg },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: "Spotify command failed", details: errorMsg },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  // Debug endpoint to check env vars
  if (action === "debug") {
    try {
      // Test token refresh with explicit credentials
      const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN?.trim();
      const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
      const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();

      console.log("Debug - env vars:", {
        refreshTokenLen: refreshToken?.length,
        clientIdLen: clientId?.length,
        clientSecretLen: clientSecret?.length,
      });

      // Try direct fetch
      const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${authString}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken || '')}`,
      });

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json({
          hasClientId: !!clientId,
          hasClientSecret: !!clientSecret,
          hasRefreshToken: !!refreshToken,
          tokenRefreshed: false,
          error: data.error,
          errorDescription: data.error_description,
          status: response.status,
        });
      }

      // Success! Store the token
      spotifyTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken || '',
        expires_at: Date.now() + data.expires_in * 1000,
      };

      return NextResponse.json({
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasRefreshToken: !!refreshToken,
        tokenRefreshed: true,
        accessTokenPrefix: data.access_token.slice(0, 10),
      });

      // Test devices API
      let devicesError = null;
      let devicesCount = 0;
      try {
        const devices = await spotifyRequest("/me/player/devices");
        devicesCount = devices.devices?.length || 0;
      } catch (e) {
        devicesError = String(e);
      }

      return NextResponse.json({
        hasClientId: !!process.env.SPOTIFY_CLIENT_ID,
        hasClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET,
        hasRefreshToken: !!process.env.SPOTIFY_REFRESH_TOKEN,
        tokenRefreshed: true,
        tokenPrefix: data.access_token.slice(0, 10) + "...",
        devicesCount,
        devicesError,
      });
    } catch (e) {
      return NextResponse.json({
        hasClientId: !!process.env.SPOTIFY_CLIENT_ID,
        hasClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET,
        hasRefreshToken: !!process.env.SPOTIFY_REFRESH_TOKEN,
        error: String(e),
      });
    }
  }

  try {
    switch (action) {
      case "currentTrack": {
        const track = await spotifyRequest("/me/player/currently-playing");
        return NextResponse.json({ success: true, track });
      }

      case "devices": {
        const devices = await spotifyRequest("/me/player/devices");
        return NextResponse.json({ success: true, devices });
      }

      case "playlists": {
        const playlists = await spotifyRequest("/me/playlists?limit=20");
        return NextResponse.json({ success: true, playlists });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Spotify API error:", error);
    return NextResponse.json(
      { error: "Spotify command failed", details: String(error) },
      { status: 500 }
    );
  }
}
