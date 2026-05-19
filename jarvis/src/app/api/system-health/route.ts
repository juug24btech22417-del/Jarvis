import { NextResponse } from "next/server";
import si from "systeminformation";
import axios from "axios";

export async function GET() {
  try {
    const SERPER_API_KEY = process.env.SERPER_API_KEY;
    
    const [cpu, temp, mem, weatherRes, newsRes] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature(),
      si.mem(),
      // Fetch Bangalore Weather
      axios.post("https://google.serper.dev/search", 
        { q: "weather in Bangalore" }, 
        { headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" } }
      ).catch(() => ({ data: { answerBox: { answer: "clear" } } })),
      // Fetch Tech News
      axios.post("https://google.serper.dev/news", 
        { q: "latest technology news", gl: "in" }, 
        { headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" } }
      ).catch(() => ({ data: { news: [] } }))
    ]);

    const cpuTemp = temp.main || Math.floor(Math.random() * (52 - 38 + 1) + 38); 
    const memoryUsed = Math.round(mem.active / (1024 * 1024 * 1024) * 10) / 10;
    
    // Extract weather
    const weather = weatherRes.data?.answerBox?.answer || weatherRes.data?.answerBox?.snippet || "mildly pleasant";
    
    // Extract top news headline
    const topNews = newsRes.data?.news?.[0]?.title || "The tech world is evolving rapidly";

    return NextResponse.json({
      cpuTemp,
      memoryUsed,
      cpuLoad: Math.round(cpu.currentLoad),
      weather,
      topNews,
      status: "stable",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Startup Context API Error:", error);
    return NextResponse.json({ 
      cpuTemp: 45, 
      memoryUsed: 8.2, 
      weather: "clear",
      topNews: "Systems online",
      status: "error" 
    });
  }
}
