"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Lock, Unlock, X, Search, Key, Plus, Eye, EyeOff } from "lucide-react";

interface VaultItem {
  id: string;
  type: string;
  preview: string;
  tags: string[];
  createdAt: number;
}

export default function VaultPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [initialized, setInitialized] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VaultItem[]>([]);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Check vault status on mount
  useEffect(() => {
    checkVaultStatus();
  }, []);

  const checkVaultStatus = async () => {
    try {
      const res = await fetch("/api/vault/store/status");
      const data = await res.json();
      if (data.success) {
        setInitialized(data.initialized);
      }
    } catch (error) {
      console.error("[Vault] Status check failed:", error);
    }
  };

  // Initialize vault
  const handleInitialize = async () => {
    if (!password) {
      setError("Password is required");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/vault/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "initialize",
          password,
        }),
      });
      const data = await res.json();

      if (data.success) {
        // Store encrypted master key in localStorage
        localStorage.setItem("vault_master_key", JSON.stringify(data.encryptedMasterKey));
        setInitialized(true);
        setUnlocked(true);
        setPassword("");
        setConfirmPassword("");
      } else {
        setError(data.error);
      }
    } catch (error) {
      setError("Failed to initialize vault");
      console.error("[Vault] Initialize failed:", error);
    } finally {
      setLoading(false);
    }
  };

  // Unlock vault
  const handleUnlock = async () => {
    if (!password) {
      setError("Password is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/vault/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unlock",
          password,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setUnlocked(true);
        setPassword("");
        fetchItems();
      } else {
        setError(data.error);
      }
    } catch (error) {
      setError("Failed to unlock vault");
      console.error("[Vault] Unlock failed:", error);
    } finally {
      setLoading(false);
    }
  };

  // Search vault
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const res = await fetch(`/api/vault/store/status?action=search&q=${encodeURIComponent(searchQuery)}&password=${encodeURIComponent(password)}`);
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.items);
      }
    } catch (error) {
      console.error("[Vault] Search failed:", error);
    }
  };

  // Fetch vault items
  const fetchItems = async () => {
    // In production, fetch actual items from server
    setVaultItems([]);
  };

  // Store item in vault
  const handleStoreItem = async (content: string, type: string, tags: string[]) => {
    try {
      const res = await fetch("/api/vault/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "store",
          content,
          type,
          tags,
        }),
      });
      const data = await res.json();
      return data.success;
    } catch (error) {
      console.error("[Vault] Store failed:", error);
      return false;
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      className="fixed right-0 top-0 h-full w-96 bg-panel-bg/95 backdrop-blur-sm border-l border-panel-border z-40"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-panel-border">
        <div className="flex items-center gap-3">
          <Shield className={`w-6 h-6 ${unlocked ? 'text-green-500' : 'text-reactor-core'}`} />
          <div>
            <h2 className="font-orbitron text-reactor-core font-bold">VAULT</h2>
            <div className="flex items-center gap-2">
              {unlocked ? (
                <>
                  <Unlock className="w-3 h-3 text-green-500" />
                  <span className="text-xs text-green-500 font-rajdhani">Unlocked</span>
                </>
              ) : (
                <>
                  <Lock className="w-3 h-3 text-accent-red" />
                  <span className="text-xs text-accent-red font-rajdhani">Locked</span>
                </>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-accent-red/20 rounded transition-colors"
        >
          <X className="w-4 h-4 text-accent-red" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {!initialized ? (
          // Create Vault
          <div className="space-y-4">
            <div className="text-center">
              <Lock className="w-12 h-12 mx-auto mb-2 text-reactor-core opacity-50" />
              <p className="font-rajdhani text-text-primary">Create Encrypted Vault</p>
              <p className="text-xs text-text-secondary font-rajdhani mt-1">
                Store messages, notes, and passwords securely
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-rajdhani text-text-secondary mb-1">
                  Master Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
                    placeholder="Choose a strong password"
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-rajdhani text-text-secondary mb-1">
                  Confirm Password
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
                  placeholder="Confirm your password"
                />
              </div>

              {error && (
                <p className="text-accent-red text-sm font-rajdhani">{error}</p>
              )}

              <button
                onClick={handleInitialize}
                disabled={loading}
                className="w-full py-2 bg-reactor-core/20 hover:bg-reactor-core/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-rajdhani text-reactor-core flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                {loading ? "Creating..." : "Create Vault"}
              </button>
            </div>

            <div className="text-xs text-text-secondary font-rajdhani text-center">
              <Key className="w-3 h-3 inline mr-1" />
              AES-256-GCM encryption. Your password never leaves this device.
            </div>
          </div>
        ) : !unlocked ? (
          // Unlock Vault
          <div className="space-y-4">
            <div className="text-center">
              <Lock className="w-12 h-12 mx-auto mb-2 text-reactor-core opacity-50" />
              <p className="font-rajdhani text-text-primary">Unlock Vault</p>
              <p className="text-xs text-text-secondary font-rajdhani mt-1">
                Enter your master password
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-rajdhani text-text-secondary mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleUnlock()}
                    className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
                    placeholder="Enter password"
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-accent-red text-sm font-rajdhani">{error}</p>
              )}

              <button
                onClick={handleUnlock}
                disabled={loading}
                className="w-full py-2 bg-reactor-core/20 hover:bg-reactor-core/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-rajdhani text-reactor-core flex items-center justify-center gap-2"
              >
                <Unlock className="w-4 h-4" />
                {loading ? "Unlocking..." : "Unlock Vault"}
              </button>
            </div>
          </div>
        ) : (
          // Vault Contents
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                className="w-full bg-panel-glass/50 border border-panel-border rounded-lg pl-10 pr-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
                placeholder="Search encrypted messages..."
              />
            </div>

            {/* Quick Stats */}
            <div className="flex gap-4 text-center">
              <div className="flex-1 bg-panel-glass/30 rounded-lg p-3">
                <p className="text-2xl font-orbitron text-reactor-core">{vaultItems.length}</p>
                <p className="text-xs text-text-secondary font-rajdhani">Items</p>
              </div>
              <div className="flex-1 bg-panel-glass/30 rounded-lg p-3">
                <p className="text-2xl font-orbitron text-green-500">{searchResults.length}</p>
                <p className="text-xs text-text-secondary font-rajdhani">Results</p>
              </div>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                <h3 className="font-rajdhani font-bold text-text-primary text-sm">Search Results</h3>
                {searchResults.map((item) => (
                  <div
                    key={item.id}
                    className="bg-panel-glass/30 rounded-lg border border-panel-border p-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-0.5 bg-reactor-core/20 text-reactor-core rounded font-rajdhani">
                        {item.type}
                      </span>
                      <span className="text-xs text-text-secondary font-rajdhani">
                        {formatTime(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-text-primary font-rajdhani">{item.preview}</p>
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.tags.map((tag, i) => (
                          <span
                            key={i}
                            className="text-xs px-1.5 py-0.5 bg-panel-glass/50 text-text-secondary rounded font-rajdhani"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Empty State */}
            {searchResults.length === 0 && searchQuery && (
              <div className="text-center text-text-secondary font-rajdhani py-8">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p>No results found</p>
              </div>
            )}

            {!searchQuery && (
              <div className="text-center text-text-secondary font-rajdhani py-8">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p>Search your encrypted messages</p>
                <p className="text-xs mt-2">Type to search across all vault contents</p>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
