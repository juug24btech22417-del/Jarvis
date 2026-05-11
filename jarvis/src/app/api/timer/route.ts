import { NextRequest, NextResponse } from "next/server";

// In-memory timers (use Redis/database in production)
interface Timer {
  id: string;
  endTime: number;
  label: string;
  isAlarm: boolean;
}

let timers: Timer[] = [];

// Clean expired timers periodically
setInterval(() => {
  const now = Date.now();
  timers = timers.filter(t => t.endTime > now);
}, 60000);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, minutes, seconds, label, timerId } = body;

    switch (action) {
      case "create": {
        const duration = (minutes || 0) * 60 * 1000 + (seconds || 0) * 1000;
        if (!duration) {
          return NextResponse.json({ error: "Duration required" }, { status: 400 });
        }

        const timer: Timer = {
          id: Math.random().toString(36).slice(2),
          endTime: Date.now() + duration,
          label: label || `Timer for ${minutes || 0}m${seconds || 0}s`,
          isAlarm: false,
        };

        timers.push(timer);
        return NextResponse.json({ success: true, timer });
      }

      case "alarm": {
        const [hours, mins] = (label || "").split(":").map(Number);
        if (!hours || !mins) {
          return NextResponse.json({ error: "Time format should be HH:MM" }, { status: 400 });
        }

        const now = new Date();
        const alarmTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins);

        if (alarmTime.getTime() < now.getTime()) {
          alarmTime.setDate(alarmTime.getDate() + 1); // Tomorrow
        }

        const alarm: Timer = {
          id: Math.random().toString(36).slice(2),
          endTime: alarmTime.getTime(),
          label: `Alarm for ${hours}:${mins.toString().padStart(2, "0")}`,
          isAlarm: true,
        };

        timers.push(alarm);
        return NextResponse.json({ success: true, alarm });
      }

      case "list": {
        const now = Date.now();
        const activeTimers = timers
          .filter(t => t.endTime > now)
          .map(t => ({
            ...t,
            remaining: Math.ceil((t.endTime - now) / 1000),
          }));
        return NextResponse.json({ success: true, timers: activeTimers });
      }

      case "cancel": {
        if (!timerId) {
          // Cancel all
          timers = [];
          return NextResponse.json({ success: true, message: "All timers cancelled" });
        }
        timers = timers.filter(t => t.id !== timerId);
        return NextResponse.json({ success: true });
      }

      case "check": {
        const now = Date.now();
        const triggered = timers.filter(t => t.endTime <= now);
        if (triggered.length > 0) {
          timers = timers.filter(t => t.endTime > now);
          return NextResponse.json({
            success: true,
            triggered: triggered.map(t => t.label),
          });
        }
        return NextResponse.json({ success: true, triggered: [] });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Timer API error:", error);
    return NextResponse.json(
      { error: "Timer command failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  const now = Date.now();
  const activeTimers = timers
    .filter(t => t.endTime > now)
    .map(t => ({
      ...t,
      remainingSeconds: Math.ceil((t.endTime - now) / 1000),
    }));

  return NextResponse.json({ success: true, timers: activeTimers });
}
