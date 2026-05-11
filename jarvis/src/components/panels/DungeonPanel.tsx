"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dice5, BookOpen, Book, Map, Users, Settings, ChevronRight, X, Send, Volume2, VolumeX, Scroll, Heart, Shield, Sword, Sparkles } from "lucide-react";

interface StoryEntry {
  turn: number;
  narrator: string;
  playerAction?: string;
}

interface Character {
  name: string;
  class: string;
  level: number;
  health: number;
  maxHealth: number;
  stats: Record<string, number>;
  inventory: string[];
}

interface GameSession {
  id: string;
  campaign: string;
  setting: string;
  character: Character;
  story: StoryEntry[];
  currentLocation: string;
}

const CAMPAIGNS = [
  { id: 'fantasy', name: 'Fantasy Realm', icon: '🏰', description: 'Magic, dragons, and ancient kingdoms' },
  { id: 'cyberpunk', name: 'Cyberpunk City', icon: '🌃', description: 'Neon streets and cybernetic enhancements' },
  { id: 'horror', name: 'Cosmic Horror', icon: '👁️', description: 'Eldritch abominations await' },
  { id: 'scifi', name: 'Space Opera', icon: '🚀', description: 'Galactic empires and alien worlds' },
];

const CLASSES: Record<string, string[]> = {
  fantasy: ['Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger', 'Paladin'],
  cyberpunk: ['Netrunner', 'Street Samurai', 'Fixer', 'Techie', 'Rockerboy', 'Corpo'],
  horror: ['Detective', 'Professor', 'Journalist', 'Doctor', 'Occultist', 'Veteran'],
  scifi: ['Pilot', 'Engineer', 'Marine', 'Diplomat', 'Scientist', 'Smuggler'],
};

export default function DungeonPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [session, setSession] = useState<GameSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState("");
  const [muted, setMuted] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Character creation state
  const [charName, setCharName] = useState("");
  const [charClass, setCharClass] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState("fantasy");
  const [selectedSetting, setSelectedSetting] = useState("");

  const storyEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of story
  useEffect(() => {
    storyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.story]);

  // Create new game
  const handleCreateGame = async () => {
    if (!charName || !charClass || !selectedSetting) {
      alert("Please fill in all fields");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/dungeon/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign: selectedCampaign,
          setting: selectedSetting,
          character: {
            name: charName,
            class: charClass,
            backstory: "A brave adventurer seeking fortune and glory.",
            stats: {
              strength: 10,
              dexterity: 10,
              intelligence: 10,
              constitution: 10,
              wisdom: 10,
              charisma: 10,
            },
            inventory: ["Basic Supplies", "Rations (3 days)", "Water Flask"],
          },
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSession({
          id: data.session.id,
          campaign: data.session.campaign,
          setting: data.session.setting,
          character: data.session.character,
          story: [{ turn: 0, narrator: data.openingNarration }],
          currentLocation: data.session.setting,
        });
      }
    } catch (error) {
      console.error("[Dungeon] Create game failed:", error);
      alert("Failed to start game");
    } finally {
      setLoading(false);
    }
  };

  // Send player action
  const handleAction = async () => {
    if (!action.trim() || !session) return;

    setLoading(true);
    const playerAction = action.trim();
    setAction("");

    try {
      const res = await fetch("/api/dungeon/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          action: playerAction,
          fullContext: session,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSession(prev => prev ? {
          ...prev,
          story: [...prev.story, {
            turn: data.turn,
            narrator: data.narration,
            playerAction,
          }],
        } : null);

        // Speak narration if not muted
        if (!muted && typeof window !== 'undefined' && window.speechSynthesis) {
          const utterance = new SpeechSynthesisUtterance(data.narration);
          utterance.rate = 0.9;
          utterance.pitch = 0.8;
          window.speechSynthesis.speak(utterance);
        }
      }
    } catch (error) {
      console.error("[Dungeon] Action failed:", error);
    } finally {
      setLoading(false);
    }
  };

  // Roll dice
  const handleRoll = async (sides: number = 20) => {
    try {
      const res = await fetch("/api/dungeon/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sides }),
      });

      const data = await res.json();

      if (data.success) {
        setSession(prev => prev ? {
          ...prev,
          story: [...prev.story, {
            turn: prev.story.length + 1,
            narrator: data.narration,
            playerAction: "Dice roll",
          }],
        } : null);
      }
    } catch (error) {
      console.error("[Dungeon] Roll failed:", error);
    }
  };

  // Campaign settings for dropdown
  const settings = CAMPAIGNS.find(c => c.id === selectedCampaign)
    ? ['Ancient Ruins', 'Bustling City', 'Wilderness', 'Coastal Town', 'Mountain Fortress']
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: -100, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -100, scale: 0.9 }}
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] max-w-[95vw] max-h-[85vh] bg-panel-bg/95 backdrop-blur-sm border border-panel-border rounded-xl z-50 shadow-2xl overflow-hidden"
    >
      {!session ? (
        // Character Creation Screen
        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <BookOpen className="w-8 h-8 text-reactor-core" />
              <h2 className="font-orbitron text-2xl text-reactor-core">AI DUNGEON MASTER</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-accent-red/20 rounded transition-colors">
              <X className="w-5 h-5 text-accent-red" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Campaign Selection */}
            <div className="space-y-4">
              <h3 className="font-rajdhani font-bold text-lg text-text-primary">Choose Campaign</h3>
              <div className="space-y-2">
                {CAMPAIGNS.map((campaign) => (
                  <button
                    key={campaign.id}
                    onClick={() => {
                      setSelectedCampaign(campaign.id);
                      setCharClass("");
                    }}
                    className={`w-full p-3 rounded-lg border text-left transition-colors ${
                      selectedCampaign === campaign.id
                        ? "bg-reactor-core/20 border-reactor-core"
                        : "bg-panel-glass/30 border-panel-border hover:bg-panel-glass/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{campaign.icon}</span>
                      <div>
                        <p className="font-rajdhani font-bold text-text-primary">{campaign.name}</p>
                        <p className="text-xs text-text-secondary">{campaign.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Character Creation */}
            <div className="space-y-4">
              <h3 className="font-rajdhani font-bold text-lg text-text-primary">Create Character</h3>

              <div>
                <label className="block text-xs font-rajdhani text-text-secondary mb-1">Name</label>
                <input
                  type="text"
                  value={charName}
                  onChange={(e) => setCharName(e.target.value)}
                  className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
                  placeholder="Your hero's name"
                />
              </div>

              <div>
                <label className="block text-xs font-rajdhani text-text-secondary mb-1">Class</label>
                <select
                  value={charClass}
                  onChange={(e) => setCharClass(e.target.value)}
                  className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
                >
                  <option value="">Select a class</option>
                  {(CLASSES[selectedCampaign] || []).map((cls) => (
                    <option key={cls} value={cls}>{cls}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-rajdhani text-text-secondary mb-1">Starting Location</label>
                <select
                  value={selectedSetting}
                  onChange={(e) => setSelectedSetting(e.target.value)}
                  className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
                >
                  <option value="">Select location</option>
                  {settings.map((setting) => (
                    <option key={setting} value={setting}>{setting}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleCreateGame}
                disabled={loading || !charName || !charClass || !selectedSetting}
                className="w-full py-3 bg-reactor-core/20 hover:bg-reactor-core/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-rajdhani text-reactor-core flex items-center justify-center gap-2"
              >
                <BookOpen className="w-5 h-5" />
                {loading ? "Creating World..." : "Begin Adventure"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        // Game Screen
        <div className="flex flex-col h-[70vh]">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-panel-border">
            <div className="flex items-center gap-3">
              <span className="text-2xl">
                {CAMPAIGNS.find(c => c.id === session.campaign)?.icon}
              </span>
              <div>
                <h2 className="font-orbitron text-reactor-core font-bold">{session.character.name}</h2>
                <p className="text-xs text-text-secondary font-rajdhani">
                  Level {session.character.level} {session.character.class} in {session.currentLocation}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCharacter(!showCharacter)}
                className="p-2 hover:bg-panel-glass/50 rounded transition-colors"
                title="Character Sheet"
              >
                <Book className="w-4 h-4 text-text-secondary" />
              </button>
              <button
                onClick={() => setMuted(!muted)}
                className="p-2 hover:bg-panel-glass/50 rounded transition-colors"
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? <VolumeX className="w-4 h-4 text-text-secondary" /> : <Volume2 className="w-4 h-4 text-text-secondary" />}
              </button>
              <button onClick={onClose} className="p-2 hover:bg-accent-red/20 rounded transition-colors">
                <X className="w-4 h-4 text-accent-red" />
              </button>
            </div>
          </div>

          {/* Story Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {session.story.map((entry, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg border ${
                  entry.playerAction
                    ? "bg-panel-glass/30 border-panel-border/50"
                    : "bg-reactor-core/10 border-reactor-core/30"
                }`}
              >
                {entry.playerAction && entry.playerAction !== "Dice roll" && (
                  <p className="text-xs text-text-secondary font-rajdhani mb-1">
                    <ChevronRight className="w-3 h-3 inline" />
                    {entry.playerAction}
                  </p>
                )}
                <p className="text-text-primary font-rajdhani whitespace-pre-wrap">{entry.narrator}</p>
              </div>
            ))}
            <div ref={storyEndRef} />
          </div>

          {/* Action Input */}
          <div className="p-4 border-t border-panel-border space-y-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleRoll(20)}
                disabled={loading}
                className="p-2 bg-panel-glass/50 hover:bg-panel-glass rounded transition-colors"
                title="Roll d20"
              >
                <Dice5 className="w-5 h-5 text-reactor-core" />
              </button>
              <input
                type="text"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAction()}
                placeholder="What do you do? (e.g., 'Look around', 'Talk to the stranger', 'Draw my sword')"
                className="flex-1 bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
              />
              <button
                onClick={handleAction}
                disabled={loading || !action.trim()}
                className="p-2 bg-reactor-core/20 hover:bg-reactor-core/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <Send className="w-5 h-5 text-reactor-core" />
              </button>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 text-xs font-rajdhani">
              <button
                onClick={() => setAction("I examine my surroundings carefully.")}
                className="px-3 py-1 bg-panel-glass/30 hover:bg-panel-glass/50 rounded transition-colors text-text-secondary"
              >
                Examine
              </button>
              <button
                onClick={() => setAction("I call out to see if anyone responds.")}
                className="px-3 py-1 bg-panel-glass/30 hover:bg-panel-glass/50 rounded transition-colors text-text-secondary"
              >
                Call Out
              </button>
              <button
                onClick={() => setAction("I check my inventory and supplies.")}
                className="px-3 py-1 bg-panel-glass/30 hover:bg-panel-glass/50 rounded transition-colors text-text-secondary"
              >
                Check Gear
              </button>
              <button
                onClick={() => setAction("I proceed cautiously forward.")}
                className="px-3 py-1 bg-panel-glass/30 hover:bg-panel-glass/50 rounded transition-colors text-text-secondary"
              >
                Move Forward
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
