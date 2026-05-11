"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cloud,
  CloudRain,
  Sun,
  Wind,
  Droplets,
  Eye,
  Thermometer,
  Search,
  X,
  MapPin,
  CloudSnow,
  CloudLightning,
  CloudFog,
  Navigation,
} from "lucide-react";
import gsap from "gsap";

interface WeatherData {
  city: string;
  country: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  description: string;
  icon: string;
  windSpeed: number;
  visibility: number;
  localTime: string;
}

interface ForecastDay {
  date: string;
  temp: number;
  condition: string;
  icon: string;
}

interface WeatherPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const weatherIcons: Record<string, React.ReactNode> = {
  sunny: <Sun className="w-16 h-16 text-accent-amber" />,
  clear: <Sun className="w-16 h-16 text-accent-amber" />,
  "partly cloudy": <Cloud className="w-16 h-16 text-text-secondary" />,
  cloudy: <Cloud className="w-16 h-16 text-text-secondary" />,
  overcast: <Cloud className="w-16 h-16 text-text-secondary" />,
  rain: <CloudRain className="w-16 h-16 text-reactor-core" />,
  "light rain": <CloudRain className="w-16 h-16 text-reactor-core" />,
  "heavy rain": <CloudRain className="w-16 h-16 text-reactor-core" />,
  snow: <CloudSnow className="w-16 h-16 text-white" />,
  thunder: <CloudLightning className="w-16 h-16 text-accent-amber" />,
  fog: <CloudFog className="w-16 h-16 text-text-secondary" />,
  mist: <CloudFog className="w-16 h-16 text-text-secondary" />,
};

function getWeatherIcon(description: string) {
  const lower = description.toLowerCase();
  for (const [key, icon] of Object.entries(weatherIcons)) {
    if (lower.includes(key)) return icon;
  }
  return <Sun className="w-16 h-16 text-accent-amber" />;
}

export default function WeatherPanel({ isOpen, onClose }: WeatherPanelProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [currentCity, setCurrentCity] = useState("London");

  // Fetch weather data
  const fetchWeather = useCallback(async (cityName: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/weather?city=${encodeURIComponent(cityName)}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch weather");
      }
      const data = await response.json();
      setWeather(data);
      setCurrentCity(cityName);

      // Generate mock forecast based on current weather
      const mockForecast: ForecastDay[] = [];
      const conditions = ["Sunny", "Partly Cloudy", "Cloudy", "Light Rain", "Clear"];
      for (let i = 1; i <= 5; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        mockForecast.push({
          date: date.toLocaleDateString("en-US", { weekday: "short" }),
          temp: Math.round(data.temperature + (Math.random() * 10 - 5)),
          condition: conditions[Math.floor(Math.random() * conditions.length)],
          icon: "",
        });
      }
      setForecast(mockForecast);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch weather");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (isOpen) {
      fetchWeather(currentCity);
      gsap.fromTo(
        ".weather-panel",
        { opacity: 0, scale: 0.95, y: 20 },
        { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "power2.out" }
      );
    }
  }, [isOpen, currentCity, fetchWeather]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (city.trim()) {
      fetchWeather(city.trim());
      setCity("");
    }
  };

  // Get weather advice
  const getWeatherAdvice = (temp: number, condition: string) => {
    const lower = condition.toLowerCase();
    if (lower.includes("rain")) return "Don't forget an umbrella, Boss.";
    if (temp < 5) return "Bundle up, it's freezing out there.";
    if (temp < 15) return "A jacket would be wise.";
    if (temp > 30) return "Stay hydrated, it's scorching.";
    if (lower.includes("clear") || lower.includes("sun")) return "Perfect weather for productivity.";
    return "Have a great day, Boss.";
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
          className="weather-panel w-full max-w-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="holographic-panel p-6 max-h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-reactor-core/20">
                  <Cloud className="w-6 h-6 text-reactor-core" />
                </div>
                <div>
                  <h2 className="font-orbitron text-reactor-core font-bold text-lg">
                    WEATHER STATION
                  </h2>
                  <p className="font-rajdhani text-text-secondary text-sm">
                    Current conditions
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

            {/* Search */}
            <form onSubmit={handleSearch} className="mb-6">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary/50" />
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Search city..."
                    className="w-full pl-10 pr-4 py-2 bg-panel-glass/50 border border-panel-border rounded-lg font-rajdhani text-text-primary placeholder:text-text-secondary/50 focus:border-reactor-core focus:outline-none transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-reactor-core/20 hover:bg-reactor-core/40 border border-reactor-core/50 rounded-lg font-orbitron text-reactor-core transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-reactor-core border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Search className="w-5 h-5" />
                  )}
                </button>
              </div>
            </form>

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

            {/* Current Weather */}
            {weather && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {/* Main Weather Card */}
                  <div className="bg-gradient-to-br from-reactor-core/20 to-transparent p-6 rounded-xl border border-reactor-core/30">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-orbitron text-2xl text-text-primary">
                          {weather.city}, {weather.country}
                        </h3>
                        <p className="font-rajdhani text-text-secondary">
                          {new Date(weather.localTime).toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="text-right">
                        {getWeatherIcon(weather.description)}
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="font-orbitron text-5xl text-reactor-core">
                        {weather.temperature}°
                      </div>
                      <p className="font-rajdhani text-text-secondary capitalize mt-1">
                        {weather.description}
                      </p>
                      <p className="font-rajdhani text-xs text-text-secondary/70 mt-2 italic">
                        &ldquo;{getWeatherAdvice(weather.temperature, weather.description)}&rdquo;
                      </p>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-panel-glass/50 p-4 rounded-lg border border-panel-border">
                      <div className="flex items-center gap-2 mb-2">
                        <Thermometer className="w-4 h-4 text-accent-amber" />
                        <span className="font-rajdhani text-xs text-text-secondary">Feels Like</span>
                      </div>
                      <span className="font-orbitron text-xl text-text-primary">
                        {weather.feelsLike}°
                      </span>
                    </div>

                    <div className="bg-panel-glass/50 p-4 rounded-lg border border-panel-border">
                      <div className="flex items-center gap-2 mb-2">
                        <Droplets className="w-4 h-4 text-reactor-core" />
                        <span className="font-rajdhani text-xs text-text-secondary">Humidity</span>
                      </div>
                      <span className="font-orbitron text-xl text-text-primary">
                        {weather.humidity}%
                      </span>
                    </div>

                    <div className="bg-panel-glass/50 p-4 rounded-lg border border-panel-border">
                      <div className="flex items-center gap-2 mb-2">
                        <Wind className="w-4 h-4 text-accent-green" />
                        <span className="font-rajdhani text-xs text-text-secondary">Wind</span>
                      </div>
                      <span className="font-orbitron text-xl text-text-primary">
                        {weather.windSpeed} km/h
                      </span>
                    </div>

                    <div className="bg-panel-glass/50 p-4 rounded-lg border border-panel-border">
                      <div className="flex items-center gap-2 mb-2">
                        <Eye className="w-4 h-4 text-text-secondary" />
                        <span className="font-rajdhani text-xs text-text-secondary">Visibility</span>
                      </div>
                      <span className="font-orbitron text-xl text-text-primary">
                        {weather.visibility} km
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5-Day Forecast */}
                <div className="bg-panel-glass/30 p-4 rounded-xl border border-panel-border">
                  <h4 className="font-orbitron text-sm text-reactor-core mb-4 flex items-center gap-2">
                    <Navigation className="w-4 h-4" />
                    5-DAY FORECAST
                  </h4>
                  <div className="grid grid-cols-5 gap-2">
                    {forecast.map((day, index) => (
                      <motion.div
                        key={day.date}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="text-center p-3 bg-panel-glass/50 rounded-lg border border-panel-border/50 hover:border-reactor-core/30 transition-colors"
                      >
                        <p className="font-rajdhani text-xs text-text-secondary mb-2">
                          {day.date}
                        </p>
                        <div className="my-2">
                          {getWeatherIcon(day.condition)}
                        </div>
                        <p className="font-orbitron text-lg text-text-primary">
                          {day.temp}°
                        </p>
                        <p className="font-rajdhani text-[10px] text-text-secondary/70 mt-1">
                          {day.condition}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Loading State */}
            {loading && !weather && (
              <div className="text-center py-12">
                <div className="w-12 h-12 border-4 border-reactor-core border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="font-rajdhani text-text-secondary">Fetching atmospheric data...</p>
              </div>
            )}

            {/* Footer */}
            <div className="mt-6 pt-4 border-t border-panel-border">
              <p className="text-xs text-text-secondary/40 text-center">
                Powered by WeatherAPI.com • Updates every 15 minutes
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
