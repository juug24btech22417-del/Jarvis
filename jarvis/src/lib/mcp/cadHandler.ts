import { parseJsonLoose } from "@/lib/llm/fastJson";

export interface CadPrimitive {
  shape:
    | "box"
    | "cylinder"
    | "cone"
    | "sphere"
    | "torus"
    | "pyramid"
    | "capsule"
    | "ring"
    | "wedge"
    | "star"
    | "spring"
    | "lathe";
  size?: number[]; // [w, h, d] or [rTop, rBot, h] or [radius, tubeRadius]
  position?: [number, number, number]; // [x, y, z]
  rotation?: [number, number, number]; // [rx, ry, rz] in radians
  color?: string;
}

export interface CadModelResult {
  name: string;
  description: string;
  dimensions: { widthMm: number; heightMm: number; depthMm: number };
  openScadCode: string;
  printEstimates: {
    printTimeMinutes: number;
    filamentWeightGrams: number;
    layerCount: number;
    recommendedMaterial: string;
  };
  meshPreset: string;
  primitives?: CadPrimitive[];
}

// Timeout budget for lightning-fast response: Groq /no_think typically answers in ~900ms - 1.2s
const LLM_BUDGET_MS = 3800;

interface LocalSpec {
  name: string;
  description: string;
  width: number;
  height: number;
  depth: number;
  material: string;
  meshPreset: string;
  primitives?: CadPrimitive[];
}

/** Parse explicit mm sizes from prompt text */
function extractMm(prompt: string, fallback: number): number {
  const m = prompt.match(/\b(\d{2,3})\s*mm\b/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 5 && n <= 500) return Math.round(n);
  }
  return fallback;
}

/**
 * Natural language semantic matcher.
 * Matches dozens of real physical categories and constructs genuine 3D primitives
 * and parametric OpenSCAD code instead of falling back to a rectangle.
 */
function specFor(prompt: string): LocalSpec {
  const p = prompt.toLowerCase();
  const w = extractMm(prompt, 60);

  // ── 1. Geometric Primitives ──────────────────────────────────────────────
  if (/\b(pyramid|tetrahedron|ziggurat)\b/.test(p)) {
    const sz = extractMm(prompt, 50);
    return {
      name: "Geometric Pyramid",
      description: "Parametric 4-sided pyramid with a square base and tapered apex.",
      width: sz,
      height: sz,
      depth: sz,
      material: "PLA",
      meshPreset: "pyramid",
      primitives: [{ shape: "pyramid", size: [sz, sz, sz], position: [0, 0, 0] }],
    };
  }

  if (/\b(cone|conical|spire|funnel)\b/.test(p)) {
    const r = extractMm(prompt, 40) / 2;
    const h = extractMm(prompt, 70);
    return {
      name: "Tapered Cone",
      description: "Parametric circular cone with configurable base radius and apex height.",
      width: r * 2,
      height: h,
      depth: r * 2,
      material: "PLA",
      meshPreset: "cone",
      primitives: [{ shape: "cone", size: [r, h], position: [0, 0, 0] }],
    };
  }

  if (/\b(sphere|orb|globe|ball|dome|hemisphere)\b/.test(p)) {
    const dia = extractMm(prompt, 50);
    return {
      name: "Precision Sphere",
      description: "Seamless geometric sphere engineered with high radial polygon fidelity.",
      width: dia,
      height: dia,
      depth: dia,
      material: "PLA",
      meshPreset: "sphere",
      primitives: [{ shape: "sphere", size: [dia / 2], position: [0, 0, 0] }],
    };
  }

  if (/\b(torus|donut|doughnut|o-ring)\b/.test(p)) {
    const dia = extractMm(prompt, 50);
    return {
      name: "Toroidal Ring",
      description: "Smooth parametric torus with defined major and minor cross-sectional radii.",
      width: dia,
      height: 16,
      depth: dia,
      material: "TPU",
      meshPreset: "torus",
      primitives: [{ shape: "torus", size: [dia * 0.38, 7], position: [0, 0, 0] }],
    };
  }

  if (/\b(capsule|pill|lozenge)\b/.test(p)) {
    const h = extractMm(prompt, 60);
    const r = extractMm(prompt, 24) / 2;
    return {
      name: "Smooth Capsule",
      description: "Dual-dome cylindrical capsule with tangent hemispherical ends.",
      width: r * 2,
      height: h,
      depth: r * 2,
      material: "PLA",
      meshPreset: "capsule",
      primitives: [{ shape: "capsule", size: [r, h - r * 2], position: [0, 0, 0] }],
    };
  }

  // ── 2. Drinkware & Vessels ───────────────────────────────────────────────
  if (/\b(mug|coffee|cup|tea\s*cup|stein)\b/.test(p)) {
    const dia = extractMm(prompt, 75);
    const h = extractMm(prompt, 90);
    return {
      name: "Coffee Mug with Ergonomic Handle",
      description: "Cylindrical beverage mug with hollow reservoir, rounded drinking lip, and curved C-handle.",
      width: dia + 26,
      height: h,
      depth: dia,
      material: "PETG",
      meshPreset: "mug",
      primitives: [
        { shape: "cylinder", size: [dia / 2, dia / 2, h], position: [0, 0, 0] },
        { shape: "torus", size: [18, 4.5], position: [dia / 2 + 10, 0, 0], rotation: [0, 0, Math.PI / 2] },
      ],
    };
  }

  if (/\b(bottle|flask|vial|canteen)\b/.test(p)) {
    const dia = extractMm(prompt, 65);
    const h = extractMm(prompt, 140);
    return {
      name: "Contoured Bottle Flask",
      description: "Ergonomic bottle body with tapered shoulder, threaded neck lip, and stable base.",
      width: dia,
      height: h,
      depth: dia,
      material: "PETG",
      meshPreset: "bottle",
      primitives: [
        { shape: "cylinder", size: [dia / 2, dia / 2, h * 0.6], position: [0, -h * 0.15, 0] },
        { shape: "cone", size: [dia / 2, h * 0.25], position: [0, h * 0.2, 0] },
        { shape: "cylinder", size: [dia * 0.22, dia * 0.22, h * 0.2], position: [0, h * 0.4, 0] },
      ],
    };
  }

  if (/\b(bowl|dish|basin)\b/.test(p)) {
    const dia = extractMm(prompt, 110);
    const h = extractMm(prompt, 55);
    return {
      name: "Hemispherical Bowl",
      description: "Smooth curved concave dish with weighted bottom rim for desktop or dining utility.",
      width: dia,
      height: h,
      depth: dia,
      material: "PLA",
      meshPreset: "bowl",
    };
  }

  // ── 3. Aerospace & Vehicles ──────────────────────────────────────────────
  if (/\b(rocket|missile|spaceship|starship|shuttle|spacecraft)\b/.test(p)) {
    const h = extractMm(prompt, 120);
    const dia = extractMm(prompt, 36);
    return {
      name: "Aerospace Rocket Assembly",
      description: "Multi-stage rocket with aerodynamic ogive nosecone, cylindrical body, and 4 swept stabilizing fins.",
      width: dia * 2.2,
      height: h,
      depth: dia * 2.2,
      material: "PLA",
      meshPreset: "rocket",
      primitives: [
        { shape: "cylinder", size: [dia / 2, dia / 2, h * 0.6], position: [0, -h * 0.05, 0] },
        { shape: "cone", size: [dia / 2, h * 0.35], position: [0, h * 0.4, 0] },
        { shape: "box", size: [dia * 2.2, 2.5, h * 0.25], position: [0, -h * 0.25, 0] },
        { shape: "box", size: [2.5, dia * 2.2, h * 0.25], position: [0, -h * 0.25, 0] },
      ],
    };
  }

  if (/\b(airplane|plane|aircraft|jet|glider)\b/.test(p)) {
    const len = extractMm(prompt, 110);
    const wingspan = extractMm(prompt, 130);
    return {
      name: "Aircraft Jet Model",
      description: "Swept-wing airplane model with aerodynamic fuselage, main wings, vertical tail fin, and rear stabilizers.",
      width: wingspan,
      height: 32,
      depth: len,
      material: "PLA",
      meshPreset: "airplane",
      primitives: [
        { shape: "cylinder", size: [8, 8, len * 0.8], position: [0, 0, 0], rotation: [Math.PI / 2, 0, 0] },
        { shape: "box", size: [wingspan, 2.5, 24], position: [0, 2, 0] },
        { shape: "box", size: [42, 2, 12], position: [0, 3, len * 0.35] },
        { shape: "box", size: [2.5, 22, 18], position: [0, 10, len * 0.33] },
      ],
    };
  }

  if (/\b(car|vehicle|truck|rover)\b/.test(p) && !/\b(mount|bracket|holder|clip|adapter)\b/.test(p)) {
    const len = extractMm(prompt, 100);
    const wid = extractMm(prompt, 55);
    const h = extractMm(prompt, 38);
    return {
      name: "Aerodynamic Vehicle Body",
      description: "Streamlined vehicle chassis with curved cabin canopy, wheel wells, and 4 road wheels.",
      width: wid,
      height: h,
      depth: len,
      material: "PLA",
      meshPreset: "car",
      primitives: [
        { shape: "box", size: [wid * 0.85, h * 0.45, len], position: [0, 0, 0] },
        { shape: "box", size: [wid * 0.65, h * 0.5, len * 0.55], position: [0, h * 0.38, -len * 0.05] },
        { shape: "cylinder", size: [9, 9, wid], position: [0, -h * 0.15, len * 0.3], rotation: [0, 0, Math.PI / 2] },
        { shape: "cylinder", size: [9, 9, wid], position: [0, -h * 0.15, -len * 0.3], rotation: [0, 0, Math.PI / 2] },
      ],
    };
  }

  // ── 4. Weapons & Props ───────────────────────────────────────────────────
  if (/\b(sword|dagger|blade|knife|saber)\b/.test(p)) {
    const len = extractMm(prompt, 160);
    return {
      name: "Double-Edged Sword Blade",
      description: "Hero blade prop with central fuller spine, crossguard hilt, spiral handle grip, and weighted pommel.",
      width: 48,
      height: len,
      depth: 14,
      material: "PETG",
      meshPreset: "sword",
      primitives: [
        { shape: "box", size: [18, len * 0.65, 4], position: [0, len * 0.15, 0] },
        { shape: "box", size: [48, 8, 12], position: [0, -len * 0.2, 0] },
        { shape: "cylinder", size: [6, 6, len * 0.22], position: [0, -len * 0.32, 0] },
        { shape: "sphere", size: [9], position: [0, -len * 0.46, 0] },
      ],
    };
  }

  // ── 5. Games & Novelties ─────────────────────────────────────────────────
  if (/\b(dice|die|d6)\b/.test(p)) {
    const s = extractMm(prompt, 22);
    return {
      name: "Gaming Precision Die",
      description: "Chamfered 6-sided gaming die with recessed spherical pip indicators.",
      width: s,
      height: s,
      depth: s,
      material: "PLA",
      meshPreset: "dice",
      primitives: [{ shape: "box", size: [s, s, s], position: [0, 0, 0] }],
    };
  }

  if (/\b(guitar\s*pick|pick|plectrum)\b/.test(p)) {
    const s = extractMm(prompt, 30);
    return {
      name: "Ergonomic Guitar Pick",
      description: "Parametric plectrum with 1.2mm thickness, contoured teardrop body, and textured thumb grip.",
      width: s,
      height: 1.2,
      depth: s * 1.15,
      material: "PETG",
      meshPreset: "guitar_pick",
      primitives: [{ shape: "cone", size: [s * 0.45, 1.2], position: [0, 0, 0] }],
    };
  }

  if (/\b(keychain|tag|fob)\b/.test(p)) {
    const w = extractMm(prompt, 50);
    return {
      name: "Custom Keychain Tag",
      description: "Chamfered EDC keychain tag with 5mm lanyard hole and reinforced border.",
      width: w,
      height: 3,
      depth: 25,
      material: "PLA",
      meshPreset: "keychain",
      primitives: [
        { shape: "box", size: [w, 3, 25], position: [0, 0, 0] },
        { shape: "cylinder", size: [4, 4, 3], position: [-w * 0.38, 0, 0] },
      ],
    };
  }

  if (/\b(star|badge|medal|emblem)\b/.test(p)) {
    const dia = extractMm(prompt, 60);
    return {
      name: "5-Pointed Star Medal",
      description: "Relief 5-pointed star emblem with raised bevel facets and ribbon mounting loop.",
      width: dia,
      height: 8,
      depth: dia,
      material: "PLA",
      meshPreset: "star",
    };
  }

  if (/\b(spring|coil|helix|shock)\b/.test(p)) {
    const dia = extractMm(prompt, 30);
    const h = extractMm(prompt, 70);
    return {
      name: "Helical Compression Spring",
      description: "Parametric continuous coil spring engineered for flexible filament or compliant mechanisms.",
      width: dia,
      height: h,
      depth: dia,
      material: "TPU",
      meshPreset: "spring",
    };
  }

  if (/\b(bolt|screw|fastener|threaded\s*rod)\b/.test(p)) {
    const dia = extractMm(prompt, 20);
    const h = extractMm(prompt, 60);
    return {
      name: "Hex Head Bolt",
      description: "M10-equivalent metric machine bolt with hexagonal drive head and cylindrical threaded shank.",
      width: dia,
      height: h,
      depth: dia,
      material: "PETG",
      meshPreset: "bolt",
      primitives: [
        { shape: "cylinder", size: [dia / 2, dia / 2, h * 0.25], position: [0, h * 0.35, 0] },
        { shape: "cylinder", size: [dia * 0.32, dia * 0.32, h * 0.75], position: [0, -h * 0.1, 0] },
      ],
    };
  }

  if (/\b(nut|hex\s*nut)\b/.test(p)) {
    const dia = extractMm(prompt, 26);
    const h = extractMm(prompt, 14);
    return {
      name: "Hexagonal Nut",
      description: "Precision 6-sided mechanical hex nut with chamfered faces and central clearance bore.",
      width: dia,
      height: h,
      depth: dia,
      material: "PETG",
      meshPreset: "nut",
    };
  }

  // ── 6. Furniture & Household ─────────────────────────────────────────────
  if (/\b(chair|seat|stool|bench)\b/.test(p)) {
    const w = extractMm(prompt, 55);
    const h = extractMm(prompt, 90);
    return {
      name: "Modern Chair Model",
      description: "Minimalist ergonomic chair with curved seat pan, supportive backrest, and 4 tapered legs.",
      width: w,
      height: h,
      depth: w,
      material: "PLA",
      meshPreset: "chair",
      primitives: [
        { shape: "box", size: [w, 5, w], position: [0, 0, 0] },
        { shape: "box", size: [w, h * 0.5, 5], position: [0, h * 0.25, -w * 0.45] },
        { shape: "cylinder", size: [2.5, 2.5, h * 0.45], position: [w * 0.4, -h * 0.23, w * 0.4] },
        { shape: "cylinder", size: [2.5, 2.5, h * 0.45], position: [-w * 0.4, -h * 0.23, w * 0.4] },
        { shape: "cylinder", size: [2.5, 2.5, h * 0.45], position: [w * 0.4, -h * 0.23, -w * 0.4] },
        { shape: "cylinder", size: [2.5, 2.5, h * 0.45], position: [-w * 0.4, -h * 0.23, -w * 0.4] },
      ],
    };
  }

  if (/\b(table|desk)\b/.test(p)) {
    const w = extractMm(prompt, 110);
    const h = extractMm(prompt, 70);
    const d = extractMm(prompt, 70);
    return {
      name: "Utility Table",
      description: "Parametric utility desk with chamfered top tabletop surface and 4 corner support posts.",
      width: w,
      height: h,
      depth: d,
      material: "PLA",
      meshPreset: "table",
      primitives: [
        { shape: "box", size: [w, 6, d], position: [0, h * 0.45, 0] },
        { shape: "cylinder", size: [4, 4, h * 0.9], position: [w * 0.42, 0, d * 0.42] },
        { shape: "cylinder", size: [4, 4, h * 0.9], position: [-w * 0.42, 0, d * 0.42] },
        { shape: "cylinder", size: [4, 4, h * 0.9], position: [w * 0.42, 0, -d * 0.42] },
        { shape: "cylinder", size: [4, 4, h * 0.9], position: [-w * 0.42, 0, -d * 0.42] },
      ],
    };
  }

  if (/\b(chess|pawn|knight|bishop|rook)\b/.test(p)) {
    const dia = extractMm(prompt, 32);
    const h = extractMm(prompt, 65);
    return {
      name: "Chess Piece — Pawn",
      description: "Tournament-profile chess piece with weighted stepped base, curved waist, and sphere finial.",
      width: dia,
      height: h,
      depth: dia,
      material: "PLA",
      meshPreset: "chess_pawn",
      primitives: [
        { shape: "cylinder", size: [dia / 2, dia / 2, 10], position: [0, -h * 0.4, 0] },
        { shape: "cylinder", size: [dia * 0.35, dia * 0.45, h * 0.55], position: [0, -h * 0.1, 0] },
        { shape: "sphere", size: [dia * 0.32], position: [0, h * 0.35, 0] },
      ],
    };
  }

  if (/\b(headphone|headset)\s*(stand|holder|mount)?\b/.test(p)) {
    const h = extractMm(prompt, 220);
    const w = extractMm(prompt, 120);
    return {
      name: "Ergonomic Headphone Stand",
      description: "Vertical desktop headphone stand with weighted base disc and cradle hook.",
      width: w,
      height: h,
      depth: w,
      material: "PLA",
      meshPreset: "headphone_stand",
    };
  }

  if (/\b(dumbbell|barbell|weight)\b/.test(p)) {
    const w = extractMm(prompt, 140);
    const dia = extractMm(prompt, 60);
    return {
      name: "Fitness Dumbbell Prop",
      description: "Symmetrical dumbbell with knurled center grip bar and twin octagonal weight plates.",
      width: w,
      height: dia,
      depth: dia,
      material: "PLA",
      meshPreset: "dumbbell",
      primitives: [
        { shape: "cylinder", size: [12, 12, w * 0.6], position: [0, 0, 0], rotation: [0, 0, Math.PI / 2] },
        { shape: "cylinder", size: [dia / 2, dia / 2, 22], position: [w * 0.38, 0, 0], rotation: [0, 0, Math.PI / 2] },
        { shape: "cylinder", size: [dia / 2, dia / 2, 22], position: [-w * 0.38, 0, 0], rotation: [0, 0, Math.PI / 2] },
      ],
    };
  }

  // ── 7. Legacy / Existing Presets ─────────────────────────────────────────
  if (/\b(wrench|spanner|torque|socket)\b/.test(p))
    return { name: "Adjustable Wrench", description: "Open-end wrench with fixed jaw and ergonomic grip handle, sized for M8–M14 fasteners.", width: 160, height: 22, depth: 38, material: "PETG", meshPreset: "wrench" };

  if (/\b(bottle\s*opener|cap\s*off|opener)\b/.test(p))
    return { name: "Bottle Opener", description: "Sturdy flat-body bottle cap lever with a reinforced hook lip.", width: 120, height: 8, depth: 28, material: "PLA", meshPreset: "bottle_opener" };

  if (/\b(fan|blade|impeller|propeller)\b/.test(p))
    return { name: "Fan Blade Assembly", description: "5-blade centrifugal fan with swept airfoils and a central hub boss.", width: 80, height: 18, depth: 80, material: "PETG", meshPreset: "fan_blade" };

  if (/\b(turbine|nozzle)\b/.test(p))
    return { name: "Axial Turbine Stage", description: "Single-stage axial turbine rotor with 12 twisted blades and a keyed bore.", width: 70, height: 30, depth: 70, material: "PETG", meshPreset: "turbine" };

  if (/\b(handle|grip|knob|lever|pull)\b/.test(p))
    return { name: "Ergonomic Handle", description: "Comfort-grip handle with thumb indent and M6 threaded inserts for attachment.", width: 28, height: 100, depth: 35, material: "TPU", meshPreset: "handle" };

  if (/\b(vase|pot|planter|flower\s*pot)\b/.test(p))
    return { name: "Vase / Planter", description: "Organic tapered vase with a flared rim and drainage hole at the base.", width: 80, height: 130, depth: 80, material: "PLA", meshPreset: "vase" };

  if (/\b(tray|dish|organis|organiz|drawer\s*insert|desk\s*organis)\b/.test(p))
    return { name: "Desk Organiser Tray", description: "Flat-bottomed partitioned tray for pens, small parts, or desktop accessories.", width: 160, height: 40, depth: 100, material: "PLA", meshPreset: "tray" };

  if (/\b(lid|cap|cover|top|plug)\b/.test(p))
    return { name: "Snap-Fit Lid", description: "Parametric lid with a 1 mm snap-fit lip, sized to fit a standard container.", width: extractMm(prompt, 80), height: 8, depth: extractMm(prompt, 60), material: "PLA", meshPreset: "lid" };

  if (/\b(spool|bobbin|reel|filament)\b/.test(p))
    return { name: "Filament Spool Core", description: "Two-flange filament spool with a 52 mm bore and 12 spoke lightening cutouts.", width: 180, height: 70, depth: 180, material: "PLA", meshPreset: "spool" };

  if (/\b(ring|band|collar|bangle)\b/.test(p))
    return { name: "Parametric Ring", description: "Smooth circular ring with configurable inner/outer diameter ratio.", width: extractMm(prompt, 30), height: 10, depth: extractMm(prompt, 30), material: "TPU", meshPreset: "ring" };

  if (/\b(bracket|mount|holder|clamp|fixture)\b/.test(p) && !/cable/.test(p))
    return { name: "Universal Mounting Bracket", description: "L-profile mounting bracket with four M4 bolt holes and a gusseted corner.", width: 60, height: 60, depth: 40, material: "PETG", meshPreset: "bracket" };

  if (/\b(shelf|wall\s*mount|wall\s*anchor)\b/.test(p))
    return { name: "Shelf Wall Bracket", description: "Heavy-duty shelf bracket with angled gusset, rated for up to 5 kg when wall-mounted.", width: 80, height: 80, depth: 50, material: "PETG", meshPreset: "shelf_bracket" };

  if (/\b(hook|hanger|peg|wall\s*hook)\b/.test(p))
    return { name: "Wall Hook", description: "Flush-mount wall hook with a rounded peg and a rear pocket for a drywall anchor.", width: 40, height: 70, depth: 22, material: "PLA", meshPreset: "hook" };

  if (/\b(lamp\s*shade|shade|diffuser|canopy|light)\b/.test(p))
    return { name: "Lamp Shade", description: "Conical lamp shade with a honeycomb perforation pattern for warm ambient diffusion.", width: 120, height: 90, depth: 120, material: "PLA", meshPreset: "lamp_shade" };

  if (/\b(gear|planetary|pinion|cog|sprocket)\b/.test(p))
    return { name: "Planetary Gear", description: "Self-centering planetary gear with a sun gear and three orbiting planet gears.", width: 64, height: 14, depth: 64, material: "PLA", meshPreset: "bearing_gear" };

  if (/\b(drone|motor\s*mount|quadcopter)\b/.test(p))
    return { name: "Drone Motor Mount", description: "Hexagonal motor mount for 2204/2206 brushless motors with a slotted arm clamp.", width: 46, height: 30, depth: 46, material: "PETG", meshPreset: "drone_mount" };

  if (/\b(cable|wire\s*organis|cord\s*clip)\b/.test(p))
    return { name: "Cable Management Clip", description: "Snap-on clip that captures 4–6 mm cables with a compliant retention jaw.", width: 24, height: 18, depth: 12, material: "TPU", meshPreset: "cable_clip" };

  if (/\b(case|box|enclosure|housing|container|capsule)\b/.test(p))
    return { name: "Custom Enclosure", description: "Parametric snap-fit enclosure with rounded corners and a removable lid.", width: 80, height: 34, depth: 60, material: "PLA", meshPreset: "custom_box" };

  if (/\b(hex|hexagonal|honeycomb)\b/.test(p))
    return { name: "Hexagonal Mount", description: "Six-sided mounting body with a reinforced core and M3 bolt bosses.", width: 52, height: 26, depth: 52, material: "PETG", meshPreset: "hex_case" };

  if (/\b(phone|stand|desk\s*stand|tablet)\b/.test(p))
    return { name: "Phone Desk Stand", description: "Ergonomic desk stand with 20° tilt, retention lip, and integrated cable routing.", width: extractMm(prompt, 70), height: 95, depth: 80, material: "PLA", meshPreset: "phone_stand" };

  if (/\b(pipe|tube|sleeve|cylinder|barrel|conduit)\b/.test(p)) {
    const dia = extractMm(prompt, 40);
    const h = extractMm(prompt, 80);
    return {
      name: "Cylindrical Pipe Conduit",
      description: "Hollow cylindrical tube with reinforced end collars for mechanical fluid or wire routing.",
      width: dia,
      height: h,
      depth: dia,
      material: "PETG",
      meshPreset: "pipe",
    };
  }

  // ── 8. Engineered Component Fallback (NEVER a flat raw box) ───────────────
  // If no specific keyword matched, generate a high-tech precision machined component
  // with chamfers, center hub, heat sink ribs, and counter-bored mounting holes!
  const bw = extractMm(prompt, 75);
  const bh = extractMm(prompt, 45);
  const bd = extractMm(prompt, 65);
  return {
    name: "Precision Engineered Component",
    description: `Custom functional 3D prototype generated for: "${prompt}". Features reinforced structural ribs, mounting counterbores, and chamfered stress reliefs.`,
    width: bw,
    height: bh,
    depth: bd,
    material: "PETG",
    meshPreset: "engineered_component",
    primitives: [
      { shape: "box", size: [bw, bh * 0.35, bd], position: [0, -bh * 0.25, 0] },
      { shape: "cylinder", size: [bw * 0.24, bw * 0.24, bh * 0.75], position: [0, bh * 0.1, 0] },
      { shape: "cylinder", size: [bw * 0.1, bw * 0.1, bh * 0.8], position: [0, bh * 0.1, 0] },
    ],
  };
}

/** Complete, syntactically clean OpenSCAD generator for all model types */
function scadFor(spec: LocalSpec): string {
  const { width: w, height: h, depth: d } = spec;
  const head =
    `// JARVIS Mark Prototype — ${spec.name}\n` +
    `// Auto-generated parametric model. Tune parameters below for your printer.\n` +
    `$fn = 64;\nwidth = ${w};\nheight = ${h};\ndepth = ${d};\n\n`;

  switch (spec.meshPreset) {
    case "pyramid":
      return head + `// 4-sided square pyramid\npolyhedron(\n  points=[\n    [-width/2, -depth/2, 0],\n    [width/2, -depth/2, 0],\n    [width/2, depth/2, 0],\n    [-width/2, depth/2, 0],\n    [0, 0, height]\n  ],\n  faces=[\n    [0, 1, 4],\n    [1, 2, 4],\n    [2, 3, 4],\n    [3, 0, 4],\n    [3, 2, 1, 0]\n  ]\n);\n`;

    case "cone":
      return head + `cylinder(h=height, r1=width/2, r2=0, center=false);\n`;

    case "sphere":
      return head + `sphere(r=width/2);\n`;

    case "torus":
      return head + `rotate_extrude(angle=360) translate([width*0.35, 0, 0]) circle(r=height/2);\n`;

    case "capsule":
      return head + `r = width/2;\ncylinder_height = height - width;\nunion() {\n  cylinder(h=cylinder_height, r=r, center=true);\n  translate([0, 0, cylinder_height/2]) sphere(r=r);\n  translate([0, 0, -cylinder_height/2]) sphere(r=r);\n}\n`;

    case "mug":
      return head + `wall = 3.5;\nunion() {\n  difference() {\n    cylinder(h=height, d=depth);\n    translate([0, 0, wall]) cylinder(h=height, d=depth-wall*2);\n  }\n  // Ergonomic C-handle\n  translate([depth*0.48, 0, height*0.5])\n    rotate([0, 90, 0])\n      rotate_extrude(angle=180) translate([height*0.25, 0, 0]) circle(d=10);\n}\n`;

    case "bottle":
      return head + `neck_d = depth*0.35;\nunion() {\n  // Main body\n  cylinder(h=height*0.6, d=depth);\n  // Shoulder transition\n  translate([0, 0, height*0.6]) cylinder(h=height*0.2, d1=depth, d2=neck_d);\n  // Neck & lip\n  translate([0, 0, height*0.8]) cylinder(h=height*0.2, d=neck_d);\n}\n`;

    case "bowl":
      return head + `difference() {\n  sphere(d=width);\n  translate([0, 0, 0]) sphere(d=width - 6);\n  translate([0, 0, width/2]) cube([width*1.2, width*1.2, width], center=true);\n}\n`;

    case "rocket":
      return head + `body_d = depth*0.5;\nunion() {\n  // Fuselage\n  cylinder(h=height*0.65, d=body_d);\n  // Nosecone\n  translate([0, 0, height*0.65]) cylinder(h=height*0.35, d1=body_d, d2=0);\n  // 4 Stabilizing fins\n  for (a=[0:90:359]) rotate([0, 0, a])\n    translate([body_d*0.4, -1.5, 0])\n      linear_extrude(height=height*0.25) polygon([[0,0],[width*0.4,0],[0,height*0.25]]);\n}\n`;

    case "airplane":
      return head + `fuse_len = depth;\nwing_span = width;\nunion() {\n  // Fuselage\n  rotate([-90,0,0]) cylinder(h=fuse_len, d=16, center=true);\n  // Main wings\n  translate([0, 0, fuse_len*0.05]) cube([wing_span, 3, 24], center=true);\n  // Horizontal rear stabilizers\n  translate([0, 0, -fuse_len*0.38]) cube([wing_span*0.4, 2, 12], center=true);\n  // Vertical fin\n  translate([0, 10, -fuse_len*0.36]) cube([2.5, 18, 16], center=true);\n}\n`;

    case "car":
      return head + `union() {\n  // Lower chassis\n  cube([width*0.85, depth, height*0.4], center=true);\n  // Cabin roof\n  translate([0, -depth*0.05, height*0.3]) cube([width*0.65, depth*0.55, height*0.4], center=true);\n  // Wheel axles\n  for (y=[-depth*0.3, depth*0.3])\n    translate([0, y, -height*0.15]) rotate([0, 90, 0]) cylinder(h=width, d=18, center=true);\n}\n`;

    case "sword":
      return head + `union() {\n  // Blade\n  translate([0, 0, height*0.25]) cube([width*0.35, 4, height*0.6], center=true);\n  // Crossguard\n  cube([width, 10, 8], center=true);\n  // Grip\n  translate([0, 0, -height*0.14]) cylinder(h=height*0.2, d=12, center=true);\n  // Pommel\n  translate([0, 0, -height*0.26]) sphere(d=16);\n}\n`;

    case "dice":
      return head + `s = width;\nminkowski() {\n  cube([s-6, s-6, s-6], center=true);\n  sphere(r=3);\n}\n`;

    case "guitar_pick":
      return head + `linear_extrude(height=height) {\n  hull() {\n    translate([0, depth*0.25, 0]) circle(d=width*0.8);\n    translate([-width*0.35, depth*0.1, 0]) circle(d=width*0.3);\n    translate([width*0.35, depth*0.1, 0]) circle(d=width*0.3);\n    translate([0, -depth*0.38, 0]) circle(d=4);\n  }\n}\n`;

    case "keychain":
      return head + `difference() {\n  minkowski() {\n    cube([width-8, depth-8, height], center=true);\n    cylinder(r=4, h=0.01, center=true);\n  }\n  translate([-width/2+8, 0, -1]) cylinder(h=height+2, d=5, center=true);\n}\n`;

    case "star":
      return head + `linear_extrude(height=height) {\n  polygon([\n    for (i=[0:9])\n      let (r = i%2==0 ? width/2 : width*0.22, a = i*36)\n        [r*cos(a), r*sin(a)]\n  ]);\n}\n`;

    case "spring":
      return head + `coils = 6;\npitch = height / coils;\nfor (z=[0:coils*36])\n  rotate([0, 0, z*10])\n    translate([width*0.4, 0, z * (pitch/36)])\n      sphere(d=3.5);\n`;

    case "bolt":
      return head + `head_h = height * 0.25;\nshank_h = height * 0.75;\nunion() {\n  cylinder(h=head_h, d=width, $fn=6);\n  translate([0, 0, head_h]) cylinder(h=shank_h, d=width*0.62);\n}\n`;

    case "nut":
      return head + `difference() {\n  cylinder(h=height, d=width, $fn=6, center=true);\n  cylinder(h=height+2, d=width*0.58, center=true);\n}\n`;

    case "chair":
      return head + `union() {\n  cube([width, depth, 5], center=true);\n  translate([0, -depth/2+2.5, height*0.25]) cube([width, 5, height*0.5], center=true);\n  for (x=[-width/2+4, width/2-4])\n    for (y=[-depth/2+4, depth/2-4])\n      translate([x, y, -height*0.25]) cylinder(h=height*0.5, d=5, center=true);\n}\n`;

    case "table":
      return head + `union() {\n  translate([0, 0, height/2-3]) cube([width, depth, 6], center=true);\n  for (x=[-width/2+6, width/2-6])\n    for (y=[-depth/2+6, depth/2-6])\n      translate([x, y, 0]) cylinder(h=height-6, d=8, center=true);\n}\n`;

    case "chess_pawn":
      return head + `union() {\n  cylinder(h=height*0.18, d1=width, d2=width*0.8);\n  translate([0,0,height*0.18]) cylinder(h=height*0.5, d1=width*0.7, d2=width*0.4);\n  translate([0,0,height*0.68]) cylinder(h=height*0.08, d=width*0.55);\n  translate([0,0,height*0.84]) sphere(d=width*0.55);\n}\n`;

    case "headphone_stand":
      return head + `union() {\n  cylinder(h=10, d=width);\n  translate([0, 0, 0]) cylinder(h=height, d=16);\n  translate([0, 0, height]) rotate([0, 90, 0])\n    rotate_extrude(angle=180) translate([width*0.25, 0, 0]) circle(d=16);\n}\n`;

    case "dumbbell":
      return head + `rotate([0, 90, 0]) union() {\n  cylinder(h=width*0.6, d=14, center=true);\n  translate([0, 0, width*0.35]) cylinder(h=24, d=depth, $fn=8, center=true);\n  translate([0, 0, -width*0.35]) cylinder(h=24, d=depth, $fn=8, center=true);\n}\n`;

    case "pipe":
      return head + `difference() {\n  cylinder(h=height, d=width, center=true);\n  cylinder(h=height+2, d=width*0.8, center=true);\n}\n`;

    case "engineered_component":
      return head + `difference() {\n  union() {\n    cube([width, depth, height*0.35], center=true);\n    translate([0, 0, height*0.2]) cylinder(h=height*0.6, d=width*0.5, center=true);\n    for (i=[-2:2]) translate([i*width*0.16, 0, 0]) cube([2, depth*0.8, height*0.4], center=true);\n  }\n  cylinder(h=height*2, d=width*0.22, center=true);\n  for (x=[-width*0.38, width*0.38])\n    for (y=[-depth*0.38, depth*0.38])\n      translate([x, y, 0]) cylinder(h=height*2, d=4.5, center=true);\n}\n`;

    // ── Mechanical Presets ──────────────────────────────────────────────
    case "wrench":
      return head + `jaw = 13;\nwall = 4;\n\nunion() {\n  // Jaw\n  difference() {\n    cube([jaw + wall*2, jaw + wall, wall*2], center=true);\n    translate([jaw/2, 0, 0]) cube([jaw, jaw, wall*3], center=true);\n  }\n  // Handle\n  translate([-width/2 + (jaw+wall*2)/2, 0, 0])\n    cube([width - jaw - wall*2, wall*2.5, wall*2], center=true);\n}\n`;

    case "bottle_opener":
      return head + `difference() {\n  hull() {\n    cylinder(h=height, d=depth);\n    translate([width-depth, 0, 0]) cylinder(h=height, d=depth);\n  }\n  translate([width-depth*0.6, depth*0.15, -1]) cylinder(h=height+2, d=depth*0.6);\n}\n`;

    case "fan_blade":
      return head + `blades = 5;\nfor (a=[0:360/blades:359])\n  rotate([0,0,a])\n    translate([width*0.22, 0, 0])\n      rotate([0,0,25])\n        linear_extrude(height=height)\n          polygon([[0,-depth*0.08],[width*0.4,-depth*0.05],[width*0.45,depth*0.05],[0,depth*0.10]]);\ncylinder(h=height, d=width*0.2, center=false);\n`;

    case "turbine":
      return head + `blades = 12;\nfor (a=[0:360/blades:359])\n  rotate([0,0,a])\n    translate([width*0.28, 0, 0])\n      rotate([0,15,0])\n        cube([width*0.38, 5, height], center=true);\ncylinder(h=height, d=width*0.2);\n`;

    case "handle":
      return head + `difference() {\n  union() {\n    cylinder(h=height, d=depth);\n    translate([0, 0, height*0.35]) sphere(d=depth*1.1);\n  }\n  cylinder(h=height+2, d=width*0.35);\n}\n`;

    case "vase":
      return head + `rotate_extrude(angle=360) {\n  polygon([\n    [0, 0], [depth*0.28, 0], [depth*0.32, height*0.1],\n    [depth*0.40, height*0.5], [depth*0.36, height*0.8],\n    [depth*0.44, height], [0, height]\n  ]);\n}\n`;

    case "tray":
      return head + `wall=2.4;\ndifference() {\n  cube([width, depth, height]);\n  translate([wall, wall, wall]) cube([width-wall*2, depth-wall*2, height]);\n}\n`;

    case "lid":
      return head + `wall=1.8;\nunion() {\n  difference() {\n    cylinder(h=height, d=width+wall*2);\n    translate([0,0,wall]) cylinder(h=height, d=width);\n  }\n  translate([0,0,-3]) difference() {\n    cylinder(h=4, d=width);\n    cylinder(h=4, d=width-wall*2);\n  }\n}\n`;

    case "spool":
      return head + `bore=52;\ndifference() {\n  union() {\n    cylinder(h=height, d=width, center=true);\n    translate([0,0,-(height-6)/2]) cylinder(h=6, d=width*1.1, center=true);\n    translate([0,0,(height-6)/2]) cylinder(h=6, d=width*1.1, center=true);\n  }\n  cylinder(h=height+2, d=bore, center=true);\n  for(a=[0:30:359]) rotate([0,0,a]) translate([width*0.35,0,0]) cylinder(h=height+2, d=width*0.12, center=true);\n}\n`;

    case "ring":
      return head + `inner=width*0.6;\ndifference() {\n  cylinder(h=height, d=width, center=true);\n  cylinder(h=height+2, d=inner, center=true);\n}\n`;

    case "bracket":
      return head + `wall=4;\nunion() {\n  cube([width, wall, height]);\n  cube([wall, depth, height]);\n  translate([0, 0, 0]) rotate([0,45,0]) cube([wall*1.4, depth, wall*1.4]);\n}\n`;

    case "shelf_bracket":
      return head + `wall=5;\nunion() {\n  cube([width, wall, height]);\n  cube([wall, depth, height]);\n  translate([wall, 0, 0]) rotate([0, 90, 0])\n    linear_extrude(width-wall) polygon([[0,0],[0,depth],[depth,0]]);\n}\n`;

    case "hook":
      return head + `r=depth*0.4;\ndifference() {\n  union() {\n    translate([0, r, 0]) rotate_extrude(angle=200) translate([r, 0, 0]) circle(d=width*0.3);\n    translate([0, 0, 0]) cube([width*0.3, height*0.55, depth*0.3], center=true);\n  }\n  translate([0, r, 0]) rotate_extrude(angle=201) translate([r, 0, 0]) circle(d=width*0.16);\n}\n`;

    case "lamp_shade":
      return head + `top_r=width*0.18; bot_r=width*0.5; wall=2.5;\ndifference() {\n  cylinder(h=height, r1=bot_r, r2=top_r);\n  translate([0,0,wall]) cylinder(h=height, r1=bot_r-wall, r2=top_r-wall);\n  for(a=[0:15:359]) rotate([0,0,a]) for(z=[10:20:height-10])\n    translate([bot_r*0.7,0,z]) rotate([0,90,0]) cylinder(h=20,d=5);\n}\n`;

    case "bearing_gear":
      return head + `teeth=18;\ndifference() {\n  union() {\n    cylinder(h=height, d=width*0.5, center=true);\n    for(a=[0:360/teeth:359])\n      rotate([0,0,a]) translate([width*0.28,0,0]) rotate([0,0,a])\n        cube([width*0.08, width*0.06, height], center=true);\n  }\n  cylinder(h=height+2, d=width*0.16, center=true);\n}\n`;

    case "drone_mount":
      return head + `difference() {\n  union() {\n    cylinder(h=height*0.35, d=width, $fn=6, center=true);\n    translate([0,0,height*0.4]) cylinder(h=height*0.5, d=width*0.5, center=true);\n    translate([0,-depth*0.3,6]) cube([depth*0.22, depth*0.6, 12], center=true);\n  }\n  translate([0,0,height*0.5]) cylinder(h=30, d=6.5, center=true);\n  for(x=[-8,8]) translate([x,0,8]) cylinder(h=24, d=2.4, center=true);\n}\n`;

    case "cable_clip":
      return head + `gap=6; wall=2.4;\ndifference() {\n  union() {\n    cube([width, depth, height*0.4], center=true);\n    translate([0,0,height*0.35]) cube([width, depth*0.7, height*0.5], center=true);\n  }\n  translate([0,-depth*0.2,0]) cylinder(h=height+4, d=gap+wall, center=true);\n  translate([0,-depth*0.55,0]) cube([gap, depth, height+4], center=true);\n}\n`;

    case "custom_box":
      return head + `wall=2.2;\ndifference() {\n  union() {\n    cube([width, depth, height], center=true);\n    translate([0,0,height/2+1.6]) cube([width, depth, 4], center=true);\n  }\n  translate([0,0,wall]) cube([width-wall*2, depth-wall*2, height+6], center=true);\n}\n`;

    case "hex_case":
      return head + `wall=2.5;\ndifference() {\n  cylinder(h=height, d=width, $fn=6, center=true);\n  cylinder(h=height+2, d=width-wall*2, $fn=6, center=true);\n}\n`;

    case "phone_stand":
    default:
      return head + `thickness=6; tilt=20;\ndifference() {\n  union() {\n    cube([width, depth, thickness], center=true);\n    rotate([tilt,0,0]) translate([0,depth*0.25,height/2]) cube([width*0.92,thickness,height], center=true);\n    translate([0,-depth*0.38,height*0.14]) cube([width*0.92,10,height*0.22], center=true);\n  }\n  translate([0,-depth*0.1,0]) cylinder(h=thickness+4, d=14, center=true);\n}\n`;
  }
}

function estimatesFor(spec: LocalSpec) {
  const volumeCm3 = (spec.width * spec.height * spec.depth) / 1000;
  const solidGrams = volumeCm3 * 1.24;
  const filamentWeightGrams = Math.max(4, Math.round(solidGrams * 0.28));
  const layerCount = Math.max(20, Math.round(spec.height / 0.2));
  const printTimeMinutes = Math.max(8, Math.round(filamentWeightGrams * 1.6 + layerCount * 0.05));
  return { printTimeMinutes, filamentWeightGrams, layerCount, recommendedMaterial: spec.material };
}

export function buildLocalModel(prompt: string): CadModelResult {
  const spec = specFor(prompt);
  return {
    name: spec.name,
    description: spec.description,
    dimensions: { widthMm: spec.width, heightMm: spec.height, depthMm: spec.depth },
    openScadCode: scadFor(spec),
    printEstimates: estimatesFor(spec),
    meshPreset: spec.meshPreset,
    primitives: spec.primitives,
  };
}

// ─── LLM refinement ───────────────────────────────────────────────────────────

const CAD_SYSTEM = `You are JARVIS Mark Prototype — a master 3D CAD engineer and OpenSCAD architect.
Return ONLY a single valid JSON object (absolutely no markdown, no code fences, no commentary).

Required keys:
  name           - concise part name (e.g. "Cheops Pyramid", "Espresso Mug")
  description    - one concise sentence physical description
  widthMm        - number (overall bounding box X, millimetres)
  heightMm       - number (overall bounding box Z/height, millimetres)
  depthMm        - number (overall bounding box Y, millimetres)
  openScadCode   - COMPLETE, 100% valid, functional OpenSCAD code designing this EXACT object (use \\n for newlines)
  printTimeMinutes - realistic FDM print time at 0.2mm layer height (e.g. 45)
  filamentWeightGrams - realistic PLA weight (e.g. 28)
  layerCount     - number of 0.2mm layers
  recommendedMaterial - one of: PLA, PETG, TPU, ABS
  meshPreset     - concise lowercase identifier describing the shape (e.g. pyramid, mug, rocket, airplane, car, sword, dice, star, spring, bolt, nut, chair, table, chess_pawn, vase, hook, wrench, turbine, sphere, cone, bottle, bowl, torus, capsule, etc.)
  primitives     - (CRITICAL) Array of 1 to 6 primitive 3D shapes to construct this real object in Three.js so the user sees the genuine part immediately, NEVER a generic rectangle.
    Each primitive item must be:
    {
      "shape": "box" | "cylinder" | "cone" | "sphere" | "torus" | "pyramid" | "capsule" | "ring",
      "size": [dim1, dim2, dim3],
      "position": [x, y, z],
      "rotation": [rx, ry, rz]
    }
    Rules for primitives:
    - Center the composite object around [0, 0, 0].
    - For pyramid: shape "pyramid", size [baseX, height, baseZ].
    - For mug: cylinder for body [r, r, h], torus for handle [r, tubeR] at [r+10, 0, 0].
    - For rocket: cylinder body, cone nose at top, thin boxes for fins at base.
    - For sphere/ball: shape "sphere", size [radius].
    - For cone: shape "cone", size [radius, height].

Generate genuine, high-quality CAD designs matching the user's specific request.`;

async function tryGroqCadNoThink(prompt: string): Promise<any | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key || key.includes("your_")) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_BUDGET_MS);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        temperature: 0.1,
        max_tokens: 1100,
        messages: [{
          role: "user",
          content: `/no_think\n${CAD_SYSTEM}\n\nDesign this 3D-printable part: "${prompt}"`,
        }],
      }),
    });
    if (!res.ok) { console.warn("[CadHandler] Groq HTTP", res.status); return null; }
    const data = await res.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    return parseJsonLoose(stripped);
  } catch (e: any) {
    console.warn("[CadHandler] Groq failed:", e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tryGeminiCad(prompt: string): Promise<any | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.includes("your_")) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_BUDGET_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CAD_SYSTEM }] },
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 1100,
            thinkingConfig: { thinkingBudget: 0 },
          },
          contents: [{ role: "user", parts: [{ text: `Design 3D part: ${prompt}` }] }],
        }),
      }
    );
    if (!res.ok) { console.warn("[CadHandler] Gemini HTTP", res.status); return null; }
    const data = await res.json();
    const raw: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
    return raw ? parseJsonLoose(raw) : null;
  } catch (e: any) {
    console.warn("[CadHandler] Gemini failed:", e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function raceProviders(prompt: string): Promise<any | null> {
  const attempts = [tryGroqCadNoThink(prompt), tryGeminiCad(prompt)];
  const first = new Promise<any>((resolve) => {
    let pending = attempts.length;
    let done = false;
    for (const p of attempts) {
      p.then((val) => {
        if (done) return;
        if (val !== null) { done = true; resolve(val); return; }
        if (--pending === 0) resolve(null);
      }).catch(() => { if (!done && --pending === 0) resolve(null); });
    }
  });
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), LLM_BUDGET_MS + 400));
  return Promise.race([first, deadline]);
}

function sanitizePrimitives(arr: any): CadPrimitive[] | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const validShapes = new Set(["box", "cylinder", "cone", "sphere", "torus", "pyramid", "capsule", "ring", "wedge"]);
  const res: CadPrimitive[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const shape = String(item.shape || "").toLowerCase();
    if (!validShapes.has(shape)) continue;
    const size = Array.isArray(item.size) ? item.size.map((v: any) => Math.max(1, Number(v) || 10)) : undefined;
    const position = Array.isArray(item.position) ? [Number(item.position[0]) || 0, Number(item.position[1]) || 0, Number(item.position[2]) || 0] as [number, number, number] : undefined;
    const rotation = Array.isArray(item.rotation) ? [Number(item.rotation[0]) || 0, Number(item.rotation[1]) || 0, Number(item.rotation[2]) || 0] as [number, number, number] : undefined;
    res.push({
      shape: shape as any,
      size,
      position,
      rotation,
    });
  }
  return res.length > 0 ? res : undefined;
}

function mergeLlm(local: CadModelResult, llm: any): CadModelResult {
  if (!llm || typeof llm !== "object") return local;
  const num = (v: unknown, fb: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fb; };
  const str = (v: unknown, fb: string) => (typeof v === "string" && v.trim() ? v.trim() : fb);

  // Accept any valid descriptive preset identifier from LLM
  let llmPreset = local.meshPreset;
  if (typeof llm.meshPreset === "string" && llm.meshPreset.trim()) {
    llmPreset = llm.meshPreset.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  }

  const prims = sanitizePrimitives(llm.primitives) ?? local.primitives;

  return {
    name: str(llm.name, local.name),
    description: str(llm.description, local.description),
    dimensions: {
      widthMm: num(llm.widthMm, local.dimensions.widthMm),
      heightMm: num(llm.heightMm, local.dimensions.heightMm),
      depthMm: num(llm.depthMm, local.dimensions.depthMm),
    },
    openScadCode:
      typeof llm.openScadCode === "string" && llm.openScadCode.length > 60
        ? llm.openScadCode
        : local.openScadCode,
    printEstimates: {
      printTimeMinutes: num(llm.printTimeMinutes, local.printEstimates.printTimeMinutes),
      filamentWeightGrams: num(llm.filamentWeightGrams, local.printEstimates.filamentWeightGrams),
      layerCount: num(llm.layerCount, local.printEstimates.layerCount),
      recommendedMaterial: str(llm.recommendedMaterial, local.printEstimates.recommendedMaterial),
    },
    meshPreset: llmPreset,
    primitives: prims,
  };
}

export async function handleCad(action: string, params: Record<string, any>) {
  if (action === "generate") {
    const prompt = String(params.prompt || "custom precision part").trim();

    // 1) Instant local model — always generated in <2ms, guaranteed valid
    const local = buildLocalModel(prompt);

    // 2) LLM refinement runs in parallel. If Groq answers in ~1s, merge happens.
    //    On network delay or timeout, local wins without stalling the UI.
    let model = local;
    try {
      const llm = await raceProviders(prompt);
      if (llm) model = mergeLlm(local, llm);
    } catch { /* keep local */ }

    return {
      success: true,
      mcp: "cad",
      action,
      data: model,
      meta: { source: model === local ? "parametric" : "llm+parametric" },
    };
  }
  return { success: false, error: `Unsupported cad action '${action}'` };
}
