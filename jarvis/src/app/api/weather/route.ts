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

    // WeatherAPI.com endpoint
    const url = `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(city)}&aqi=no`;

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

    // Format the response
    const weather = {
      city: data.location?.name,
      country: data.location?.country,
      temperature: Math.round(data.current?.temp_c),
      feelsLike: Math.round(data.current?.feelslike_c),
      humidity: data.current?.humidity,
      description: data.current?.condition?.text,
      icon: data.current?.condition?.icon,
      windSpeed: data.current?.wind_kph,
      visibility: data.current?.vis_km,
      localTime: data.location?.localtime,
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
