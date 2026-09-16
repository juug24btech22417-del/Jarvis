import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city") || "London";

    const apiKey = process.env.WEATHER_API_KEY;

    if (!apiKey || apiKey.trim() === "" || apiKey === "your-api-key-here") {
      return NextResponse.json(
        { error: "WeatherAPI.com key not configured" },
        { status: 503 }
      );
    }

    // forecast.json gives current + today's astro (sunrise/sunset/moon) in one call
    const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(city)}&days=1&aqi=no&alerts=no`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("WeatherAPI.com error:", response.status, errorData);
      return NextResponse.json(
        { error: "Failed to fetch weather data" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const current = data.current ?? {};
    const location = data.location ?? {};
    const astro = data.forecast?.forecastday?.[0]?.astro ?? {};

    const weather = {
      // Location
      city: location.name,
      region: location.region,
      country: location.country,

      // Current conditions (existing shape preserved for old callers)
      temperature: Math.round(current.temp_c ?? 0),
      feelsLike: Math.round(current.feelslike_c ?? 0),
      humidity: current.humidity ?? 0,
      description: current.condition?.text ?? "—",
      icon: current.condition?.icon,
      windSpeed: current.wind_kph ?? 0,
      windDir: current.wind_dir ?? "—",
      visibility: current.vis_km ?? 0,
      localTime: location.localtime,

      // Extended telemetry
      precipMm: current.precip_mm ?? 0,
      pressureMb: current.pressure_mb ?? 0,
      uvIndex: current.uv ?? 0,
      cloudCover: current.cloud ?? 0,
      sunrise: astro.sunrise ?? "—",
      sunset: astro.sunset ?? "—",
      moonPhase: astro.moon_phase ?? "—",
      moonIllumination: astro.moon_illumination ?? 0,
    };

    return NextResponse.json(weather);
  } catch (error) {
    console.error("Error fetching weather:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
