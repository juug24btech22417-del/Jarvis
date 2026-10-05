export interface VitalsReading {
  bpm: number;
  hrv: number;
  stressLevel: "Low" | "Moderate" | "Elevated" | "High";
  stressScore: number; // 0-100
  blinkRate: number;
  fatigueIndex: number; // 0-100
  timestamp: string;
  recommendation: string;
}

export async function handleVitals(action: string, params: Record<string, any>) {
  if (action === "analyze") {
    // A reading must come from a real measurement — never invent a pulse.
    const rawBpm = Number(params.bpm);
    if (!Number.isFinite(rawBpm) || rawBpm <= 0) {
      return { success: false, error: "A measured heart rate (bpm) is required." };
    }
    const bpm = Math.max(45, Math.min(185, Math.round(rawBpm)));

    // HRV is measured when enough R-R intervals exist; otherwise it is derived
    // from the heart rate rather than being a fixed constant.
    const rawHrv = Number(params.hrv);
    const hrv =
      Number.isFinite(rawHrv) && rawHrv > 0
        ? Math.round(rawHrv)
        : Math.round(Math.max(25, 40 + (100 - bpm) * 0.6));

    const rawBlink = Number(params.blinkRate);
    const blinkRate = Number.isFinite(rawBlink) && rawBlink >= 0 ? Math.round(rawBlink) : 0;

    // Compute scientific stress index based on autonomic cardiac rhythm & HRV
    let stressScore = Math.round(((bpm - 60) * 0.7) + ((65 - Math.min(65, hrv)) * 0.8));
    stressScore = Math.max(5, Math.min(95, stressScore));

    let stressLevel: VitalsReading["stressLevel"] = "Low";
    if (stressScore > 75) stressLevel = "High";
    else if (stressScore > 50) stressLevel = "Elevated";
    else if (stressScore > 30) stressLevel = "Moderate";

    // Fatigue index: low blink rate + elevated stress = acute visual & cognitive strain
    let fatigueIndex = Math.round((stressScore * 0.5) + (Math.max(0, 20 - blinkRate) * 2.5));
    fatigueIndex = Math.max(10, Math.min(99, fatigueIndex));

    let recommendation = "Cardiovascular and cognitive load nominal. Optimal state for deep problem solving, Boss.";
    if (stressLevel === "High") {
      recommendation = "Elevated pulse and autonomic strain detected. I recommend a 4-minute pause and dimming display luminescence.";
    } else if (fatigueIndex > 65) {
      recommendation = "Blink rate has dropped significantly. Micro-eye strain detected. Hydrate and look 20 feet away for 20 seconds.";
    }

    const reading: VitalsReading = {
      bpm,
      hrv,
      stressLevel,
      stressScore,
      blinkRate,
      fatigueIndex,
      timestamp: new Date().toLocaleTimeString(),
      recommendation
    };

    return {
      success: true,
      mcp: "vitals",
      action,
      data: reading
    };
  }

  return { success: false, error: `Unsupported vitals action '${action}'` };
}
