"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  Search,
  X,
  Music,
  ListMusic,
  Shuffle,
  Repeat,
  Plus,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import gsap from "gsap";

interface Track {
  id: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string }[] };
  duration_ms: number;
  uri: string;
}

interface PlaybackState {
  is_playing: boolean;
  item: Track;
  progress_ms: number;
  shuffle_state: boolean;
  repeat_state: "off" | "track" | "context";
  device: { name: string; volume_percent: number };
}

interface Playlist {
  id: string;
  name: string;
  images: { url: string }[];
  tracks: { total: number };
  uri: string;
}

interface SpotifyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SpotifyPanel({ isOpen, onClose }: SpotifyPanelProps) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    tracks: Track[];
    playlists: Playlist[];
  }>({ tracks: [], playlists: [] });
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(50);
  const [activeTab, setActiveTab] = useState<"now" | "search" | "playlists">("now");
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  // Fetch current playback
  const fetchPlayback = useCallback(async () => {
    try {
      const response = await fetch("/api/spotify?action=currentTrack");
      if (response.ok) {
        const data = await response.json();
        if (data.track) {
          setPlayback(data.track);
          setVolume(data.track.device?.volume_percent || 50);
          setIsAuthenticated(true);
        }
      } else if (response.status === 401) {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error("Failed to fetch playback:", err);
    }
  }, []);

  // Fetch playlists
  const fetchPlaylists = useCallback(async () => {
    try {
      const response = await fetch("/api/spotify?action=playlists");
      if (response.ok) {
        const data = await response.json();
        setPlaylists(data.playlists?.items || []);
      }
    } catch (err) {
      console.error("Failed to fetch playlists:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (isOpen) {
      fetchPlayback();
      fetchPlaylists();
      gsap.fromTo(
        ".spotify-panel",
        { opacity: 0, scale: 0.95, y: 20 },
        { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "power2.out" }
      );

      // Poll playback state
      progressInterval.current = setInterval(fetchPlayback, 3000);
    }

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
  }, [isOpen, fetchPlayback, fetchPlaylists]);

  // Control playback
  const controlPlayback = async (action: string, params?: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...params }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to ${action}`);
      }

      // Refresh playback state
      await fetchPlayback();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command failed");
    } finally {
      setLoading(false);
    }
  };

  // Search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      const response = await fetch("/api/spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query: searchQuery }),
      });

      if (response.ok) {
        const data = await response.json();
        setSearchResults({
          tracks: data.results?.tracks?.items || [],
          playlists: data.results?.playlists?.items || [],
        });
      }
    } catch (err) {
      setError("Search failed");
    } finally {
      setLoading(false);
    }
  };

  // Format duration
  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Format progress bar
  const getProgressPercent = () => {
    if (!playback?.item?.duration_ms || !playback?.progress_ms) return 0;
    return (playback.progress_ms / playback.item.duration_ms) * 100;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="spotify-panel w-full max-w-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="holographic-panel p-6 max-h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-green-500/20">
                  <Music className="w-6 h-6 text-green-400" />
                </div>
                <div>
                  <h2 className="font-orbitron text-green-400 font-bold text-lg">
                    SPOTIFY CONTROL
                  </h2>
                  <p className="font-rajdhani text-text-secondary text-sm">
                    {playback?.device?.name || "No device"}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-panel-glass rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            {/* Auth Error */}
            {!isAuthenticated && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-4 bg-accent-amber/20 border border-accent-amber/50 rounded-lg"
              >
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-accent-amber" />
                  <span className="font-orbitron text-accent-amber">
                    Spotify Not Connected
                  </span>
                </div>
                <p className="text-text-secondary text-sm mb-3">
                  Please authorize Spotify to control playback.
                </p>
                <a
                  href="/spotify-setup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-accent-amber/20 hover:bg-accent-amber/40 rounded-lg font-rajdhani text-accent-amber transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Setup Spotify
                </a>
              </motion.div>
            )}

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-3 bg-accent-red/20 border border-accent-red/50 rounded-lg"
              >
                <p className="text-accent-red text-sm">{error}</p>
              </motion.div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
              {(["now", "search", "playlists"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg font-rajdhani text-sm transition-colors ${
                    activeTab === tab
                      ? "bg-green-500/20 text-green-400 border border-green-500/50"
                      : "bg-panel-glass/50 text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Now Playing Tab */}
            {activeTab === "now" && (
              <div className="space-y-6">
                {playback?.item ? (
                  <>
                    {/* Album Art */}
                    <div className="flex justify-center">
                      <motion.div
                        initial={{ scale: 0.9 }}
                        animate={{ scale: 1 }}
                        className="relative"
                      >
                        <img
                          src={
                            playback.item.album.images[0]?.url ||
                            "/placeholder-album.png"
                          }
                          alt={playback.item.album.name}
                          className="w-48 h-48 rounded-lg shadow-2xl object-cover"
                        />
                        {playback.is_playing && (
                          <div className="absolute -bottom-2 -right-2 w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                            <div className="flex gap-1">
                              <motion.div
                                animate={{ height: [4, 16, 4] }}
                                transition={{
                                  duration: 0.5,
                                  repeat: Infinity,
                                  delay: 0,
                                }}
                                className="w-1 bg-white rounded-full"
                              />
                              <motion.div
                                animate={{ height: [4, 24, 4] }}
                                transition={{
                                  duration: 0.5,
                                  repeat: Infinity,
                                  delay: 0.1,
                                }}
                                className="w-1 bg-white rounded-full"
                              />
                              <motion.div
                                animate={{ height: [4, 12, 4] }}
                                transition={{
                                  duration: 0.5,
                                  repeat: Infinity,
                                  delay: 0.2,
                                }}
                                className="w-1 bg-white rounded-full"
                              />
                            </div>
                          </div>
                        )}
                      </motion.div>
                    </div>

                    {/* Track Info */}
                    <div className="text-center">
                      <h3 className="font-orbitron text-xl text-text-primary mb-1 truncate">
                        {playback.item.name}
                      </h3>
                      <p className="font-rajdhani text-text-secondary">
                        {playback.item.artists.map((a) => a.name).join(", ")}
                      </p>
                      <p className="font-rajdhani text-text-secondary/50 text-sm">
                        {playback.item.album.name}
                      </p>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div className="h-1 bg-panel-border rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-green-400 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${getProgressPercent()}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                      <div className="flex justify-between text-xs font-rajdhani text-text-secondary/50">
                        <span>{formatDuration(playback.progress_ms || 0)}</span>
                        <span>{formatDuration(playback.item.duration_ms)}</span>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center justify-center gap-4">
                      <button
                        onClick={() =>
                          controlPlayback("shuffle", { state: !playback.shuffle_state })
                        }
                        className={`p-2 rounded-full transition-colors ${
                          playback.shuffle_state
                            ? "bg-green-500/20 text-green-400"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        <Shuffle className="w-5 h-5" />
                      </button>

                      <button
                        onClick={() => controlPlayback("previous")}
                        disabled={loading}
                        className="p-3 rounded-full bg-panel-glass hover:bg-panel-border text-text-primary transition-colors"
                      >
                        <SkipBack className="w-6 h-6 fill-current" />
                      </button>

                      <button
                        onClick={() =>
                          controlPlayback(playback.is_playing ? "pause" : "play")
                        }
                        disabled={loading}
                        className="p-4 rounded-full bg-green-500 hover:bg-green-400 text-black transition-colors"
                      >
                        {playback.is_playing ? (
                          <Pause className="w-8 h-8 fill-current" />
                        ) : (
                          <Play className="w-8 h-8 fill-current" />
                        )}
                      </button>

                      <button
                        onClick={() => controlPlayback("next")}
                        disabled={loading}
                        className="p-3 rounded-full bg-panel-glass hover:bg-panel-border text-text-primary transition-colors"
                      >
                        <SkipForward className="w-6 h-6 fill-current" />
                      </button>

                      <button
                        onClick={() =>
                          controlPlayback("repeat", {
                            state:
                              playback.repeat_state === "off"
                                ? "context"
                                : "off",
                          })
                        }
                        className={`p-2 rounded-full transition-colors ${
                          playback.repeat_state !== "off"
                            ? "bg-green-500/20 text-green-400"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        <Repeat className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Volume */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          controlPlayback("volume", { volume: volume === 0 ? 50 : 0 })
                        }
                        className="text-text-secondary"
                      >
                        {volume === 0 ? (
                          <VolumeX className="w-5 h-5" />
                        ) : volume < 50 ? (
                          <Volume1 className="w-5 h-5" />
                        ) : (
                          <Volume2 className="w-5 h-5" />
                        )}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={volume}
                        onChange={(e) => {
                          const newVolume = parseInt(e.target.value);
                          setVolume(newVolume);
                          controlPlayback("volume", { volume: newVolume });
                        }}
                        className="flex-1 h-1 bg-panel-border rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-green-400 [&::-webkit-slider-thumb]:rounded-full"
                      />
                      <span className="font-rajdhani text-text-secondary w-10 text-right">
                        {volume}%
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <Music className="w-16 h-16 text-text-secondary/30 mx-auto mb-4" />
                    <p className="font-rajdhani text-text-secondary">
                      No music playing
                    </p>
                    <p className="font-rajdhani text-text-secondary/50 text-sm mt-2">
                      Start playing on Spotify to see controls
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Search Tab */}
            {activeTab === "search" && (
              <div className="space-y-4">
                <form onSubmit={handleSearch} className="flex gap-2">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary/50" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search songs, artists, albums..."
                      className="w-full pl-10 pr-4 py-2 bg-panel-glass/50 border border-panel-border rounded-lg font-rajdhani text-text-primary placeholder:text-text-secondary/50 focus:border-green-400 focus:outline-none transition-colors"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-green-500/20 hover:bg-green-500/40 border border-green-500/50 rounded-lg font-orbitron text-green-400 transition-colors disabled:opacity-50"
                  >
                    Search
                  </button>
                </form>

                {/* Search Results */}
                {searchResults.tracks.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-orbitron text-sm text-green-400">
                      Songs
                    </h4>
                    {searchResults.tracks.slice(0, 5).map((track) => (
                      <motion.div
                        key={track.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 p-2 bg-panel-glass/30 rounded-lg border border-panel-border/50 hover:border-green-400/30 transition-colors group"
                      >
                        <img
                          src={
                            track.album.images[track.album.images.length - 1]
                              ?.url || "/placeholder-album.png"
                          }
                          alt={track.album.name}
                          className="w-12 h-12 rounded object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-rajdhani text-text-primary truncate">
                            {track.name}
                          </p>
                          <p className="font-rajdhani text-text-secondary/70 text-xs truncate">
                            {track.artists.map((a) => a.name).join(", ")}
                          </p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() =>
                              controlPlayback("play", { uri: track.uri })
                            }
                            className="p-2 bg-green-500/20 hover:bg-green-500/40 rounded text-green-400"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() =>
                              controlPlayback("queue", { uri: track.uri })
                            }
                            className="p-2 bg-panel-glass hover:bg-panel-border rounded text-text-secondary"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {searchResults.playlists.length > 0 && (
                  <div className="space-y-2 mt-4">
                    <h4 className="font-orbitron text-sm text-green-400">
                      Playlists
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {searchResults.playlists.slice(0, 4).map((playlist) => (
                        <motion.button
                          key={playlist.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          onClick={() =>
                            controlPlayback("play", { uri: playlist.uri })
                          }
                          className="p-3 bg-panel-glass/30 rounded-lg border border-panel-border/50 hover:border-green-400/30 transition-colors text-left"
                        >
                          <img
                            src={
                              playlist.images[0]?.url || "/placeholder-album.png"
                            }
                            alt={playlist.name}
                            className="w-full h-20 object-cover rounded mb-2"
                          />
                          <p className="font-rajdhani text-text-primary text-sm truncate">
                            {playlist.name}
                          </p>
                          <p className="font-rajdhani text-text-secondary/50 text-xs">
                            {playlist.tracks.total} tracks
                          </p>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}

                {loading && (
                  <div className="text-center py-8">
                    <div className="w-8 h-8 border-4 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                )}
              </div>
            )}

            {/* Playlists Tab */}
            {activeTab === "playlists" && (
              <div className="grid grid-cols-2 gap-3">
                {playlists.map((playlist, index) => (
                  <motion.button
                    key={playlist.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => controlPlayback("play", { uri: playlist.uri })}
                    className="p-3 bg-panel-glass/30 rounded-lg border border-panel-border/50 hover:border-green-400/30 transition-colors text-left group"
                  >
                    <img
                      src={playlist.images[0]?.url || "/placeholder-album.png"}
                      alt={playlist.name}
                      className="w-full h-24 object-cover rounded-lg mb-2 group-hover:opacity-80 transition-opacity"
                    />
                    <p className="font-rajdhani text-text-primary text-sm truncate">
                      {playlist.name}
                    </p>
                    <p className="font-rajdhani text-text-secondary/50 text-xs">
                      {playlist.tracks.total} tracks
                    </p>
                  </motion.button>
                ))}

                {playlists.length === 0 && !loading && (
                  <div className="col-span-2 text-center py-8">
                    <ListMusic className="w-12 h-12 text-text-secondary/30 mx-auto mb-3" />
                    <p className="font-rajdhani text-text-secondary">
                      No playlists found
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="mt-6 pt-4 border-t border-panel-border text-center">
              <p className="text-xs text-text-secondary/40">
                Requires Spotify Premium for full playback control
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
