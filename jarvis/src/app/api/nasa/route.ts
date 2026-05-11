import { NextRequest, NextResponse } from "next/server";

const NASA_API_BASE = "https://api.nasa.gov";
const EPIC_API_BASE = "https://epic.gsfc.nasa.gov/api";

async function fetchNASA(endpoint: string, params: Record<string, string> = {}, baseUrl: string = NASA_API_BASE) {
  const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
  const queryParams = new URLSearchParams({ ...params, api_key: apiKey });
  const url = `${baseUrl}${endpoint}?${queryParams}`;

  console.log(`[NASA API] Fetching: ${url}`);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[NASA API] Error ${response.status}:`, errorText.substring(0, 200));
    throw new Error(`NASA API error: ${response.status}`);
  }
  return response.json();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "apod";

    console.log(`[NASA API] Request type: ${type}`);

    switch (type) {
      case "apod": {
        const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
        const data = await fetchNASA("/planetary/apod", { date });
        return NextResponse.json({
          success: true,
          type: "apod",
          data: {
            title: data.title,
            date: data.date,
            explanation: data.explanation,
            url: data.url,
            hdUrl: data.hdurl,
            mediaType: data.media_type,
            copyright: data.copyright,
          },
        });
      }

      case "mars": {
        // Try alternative Mars API first (Nebulum One)
        const rover = searchParams.get("rover") || "curiosity";
        let photos: any[] = [];

        try {
          // Try Nebulum One API (community alternative)
          console.log(`[NASA API] Trying Nebulum Mars API`);
          const nebulumUrl = `https://rovers.nebulum.one/api/v1/rovers/${rover}/photos?sol=1000`;

          const response = await fetch(nebulumUrl, {
            cache: "no-store",
            headers: { "Accept": "application/json" }
          });

          if (response.ok) {
            const data = await response.json();
            if (data.photos && data.photos.length > 0) {
              photos = data.photos;
              console.log(`[NASA API] Found ${photos.length} photos from Nebulum API`);
            }
          }
        } catch (e: any) {
          console.log(`[NASA API] Nebulum API error:`, e.message);
        }

        // Return sample/demo data if no photos found (so UI isn't empty)
        // Using reliable Unsplash Mars-themed images
        if (photos.length === 0) {
          console.log("[NASA API] No photos found, returning demo data");
          return NextResponse.json({
            success: true,
            type: "mars",
            data: [
              {
                id: 102693,
                sol: 4298,
                camera: "Mast Camera (Mastcam)",
                imgSrc: "https://images.unsplash.com/photo-1614728853913-1e2a0a295c64?w=800&q=80",
                earthDate: "2024-09-08",
              },
              {
                id: 102694,
                sol: 4298,
                camera: "Navigation Camera (Navcam)",
                imgSrc: "https://images.unsplash.com/photo-1541873676-a18131494184?w=800&q=80",
                earthDate: "2024-09-08",
              },
              {
                id: 102695,
                sol: 4297,
                camera: "Front Hazard Camera (FHAZ)",
                imgSrc: "https://images.unsplash.com/photo-1579159278990-5c8a7de35f99?w=800&q=80",
                earthDate: "2024-09-07",
              },
              {
                id: 102696,
                sol: 4297,
                camera: "Mars Hand Lens Imager (MAHLI)",
                imgSrc: "https://images.unsplash.com/photo-1632395627760-b9833138b995?w=800&q=80",
                earthDate: "2024-09-07",
              },
            ],
            demo: true,
          });
        }

        return NextResponse.json({
          success: true,
          type: "mars",
          data: photos.slice(0, 10).map((photo: any) => ({
            id: photo.id,
            sol: photo.sol,
            camera: photo.camera?.full_name || photo.camera || "Unknown Camera",
            imgSrc: photo.img_src || photo.imgSrc,
            earthDate: photo.earth_date || photo.earthDate,
          })),
        });
      }

      case "neo": {
        // Near Earth Objects
        const today = new Date().toISOString().split("T")[0];
        const startDate = searchParams.get("start") || today;
        const endDate = searchParams.get("end") || startDate;

        const data = await fetchNASA("/neo/rest/v1/feed", { start_date: startDate, end_date: endDate });
        const neos = data.near_earth_objects ? Object.values(data.near_earth_objects).flat() as any[] : [];

        return NextResponse.json({
          success: true,
          type: "neo",
          data: neos.slice(0, 10).map((neo: any) => ({
            name: neo.name,
            diameter: neo.estimated_diameter?.kilometers || { estimated_diameter_min: 0, estimated_diameter_max: 0 },
            hazardous: neo.is_potentially_hazardous_asteroid || false,
            approachDate: neo.close_approach_data?.[0]?.close_approach_date_full || "",
            missDistance: neo.close_approach_data?.[0]?.miss_distance?.kilometers || "0",
            velocity: neo.close_approach_data?.[0]?.relative_velocity?.kilometers_per_hour || "0",
          })),
        });
      }

      case "epic": {
        // Earth Polychromatic Imaging Camera - uses different base URL
        console.log(`[NASA API] Fetching EPIC images`);

        try {
          // EPIC doesn't need API key in query, it's in the path
          const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
          const url = `${EPIC_API_BASE}/natural?api_key=${apiKey}`;

          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`EPIC API error: ${response.status}`);
          }
          const data = await response.json();

          console.log(`[NASA API] EPIC response: ${data?.length || 0} images`);

          if (!Array.isArray(data) || data.length === 0) {
            return NextResponse.json({
              success: true,
              type: "epic",
              data: [],
            });
          }

          // Build image URLs
          const images = data.slice(0, 5).map((image: any) => {
            const date = image.date?.split(" ")[0]; // Get YYYY-MM-DD
            const datePath = date?.replace(/-/g, "/"); // Convert to YYYY/MM/DD
            return {
              caption: image.caption || "Earth from Space",
              date: image.date,
              image: `https://epic.gsfc.nasa.gov/archive/natural/${datePath}/png/${image.image}.png`,
              coords: image.centroid_coordinates,
            };
          });

          return NextResponse.json({
            success: true,
            type: "epic",
            data: images,
          });
        } catch (epicError) {
          console.error("[NASA API] EPIC error:", epicError);
          // Return fallback data
          return NextResponse.json({
            success: true,
            type: "epic",
            data: [],
            error: "EPIC data temporarily unavailable",
          });
        }
      }

      default:
        return NextResponse.json({ error: "Unknown NASA endpoint" }, { status: 400 });
    }
  } catch (error) {
    console.error("[NASA API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch NASA data", details: String(error) },
      { status: 500 }
    );
  }
}
