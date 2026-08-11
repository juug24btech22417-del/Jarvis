// Telegram user-location helper. Latest write wins — one row per chat,
// updated whenever the user shares their location from the Telegram
// attachment menu.

import { prisma } from "@/lib/db/queries";

type UserLocationModel = {
  upsert: (args: {
    where: { chatId: bigint };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  }) => Promise<any>;
  findUnique: (args: { where: { chatId: bigint } }) => Promise<any>;
  findMany: (args: Record<string, unknown>) => Promise<any>;
};

const ul = (): UserLocationModel =>
  (prisma as unknown as { userLocation: UserLocationModel }).userLocation;

export interface LocationInput {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  livePeriodSeconds?: number | null;
  heading?: number | null;
}

export async function upsertUserLocation(
  chatId: number,
  input: LocationInput
): Promise<void> {
  await ul().upsert({
    where: { chatId: BigInt(chatId) },
    update: {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyM: input.accuracyM ?? null,
      livePeriodSeconds: input.livePeriodSeconds ?? null,
      heading: input.heading ?? null,
    },
    create: {
      chatId: BigInt(chatId),
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyM: input.accuracyM ?? null,
      livePeriodSeconds: input.livePeriodSeconds ?? null,
      heading: input.heading ?? null,
    },
  });
}

export interface StoredLocation {
  chatId: number;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  livePeriodSeconds: number | null;
  heading: number | null;
  updatedAt: Date;
  createdAt: Date;
}

export async function getUserLocation(
  chatId: number
): Promise<StoredLocation | null> {
  const row = await ul().findUnique({ where: { chatId: BigInt(chatId) } });
  if (!row) return null;
  return {
    chatId,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyM: row.accuracyM ?? null,
    livePeriodSeconds: row.livePeriodSeconds ?? null,
    heading: row.heading ?? null,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Find users within `radiusKm` of (lat, lng). Returns matching chat_ids
 * plus their distance. Used by future geofencing features (home
 * arrival/departure alerts); exposed here for callers that want to
 * build on it.
 */
export async function findNearbyUsers(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<Array<{ chatId: number; distanceKm: number }>> {
  // Naive bounding-box filter first to keep the working set small.
  // ~111 km per degree of latitude; rough but bounded.
  const deg = radiusKm / 111;
  const rows = await ul().findMany({
    where: {
      latitude: { gte: lat - deg, lte: lat + deg },
      longitude: { gte: lng - deg, lte: lng + deg },
    },
  });

  const out: Array<{ chatId: number; distanceKm: number }> = [];
  for (const row of rows) {
    const d = haversineKm(lat, lng, row.latitude, row.longitude);
    if (d <= radiusKm) {
      out.push({
        chatId: typeof row.chatId === "bigint" ? Number(row.chatId) : row.chatId,
        distanceKm: d,
      });
    }
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
