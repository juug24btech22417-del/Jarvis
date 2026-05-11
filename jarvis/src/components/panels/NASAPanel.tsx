"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Rocket,
  Image as ImageIcon,
  Globe,
  AlertTriangle,
  Loader2,
  Calendar,
  Camera,
  Sun,
  Moon,
  ExternalLink,
  Info,
  ChevronRight,
  Sparkles,
} from "lucide-react";

type NASAType = "apod" | "mars" | "neo" | "epic";

interface APODData {
  title: string;
  date: string;
  explanation: string;
  url: string;
  hdUrl: string;
  mediaType: string;
  copyright?: string;
}

interface MarsPhoto {
  id: number;
  sol: number;
  camera: string;
  imgSrc: string;
  earthDate: string;
}

interface NEOData {
  name: string;
  diameter: { estimated_diameter_min: number; estimated_diameter_max: number };
  hazardous: boolean;
  approachDate: string;
  missDistance: string;
  velocity: string;
}

const tabs = [
  { id: "apod" as NASAType, icon: Sun, label: "APOD", desc: "Astronomy Picture" },
  { id: "mars" as NASAType, icon: Moon, label: "Mars", desc: "Rover Photos" },
  { id: "neo" as NASAType, icon: AlertTriangle, label: "Asteroids", desc: "Near-Earth Objects" },
  { id: "epic" as NASAType, icon: Globe, label: "Earth", desc: "Live from Space" },
];

export default function NASAPanel() {
  const [activeTab, setActiveTab] = useState<NASAType>("apod");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [expandedExplanation, setExpandedExplanation] = useState(false);

  const fetchData = async (type: NASAType) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type });
      if (type === "apod") {
        params.set("date", selectedDate);
      }
      const res = await fetch(`/api/nasa?${params}`);
      const result = await res.json();
      if (result.success) {
        setData(result.data);
      } else {
        setData(null);
      }
    } catch (err) {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData("apod");
  }, []);

  const handleTabChange = (type: NASAType) => {
    setActiveTab(type);
    setData(null);
    setExpandedExplanation(false);
    setTimeout(() => fetchData(type), 50);
  };

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Ambient Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-cyan-500/10 via-blue-500/5 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Glass Header */}
      <div className="relative p-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl blur-lg opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/90 to-purple-600/90 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl">
                <Rocket className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-white via-blue-100 to-blue-200 bg-clip-text text-transparent">
                Cosmic Explorer
              </h3>
              <p className="text-xs text-blue-300/60 font-medium tracking-wide uppercase">
                NASA Data Observatory
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10">
            <Sparkles className="w-3 h-3 text-blue-400" />
            <span className="text-xs text-blue-200/70">Live Data</span>
          </div>
        </div>

        {/* Premium Tab Navigation */}
        <div className="mt-6 flex gap-2 p-1.5 rounded-2xl bg-black/20 backdrop-blur-xl border border-white/10">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`relative flex-1 flex flex-col items-center gap-1 px-3 py-3 rounded-xl transition-all duration-300 ${
                  isActive
                    ? "text-white"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-gradient-to-br from-blue-500/80 to-purple-600/80 rounded-xl border border-white/20 shadow-lg"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-10">
                  <Icon className="w-5 h-5" />
                </span>
                <span className="relative z-10 text-[10px] font-semibold tracking-wider uppercase">
                  {tab.label}
                </span>
                <span className="relative z-10 text-[8px] text-white/50">
                  {tab.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="h-full flex flex-col items-center justify-center gap-4"
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
                  <Loader2 className="w-10 h-10 text-blue-400 animate-spin relative" />
                </div>
                <p className="text-sm text-blue-200/60 font-medium tracking-wide">
                  Receiving transmission...
                </p>
              </motion.div>
            ) : !data ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="h-full flex flex-col items-center justify-center text-center p-8"
              >
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/30 to-purple-500/30 rounded-full blur-2xl" />
                  <Rocket className="w-16 h-16 text-white/20 relative" />
                </div>
                <p className="text-white/40 text-sm mb-4">
                  Select a mission to begin exploration
                </p>
                <button
                  onClick={() => fetchData(activeTab)}
                  className="px-6 py-2.5 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
                >
                  <Globe className="w-4 h-4" />
                  Initialize {activeTab.toUpperCase()}
                </button>
              </motion.div>
            ) : activeTab === "apod" ? (
              <APODSection
                data={data}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                fetchData={fetchData}
                expandedExplanation={expandedExplanation}
                setExpandedExplanation={setExpandedExplanation}
              />
            ) : activeTab === "mars" ? (
              <MarsSection data={data} />
            ) : activeTab === "neo" ? (
              <NEOSection data={data} />
            ) : (
              <EPICSection data={data} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function APODSection({
  data,
  selectedDate,
  setSelectedDate,
  fetchData,
  expandedExplanation,
  setExpandedExplanation,
}: {
  data: APODData;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  fetchData: (type: NASAType) => void;
  expandedExplanation: boolean;
  setExpandedExplanation: (v: boolean) => void;
}) {
  return (
    <motion.div
      key="apod"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-5"
    >
      {/* Date Selector */}
      <div className="flex items-center gap-3 p-1 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10">
        <div className="flex items-center gap-2 px-3 py-2">
          <Calendar className="w-4 h-4 text-blue-400" />
          <span className="text-xs text-white/60">Mission Date</span>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          max={new Date().toISOString().split("T")[0]}
          className="flex-1 px-3 py-2 bg-transparent text-white text-sm outline-none [color-scheme:dark]"
        />
        <button
          onClick={() => fetchData("apod")}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500/80 to-purple-500/80 text-white text-sm font-medium hover:from-blue-500 hover:to-purple-500 transition-all"
        >
          Explore
        </button>
      </div>

      {/* Hero Image Card */}
      <div className="group relative rounded-3xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10" />
        <motion.img
          src={data.url}
          alt={data.title}
          className="w-full aspect-video object-cover"
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        <div className="absolute bottom-0 left-0 right-0 p-6 z-20">
          <motion.h4
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-2xl font-bold text-white mb-2 leading-tight"
          >
            {data.title}
          </motion.h4>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-center gap-3 text-xs text-white/60"
          >
            <span className="px-2 py-1 rounded-full bg-white/10 backdrop-blur-sm">
              {data.date}
            </span>
            {data.copyright && (
              <span className="px-2 py-1 rounded-full bg-white/10 backdrop-blur-sm">
                © {data.copyright}
              </span>
            )}
          </motion.div>
        </div>
      </div>

      {/* Description Card */}
      <div className="p-6 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10">
        <div className="flex items-center gap-2 mb-4">
          <Info className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white/80">About this image</span>
        </div>
        <p
          className={`text-sm text-white/60 leading-relaxed ${
            expandedExplanation ? "" : "line-clamp-4"
          }`}
        >
          {data.explanation}
        </p>
        {data.explanation.length > 300 && (
          <button
            onClick={() => setExpandedExplanation(!expandedExplanation)}
            className="mt-3 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            {expandedExplanation ? "Show less" : "Read more"}
            <ChevronRight
              className={`w-3 h-3 transition-transform ${
                expandedExplanation ? "rotate-90" : ""
              }`}
            />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function MarsSection({ data }: { data: MarsPhoto[] & { demo?: boolean } }) {
  const isDemo = data.demo;
  const photos = Array.isArray(data) ? data : [];

  return (
    <motion.div
      key="mars"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-bold text-white">Mars Rover Mission</h4>
          <p className="text-xs text-white/40">Curiosity Surface Operations</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20">
          <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
          <span className="text-xs text-orange-400">Live</span>
        </div>
      </div>

      {isDemo && (
        <div className="px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 backdrop-blur-md">
          <p className="text-xs text-amber-300/80 flex items-center gap-2">
            <Info className="w-3 h-3" />
            Showing demonstration images. NASA Mars API temporarily unavailable.
          </p>
        </div>
      )}

      {/* Photo Grid */}
      <div className="grid grid-cols-2 gap-4">
        {photos.map((photo, idx) => (
          <motion.div
            key={photo.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.1 }}
            className="group relative rounded-2xl overflow-hidden bg-gradient-to-br from-orange-900/20 to-red-900/20 border border-white/10 backdrop-blur-sm"
          >
            <div className="aspect-square relative overflow-hidden">
              <img
                src={photo.imgSrc}
                alt={photo.camera}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent">
              <p className="text-xs font-medium text-white truncate">{photo.camera}</p>
              <p className="text-[10px] text-white/50">Sol {photo.sol}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function NEOSection({ data }: { data: NEOData[] }) {
  return (
    <motion.div
      key="neo"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-bold text-white">Asteroid Tracking</h4>
          <p className="text-xs text-white/40">Near-Earth Object Monitoring</p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-bold text-white">{data.length}</span>
          <span className="text-xs text-white/40 block">Objects detected</span>
        </div>
      </div>

      {/* NEO Cards */}
      <div className="space-y-3">
        {data.map((neo, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={`p-5 rounded-2xl border backdrop-blur-xl ${
              neo.hazardous
                ? "bg-red-500/5 border-red-500/30"
                : "bg-white/5 border-white/10"
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h5 className="text-sm font-bold text-white mb-1">{neo.name.replace('(', '').replace(')', '')}</h5>
                <div className="flex items-center gap-2">
                  {neo.approachDate && (
                    <span className="text-[10px] text-white/40">
                      {new Date(neo.approachDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              {neo.hazardous && (
                <span className="px-2.5 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-bold uppercase tracking-wider">
                  Hazardous
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Diameter</p>
                <p className="text-xs font-semibold text-white">
                  {Math.round(neo.diameter?.estimated_diameter_min || 0)}-
                  {Math.round(neo.diameter?.estimated_diameter_max || 0)} km
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Miss Distance</p>
                <p className="text-xs font-semibold text-white">
                  {parseInt(neo.missDistance || "0").toLocaleString()} km
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Velocity</p>
                <p className="text-xs font-semibold text-white">
                  {parseInt(neo.velocity || "0").toLocaleString()} km/h
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function EPICSection({ data }: { data: any[] }) {
  const images = Array.isArray(data) ? data : [];

  return (
    <motion.div
      key="epic"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-bold text-white">Earth Live</h4>
          <p className="text-xs text-white/40">DSCOVR EPIC Camera</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-green-400">Active</span>
        </div>
      </div>

      {/* Earth Images */}
      <div className="space-y-4">
        {images.slice(0, 3).map((image, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="group relative rounded-3xl overflow-hidden bg-gradient-to-br from-blue-900/30 to-cyan-900/30 border border-white/10"
          >
            <div className="aspect-[16/9] relative">
              <img
                src={image.image}
                alt="Earth"
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <p className="text-sm text-white/90 mb-1">{image.caption || "Earth from Space"}</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/50">
                  {image.date && new Date(image.date).toLocaleString()}
                </span>
                {image.coords && (
                  <span className="text-[10px] text-cyan-400">
                    Lat: {image.coords.lat?.toFixed(1)}°, Lon: {image.coords.lon?.toFixed(1)}°
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
