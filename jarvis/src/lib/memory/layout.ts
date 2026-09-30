// Second Brain — pure 3D constellation layout.
//
// The memory graph is rendered as a starfield: each entity type becomes a
// cluster on a golden-angle sphere, entities spread inside their cluster on a
// smaller golden-angle sphere, linked entities are then pulled together by a
// few spring iterations so related memories visibly orbit each other.
//
// Deterministic (seeded by id) and pure, so the same graph always lays out the
// same way — no jitter between renders — and it can be unit-tested.

export interface GraphNodeInput {
  id: string;
  name: string;
  type: string;
  strength: number;
  pinned: boolean;
  archived?: boolean;
  description?: string | null;
  accessCount?: number;
  createdAt?: number;
}

export interface GraphLinkInput {
  source: string;
  target: string;
  type: string;
  strength: number;
}

export interface ConstellationNode extends GraphNodeInput {
  x: number;
  y: number;
  z: number;
  /** Render radius (world units). */
  radius: number;
  color: string;
  cluster: string;
  archived: boolean;
}

export interface ConstellationLink {
  a: number;
  b: number;
  strength: number;
  type: string;
}

export interface ConstellationCluster {
  type: string;
  color: string;
  count: number;
  center: [number, number, number];
  radius: number;
}

export interface Constellation {
  nodes: ConstellationNode[];
  links: ConstellationLink[];
  clusters: ConstellationCluster[];
  /** Largest extent from origin — used to frame the camera. */
  extent: number;
}

/** One hue per entity type. Tuned to sit well on the dark HUD. */
export const TYPE_COLORS: Record<string, string> = {
  PERSON: "#7dd3fc",
  COMPANY: "#fbbf24",
  PROJECT: "#a78bfa",
  CONCEPT: "#34d399",
  LOCATION: "#fb7185",
  SKILL: "#22d3ee",
  PREFERENCE: "#f0abfc",
  EVENT: "#fdba74",
  GOAL: "#60a5fa",
  TASK: "#fcd34d",
  IDEA: "#c084fc",
  HABIT: "#4ade80",
  ROUTINE: "#38bdf8",
  ORGANIZATION: "#f59e0b",
  PRODUCT: "#a3e635",
  MEDIA: "#f472b6",
  DATE: "#fda4af",
};

const FALLBACK_COLORS = ["#94a3b8", "#67e8f9", "#c4b5fd", "#fca5a5", "#86efac", "#fcd34d"];

export function colorForType(type: string, index = 0): string {
  return TYPE_COLORS[type] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/** Deterministic 0..1 hash — keeps layouts stable between renders. */
function hash01(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Evenly distributed direction on a unit sphere (golden-angle spiral). */
function spherePoint(index: number, total: number, radius: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = total <= 1 ? 0 : 1 - (index / (total - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * index;
  return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius];
}

export interface LayoutOptions {
  /** Spring iterations pulling linked nodes together. */
  iterations?: number;
  /** Distance between cluster centers. */
  clusterSpread?: number;
}

/**
 * Lay the graph out into a constellation. O(N + E×iterations), so it stays
 * instant for graphs of a few thousand entities.
 */
export function buildConstellation(
  nodes: GraphNodeInput[],
  links: GraphLinkInput[],
  opts: LayoutOptions = {}
): Constellation {
  const iterations = Math.max(0, Math.min(opts.iterations ?? 14, 40));
  const spread = opts.clusterSpread ?? 22;

  const visible = nodes.filter((n) => n && n.id);
  const byType = new Map<string, GraphNodeInput[]>();
  for (const n of visible) {
    const t = (n.type || "CONCEPT").toUpperCase();
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(n);
  }

  const types = Array.from(byType.keys()).sort((a, b) => byType.get(b)!.length - byType.get(a)!.length);
  const clusterCenter = new Map<string, [number, number, number]>();
  const clusterRadius = new Map<string, number>();
  const clusters: ConstellationCluster[] = [];

  types.forEach((type, i) => {
    const list = byType.get(type)!;
    const center = types.length <= 1 ? ([0, 0, 0] as [number, number, number]) : spherePoint(i, types.length, spread);
    clusterCenter.set(type, center);
    const cr = 3.2 + Math.sqrt(list.length) * 1.25;
    clusterRadius.set(type, cr);
    clusters.push({
      type,
      color: colorForType(type, i),
      count: list.length,
      center,
      radius: cr,
    });
  });

  // Place every node inside its cluster, then push pinned memories inward so
  // the things you told JARVIS to remember sit near the core.
  const out: ConstellationNode[] = [];
  const indexOf = new Map<string, number>();
  for (const type of types) {
    const list = byType.get(type)!;
    const [cx, cy, cz] = clusterCenter.get(type)!;
    const cr = clusterRadius.get(type)!;
    list.forEach((n, i) => {
      const jitter = 0.72 + hash01(n.id, 7) * 0.55;
      let [x, y, z] = spherePoint(i + hash01(n.id, 3) * 0.4, list.length, cr * jitter);
      // Pinned entities migrate toward the graph core.
      if (n.pinned) {
        x = x * 0.42 + cx * 0.3;
        y = y * 0.42 + cy * 0.3;
        z = z * 0.42 + cz * 0.3;
      }
      indexOf.set(n.id, out.length);
      out.push({
        ...n,
        x: x + cx,
        y: y + cy,
        z: z + cz,
        radius: 0.32 + Math.min(1, Math.max(0, n.strength ?? 0.5)) * 0.85 + (n.pinned ? 0.28 : 0),
        color: colorForType(type, types.indexOf(type)),
        cluster: type,
        archived: n.archived === true,
      });
    });
  }

  // Spring relaxation along the edges: related memories visibly cluster.
  const springs: ConstellationLink[] = [];
  for (const l of links) {
    const a = indexOf.get(l.source);
    const b = indexOf.get(l.target);
    if (a === undefined || b === undefined) continue;
    springs.push({ a, b, strength: Math.min(1, Math.max(0.1, l.strength ?? 0.5)), type: l.type });
  }

  const restLength = 6;
  for (let it = 0; it < iterations; it++) {
    const pull = 0.055 * (1 - it / (iterations + 4));
    for (const s of springs) {
      const A = out[s.a];
      const B = out[s.b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const dz = B.z - A.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      const delta = ((dist - restLength) / dist) * pull * s.strength;
      if (A.pinned && B.pinned) continue;
      const aShare = B.pinned ? 1 : A.pinned ? 0 : 0.5;
      const bShare = 1 - aShare;
      A.x += dx * delta * aShare;
      A.y += dy * delta * aShare;
      A.z += dz * delta * aShare;
      B.x -= dx * delta * bShare;
      B.y -= dy * delta * bShare;
      B.z -= dz * delta * bShare;
    }
  }

  let extent = 1;
  for (const n of out) extent = Math.max(extent, Math.abs(n.x), Math.abs(n.y), Math.abs(n.z));

  return { nodes: out, links: springs, clusters, extent };
}

/** Entity types in a graph, with counts and colors (for the legend). */
export function typeLegend(constellation: Constellation): ConstellationCluster[] {
  return [...constellation.clusters].sort((a, b) => b.count - a.count);
}
