import { NextRequest, NextResponse } from "next/server";

export interface VideoScene {
  id: string;
  index: number;
  title: string;
  narration: string;
  visualPrompt: string;
  keywords: string[];
  durationSeconds: number;
  motion: "zoom-in" | "zoom-out" | "pan-right" | "pan-left" | "pulse";
  backgroundUrl: string;
  ambientTone: string;
  videoSource?: string;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

// Reliable fallback high-res MP4 clips
const FALLBACK_CLIPS: Record<string, string[]> = {
  tech: [
    "https://videos.pexels.com/video-files/32386633/13814865_960_540_100fps.mp4",
    "https://videos.pexels.com/video-files/32386590/13814633_640_360_100fps.mp4",
    "https://videos.pexels.com/video-files/28615171/12433551_1280_720_25fps.mp4",
    "https://videos.pexels.com/video-files/32386633/13814865_960_540_100fps.mp4",
  ],
  space: [
    "https://videos.pexels.com/video-files/12336940/12336940-hd_1920_1028_60fps.mp4",
    "https://videos.pexels.com/video-files/12336940/12336940-hd_1920_1028_60fps.mp4",
    "https://videos.pexels.com/video-files/28615171/12433551_1280_720_25fps.mp4",
    "https://videos.pexels.com/video-files/12336940/12336940-hd_1920_1028_60fps.mp4",
  ],
  cyberpunk: [
    "https://videos.pexels.com/video-files/28615171/12433551_1280_720_25fps.mp4",
    "https://videos.pexels.com/video-files/32386633/13814865_960_540_100fps.mp4",
    "https://videos.pexels.com/video-files/8087025/8087025-uhd_2160_3840_25fps.mp4",
    "https://videos.pexels.com/video-files/32386590/13814633_640_360_100fps.mp4",
  ],
  ironman: [
    "https://videos.pexels.com/video-files/8087025/8087025-uhd_2160_3840_25fps.mp4",
    "https://videos.pexels.com/video-files/32386633/13814865_960_540_100fps.mp4",
    "https://videos.pexels.com/video-files/28615171/12433551_1280_720_25fps.mp4",
    "https://videos.pexels.com/video-files/32386590/13814633_640_360_100fps.mp4",
  ],
};

// Fetch real HD video from Pexels API
async function fetchPexelsVideo(query: string, apiKey?: string): Promise<string | null> {
  const activeKey = apiKey || PEXELS_API_KEY;
  if (!activeKey) return null;

  const trySearch = async (searchQuery: string): Promise<string | null> => {
    try {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(searchQuery)}&per_page=6&orientation=landscape`;
      const res = await fetch(url, {
        headers: { Authorization: activeKey },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const videos = data?.videos;
      if (!videos?.length) return null;

      // Pick a random video from the top 3
      const video = videos[Math.floor(Math.random() * Math.min(videos.length, 3))];
      const files: Array<{ link: string; file_type?: string; width?: number }> = video.video_files || [];
      if (!files.length) return null;

      // Find an MP4 file, preferably 720p or 1080p for smooth streaming
      const mp4s = files.filter((f) => f.link && (f.link.includes(".mp4") || f.file_type === "video/mp4"));
      const best =
        mp4s.find((f) => f.width === 1280 || f.width === 1920) ||
        mp4s.find((f) => (f.width || 0) >= 960) ||
        mp4s[0] ||
        files[0];

      return best?.link || null;
    } catch (e) {
      console.warn("[VideoDirector] Pexels search error:", e);
      return null;
    }
  };

  // Try specific prompt first
  let link = await trySearch(query);
  if (!link) {
    // Try generic keywords if specific prompt gave no matches
    const broad = query.split(/\s+/).slice(0, 2).join(" ");
    link = await trySearch(broad || "technology");
  }
  return link;
}

export async function GET() {
  return NextResponse.json({
    success: true,
    pexelsConfigured: !!PEXELS_API_KEY,
    geminiConfigured: !!GEMINI_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, topic, style = "tech", sceneCount = 4, pexelsApiKey } = body;
    const queryTopic = prompt || topic || "The Future of Stark Technology";
    const activePexelsKey = pexelsApiKey || req.headers.get("x-pexels-key") || PEXELS_API_KEY;

    let scenes: VideoScene[] = [];

    // ── Step 1: Generate scene scripts with Gemini ──
    if (GEMINI_API_KEY) {
      try {
        const candidateModels = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-flash-latest"];
        const systemPrompt = `You are an elite Hollywood AI Video Director for Stark Industries.
Generate a dynamic, cinematic storyboard for a short high-impact video about: "${queryTopic}".
Output strictly valid JSON with an array named "scenes" containing exactly ${sceneCount} scenes.
Each scene MUST have:
- title: punchy 2-4 word scene headline
- narration: exactly 1-2 compelling spoken sentences (15-25 words) for a voiceover
- visualPrompt: 3-5 word visual description to search for stock video (e.g. "quantum computing microchip", "flying cars cyberpunk city")
- keywords: array of 2-3 single-word tags
- durationSeconds: number between 5 and 7
- motion: one of ["zoom-in", "zoom-out", "pan-right", "pan-left", "pulse"]
- ambientTone: one of ["#00f0ff", "#ff0055", "#00ff88", "#ffaa00", "#7928ca"]

Return ONLY raw JSON, no markdown fences:
{"scenes": [...]}`;

        for (const model of candidateModels) {
          try {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
            const res = await fetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.75 },
              }),
              signal: AbortSignal.timeout(12000),
            });

            if (res.ok) {
              const data = await res.json();
              const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (jsonText) {
                const parsed = JSON.parse(jsonText);
                if (Array.isArray(parsed.scenes)) {
                  scenes = parsed.scenes.slice(0, sceneCount).map((s: any, idx: number) => ({
                    id: `scene-${idx + 1}-${Date.now()}`,
                    index: idx + 1,
                    title: s.title || `Scene ${idx + 1}`,
                    narration: s.narration || "Systems engaged and operational.",
                    visualPrompt: s.visualPrompt || queryTopic,
                    keywords: s.keywords || [style],
                    durationSeconds: Number(s.durationSeconds) || 6,
                    motion: s.motion || "zoom-in",
                    backgroundUrl: "",
                    ambientTone: s.ambientTone || "#00f0ff",
                  }));
                  break;
                }
              }
            }
          } catch {
            // try next model
          }
        }
      } catch (e) {
        console.warn("[VideoDirector] Gemini error:", e);
      }
    }

    // ── Step 2: Fallback scripts if Gemini was not available ──
    if (scenes.length === 0) {
      const fallbackScripts = [
        { title: "The Spark", narration: `${queryTopic} begins with a single bold concept that challenges the boundaries of modern science.`, visualPrompt: `${style} technology innovation`, motion: "zoom-in", ambientTone: "#00f0ff" },
        { title: "The Build", narration: "Quantum algorithms, neural architectures, and precision engineering converge into the next leap forward.", visualPrompt: `${style} laboratory engineering`, motion: "pan-right", ambientTone: "#00ff88" },
        { title: "The Shift", narration: "What was once deemed impossible now powers the autonomous infrastructure of tomorrow.", visualPrompt: `futuristic ${style} digital network`, motion: "zoom-out", ambientTone: "#ffaa00" },
        { title: "The Horizon", narration: "The future doesn't wait. With J.A.R.V.I.S. online, the future is now.", visualPrompt: `${style} horizon space`, motion: "pulse", ambientTone: "#7928ca" },
      ];
      scenes = fallbackScripts.slice(0, sceneCount).map((s, idx) => ({
        id: `scene-${idx + 1}`,
        index: idx + 1,
        keywords: [style, "tech"],
        durationSeconds: 6,
        backgroundUrl: "",
        ...s,
        motion: s.motion as VideoScene["motion"],
      }));
    }

    // ── Step 3: Fetch real Pexels videos or use curated fallback clips ──
    const pool = FALLBACK_CLIPS[style] || FALLBACK_CLIPS.tech;
    scenes = await Promise.all(
      scenes.map(async (scene, idx) => {
        let videoUrl: string | null = null;

        if (activePexelsKey) {
          videoUrl = await fetchPexelsVideo(scene.visualPrompt, activePexelsKey);
        }

        return {
          ...scene,
          backgroundUrl: videoUrl || pool[idx % pool.length],
          videoSource: videoUrl ? "pexels" : "verified-cdn",
        } as VideoScene & { videoSource: string };
      })
    );

    const totalDuration = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);

    return NextResponse.json({
      success: true,
      topic: queryTopic,
      totalDuration,
      sceneCount: scenes.length,
      pexelsEnabled: !!activePexelsKey,
      geminiEnabled: !!GEMINI_API_KEY,
      scenes,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to direct video", details: String(error) },
      { status: 500 }
    );
  }
}
