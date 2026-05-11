"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar as CalendarIcon,
  X,
  Clock,
  MapPin,
  Users,
  Video,
  Plus,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import gsap from "gsap";

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  meetLink?: string;
  link: string;
  status: string;
  isAllDay?: boolean;
}

interface CalendarPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CalendarPanel({ isOpen, onClose }: CalendarPanelProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  // New event form
  const [newEvent, setNewEvent] = useState({
    title: "",
    description: "",
    start: "",
    end: "",
    location: "",
  });

  // Fetch events
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/calendar");
      const data = await response.json();

      if (data.success || data.events) {
        setEvents(data.events);
        setIsAuthenticated(data.authenticated !== false);
      } else {
        throw new Error(data.error || "Failed to fetch events");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (isOpen) {
      fetchEvents();
      gsap.fromTo(
        ".calendar-panel",
        { opacity: 0, scale: 0.95, y: 20 },
        { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "power2.out" }
      );
    }
  }, [isOpen, fetchEvents]);

  // Create event
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvent.title || !newEvent.start || !newEvent.end) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          summary: newEvent.title,
          description: newEvent.description,
          start: newEvent.start,
          end: newEvent.end,
          location: newEvent.location,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setEvents((prev) => [data.event, ...prev]);
        setSuccess(data.demo ? "Event created (Demo Mode - not saved to Google)" : "Event created successfully!");
        setTimeout(() => {
          setShowAddEvent(false);
          setNewEvent({
            title: "",
            description: "",
            start: "",
            end: "",
            location: "",
          });
          setSuccess(null);
        }, 1500);
      } else {
        setError(data.error || "Failed to create event");
      }
    } catch (err) {
      setError("Failed to create event: " + String(err));
    } finally {
      setLoading(false);
    }
  };

  // Delete event
  const handleDeleteEvent = async (eventId: string) => {
    try {
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", eventId }),
      });

      if (response.ok) {
        setEvents((prev) => prev.filter((e) => e.id !== eventId));
      }
    } catch (err) {
      setError("Failed to delete event");
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  // Format time
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Get events for selected date
  const getEventsForDate = (date: Date) => {
    return events.filter((event) => {
      const eventDate = new Date(event.start);
      return eventDate.toDateString() === date.toDateString();
    });
  };

  // Get upcoming events (next 7 days)
  const getUpcomingEvents = () => {
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    return events
      .filter((event) => {
        const eventDate = new Date(event.start);
        return eventDate >= now && eventDate <= nextWeek;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  };

  // Get event status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed":
        return "border-l-accent-green";
      case "tentative":
        return "border-l-accent-amber";
      case "cancelled":
        return "border-l-accent-red";
      default:
        return "border-l-reactor-core";
    }
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
          className="calendar-panel w-full max-w-4xl max-h-[85vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="holographic-panel flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-6 border-b border-panel-border flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-reactor-core/20">
                    <CalendarIcon className="w-6 h-6 text-reactor-core" />
                  </div>
                  <div>
                    <h2 className="font-orbitron text-reactor-core font-bold text-lg">
                      GOOGLE CALENDAR
                    </h2>
                    <p className="font-rajdhani text-text-secondary text-sm">
                      {events.length} upcoming events
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setShowAddEvent(true);
                      setError(null);
                      setSuccess(null);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-reactor-core/20 hover:bg-reactor-core/40 border border-reactor-core/50 rounded-lg font-rajdhani text-reactor-core transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Event
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-panel-glass rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-text-secondary" />
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Auth Warning */}
              {!isAuthenticated && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-4 bg-accent-amber/20 border border-accent-amber/50 rounded-lg"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 text-accent-amber" />
                    <span className="font-orbitron text-accent-amber">
                      Demo Mode
                    </span>
                  </div>
                  <p className="text-text-secondary text-sm">
                    Google Calendar not connected. Showing demo events.
                  </p>
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

              {/* Loading */}
              {loading && events.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 border-4 border-reactor-core border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="font-rajdhani text-text-secondary">
                    Syncing calendar...
                  </p>
                </div>
              )}

              {/* Events List */}
              <div className="space-y-6">
                {/* Today's Events */}
                <div>
                  <h3 className="font-orbitron text-sm text-reactor-core mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    UPCOMING EVENTS
                  </h3>

                  {getUpcomingEvents().length > 0 ? (
                    <div className="space-y-3">
                      {getUpcomingEvents().map((event, index) => (
                        <motion.div
                          key={event.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className={`bg-panel-glass/30 rounded-lg border-l-4 ${getStatusColor(
                            event.status
                          )} border-t border-r border-b border-panel-border/50 p-4 group hover:bg-panel-glass/50 transition-colors`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-rajdhani text-xs text-reactor-core">
                                  {formatDate(event.start)}
                                </span>
                                <span className="text-text-secondary/30">•</span>
                                <span className="font-rajdhani text-xs text-text-secondary">
                                  {formatTime(event.start)} -{" "}
                                  {formatTime(event.end)}
                                </span>
                              </div>

                              <h4 className="font-orbitron text-text-primary mb-1">
                                {event.title}
                              </h4>

                              {event.description && (
                                <p className="font-rajdhani text-text-secondary/70 text-sm mb-2">
                                  {event.description}
                                </p>
                              )}

                              <div className="flex items-center gap-4 text-xs text-text-secondary/50">
                                {event.location && (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {event.location}
                                  </span>
                                )}
                                {event.attendees && (
                                  <span className="flex items-center gap-1">
                                    <Users className="w-3 h-3" />
                                    {event.attendees.length} guests
                                  </span>
                                )}
                              </div>

                              {/* Action Buttons */}
                              <div className="flex gap-2 mt-3">
                                {event.meetLink && (
                                  <a
                                    href={event.meetLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 px-3 py-1.5 bg-accent-green/20 hover:bg-accent-green/40 rounded text-accent-green text-xs font-rajdhani transition-colors"
                                  >
                                    <Video className="w-3 h-3" />
                                    Join
                                  </a>
                                )}
                                <a
                                  href={event.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 px-3 py-1.5 bg-panel-glass hover:bg-panel-border rounded text-text-secondary text-xs font-rajdhani transition-colors"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  View
                                </a>
                                <button
                                  onClick={() => handleDeleteEvent(event.id)}
                                  className="flex items-center gap-1 px-3 py-1.5 bg-accent-red/10 hover:bg-accent-red/20 rounded text-accent-red text-xs font-rajdhani transition-colors ml-auto opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CalendarIcon className="w-12 h-12 text-text-secondary/30 mx-auto mb-3" />
                      <p className="font-rajdhani text-text-secondary">
                        No upcoming events
                      </p>
                      <p className="font-rajdhani text-text-secondary/50 text-sm mt-1">
                        Click "Add Event" to create one
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Add Event Modal */}
        <AnimatePresence>
          {showAddEvent && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => {
                setShowAddEvent(false);
                setError(null);
                setSuccess(null);
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="holographic-panel p-6 max-w-md w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="font-orbitron text-reactor-core font-bold text-lg mb-4">
                  ADD EVENT
                </h3>

                <form onSubmit={handleCreateEvent} className="space-y-4">
                  {/* Success Message */}
                  {success && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 bg-accent-green/20 border border-accent-green/50 rounded-lg"
                    >
                      <p className="text-accent-green text-sm">{success}</p>
                    </motion.div>
                  )}

                  {/* Error Message */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 bg-accent-red/20 border border-accent-red/50 rounded-lg"
                    >
                      <p className="text-accent-red text-sm">{error}</p>
                    </motion.div>
                  )}

                  <div>
                    <label className="block font-rajdhani text-text-secondary text-sm mb-1">
                      Title *
                    </label>
                    <input
                      type="text"
                      value={newEvent.title}
                      onChange={(e) =>
                        setNewEvent({ ...newEvent, title: e.target.value })
                      }
                      required
                      className="w-full px-3 py-2 bg-panel-glass/50 border border-panel-border rounded-lg font-rajdhani text-text-primary focus:border-reactor-core focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-rajdhani text-text-secondary text-sm mb-1">
                        Start *
                      </label>
                      <input
                        type="datetime-local"
                        value={newEvent.start}
                        onChange={(e) =>
                          setNewEvent({ ...newEvent, start: e.target.value })
                        }
                        required
                        className="w-full px-3 py-2 bg-panel-glass/50 border border-panel-border rounded-lg font-rajdhani text-text-primary focus:border-reactor-core focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-rajdhani text-text-secondary text-sm mb-1">
                        End *
                      </label>
                      <input
                        type="datetime-local"
                        value={newEvent.end}
                        onChange={(e) =>
                          setNewEvent({ ...newEvent, end: e.target.value })
                        }
                        required
                        className="w-full px-3 py-2 bg-panel-glass/50 border border-panel-border rounded-lg font-rajdhani text-text-primary focus:border-reactor-core focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-rajdhani text-text-secondary text-sm mb-1">
                      Location
                    </label>
                    <input
                      type="text"
                      value={newEvent.location}
                      onChange={(e) =>
                        setNewEvent({ ...newEvent, location: e.target.value })
                      }
                      placeholder="Conference Room, Zoom, etc."
                      className="w-full px-3 py-2 bg-panel-glass/50 border border-panel-border rounded-lg font-rajdhani text-text-primary focus:border-reactor-core focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-rajdhani text-text-secondary text-sm mb-1">
                      Description
                    </label>
                    <textarea
                      value={newEvent.description}
                      onChange={(e) =>
                        setNewEvent({ ...newEvent, description: e.target.value })
                      }
                      rows={3}
                      className="w-full px-3 py-2 bg-panel-glass/50 border border-panel-border rounded-lg font-rajdhani text-text-primary focus:border-reactor-core focus:outline-none resize-none"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowAddEvent(false)}
                      className="flex-1 py-2 bg-panel-glass hover:bg-panel-border rounded-lg font-rajdhani text-text-secondary transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !newEvent.title}
                      className="flex-1 py-2 bg-reactor-core/20 hover:bg-reactor-core/40 border border-reactor-core/50 rounded-lg font-orbitron text-reactor-core transition-colors disabled:opacity-50"
                    >
                      {loading ? "Creating..." : "Create Event"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
