"use client";

import { useEffect, useCallback } from "react";

export function useNotifications() {
  // Request permission on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if notifications are supported
    if (!("Notification" in window)) {
      console.log("[Notifications] Not supported in this browser");
      return;
    }

    // Request permission
    if (Notification.permission === "default") {
      Notification.requestPermission().then((permission) => {
        console.log("[Notifications] Permission:", permission);
      });
    }
  }, []);

  const notify = useCallback((title: string, options?: NotificationOptions) => {
    if (typeof window === "undefined") return false;

    if (!("Notification" in window)) {
      console.log("[Notifications] Not supported");
      return false;
    }

    if (Notification.permission !== "granted") {
      console.log("[Notifications] Permission not granted");
      return false;
    }

    try {
      const notification = new Notification(title, {
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        ...options,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return true;
    } catch (error) {
      console.error("[Notifications] Error:", error);
      return false;
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined") return false;
    if (!("Notification" in window)) return false;

    const permission = await Notification.requestPermission();
    return permission === "granted";
  }, []);

  const hasPermission = typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";

  return {
    notify,
    requestPermission,
    hasPermission,
  };
}

// Predefined notifications for JARVIS
export const jarvisNotifications = {
  taskReminder: (taskTitle: string) => ({
    title: "J.A.R.V.I.S. - Task Reminder",
    body: `Reminder: ${taskTitle}`,
    tag: "task-reminder",
  }),

  morningBriefing: () => ({
    title: "J.A.R.V.I.S. - Morning Briefing",
    body: "Good morning, Boss. Your briefing is ready.",
    tag: "morning-briefing",
  }),

  systemAlert: (message: string) => ({
    title: "J.A.R.V.I.S. - System Alert",
    body: message,
    tag: "system-alert",
  }),

  greeting: (userName: string) => ({
    title: "J.A.R.V.I.S.",
    body: `Welcome back, ${userName}. JARVIS is online and ready.`,
    tag: "greeting",
  }),
};
