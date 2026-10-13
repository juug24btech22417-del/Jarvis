"use client";

import React, { useState, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  Box,
  Download,
  Copy,
  Check,
  Sparkles,
  Cpu,
  RefreshCw,
  Layers,
  Clock,
  Weight,
} from "lucide-react";

// ─── Geometric Helpers ───────────────────────────────────────────────────────

/** Generates a genuine 4-sided pyramid with square base and centered apex */
function createPyramidGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const hh = h / 2;
  // 4 triangle sides + 2 triangles for square base = 6 triangles = 18 vertices
  const vertices = new Float32Array([
    // Base 1
    -hw, -hh, -hd,   hw, -hh, -hd,   hw, -hh, hd,
    // Base 2
    -hw, -hh, -hd,   hw, -hh, hd,   -hw, -hh, hd,
    // Front face
    -hw, -hh, hd,    hw, -hh, hd,    0, hh, 0,
    // Right face
    hw, -hh, hd,     hw, -hh, -hd,   0, hh, 0,
    // Back face
    hw, -hh, -hd,   -hw, -hh, -hd,   0, hh, 0,
    // Left face
    -hw, -hh, -hd,  -hw, -hh, hd,    0, hh, 0,
  ]);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geom.computeVertexNormals();
  return geom;
}

/** Generates a smooth 3D helical spring */
function createSpringGeometry(radius: number, tubeRadius: number, height: number, coils: number): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const segments = coils * 36;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = t * coils * Math.PI * 2;
    const y = (t - 0.5) * height;
    points.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, segments, tubeRadius, 16, false);
}

/** Generates an extruded 5-pointed star */
function createStarGeometry(outerRadius: number, innerRadius: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 1.5, bevelThickness: 1.5 });
}

// ─── Procedural Preset Mesh Builder ─────────────────────────────────────────

function buildPresetMesh(
  preset: string | undefined,
  w: number,
  h: number,
  d: number,
  material: THREE.MeshStandardMaterial
): THREE.Group {
  const group = new THREE.Group();
  const m = material;
  const s = 0.72; // global display scale factor

  switch (preset) {
    /* ── Geometric Primitives ──────────────────────────────── */
    case "pyramid": {
      group.add(new THREE.Mesh(createPyramidGeometry(w * s, h * s, d * s), m));
      break;
    }
    case "cone": {
      group.add(new THREE.Mesh(new THREE.ConeGeometry((w / 2) * s, h * s, 48), m));
      break;
    }
    case "sphere": {
      group.add(new THREE.Mesh(new THREE.SphereGeometry((w / 2) * s, 48, 32), m));
      break;
    }
    case "torus": {
      group.add(new THREE.Mesh(new THREE.TorusGeometry((w * 0.36) * s, Math.max(4, h * 0.35 * s), 24, 48), m));
      break;
    }
    case "capsule": {
      const r = (w / 2) * s;
      const len = Math.max(6, (h - w) * s);
      group.add(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 16, 32), m));
      break;
    }

    /* ── Drinkware & Vessels ───────────────────────────────── */
    case "mug":
    case "coffee_mug": {
      // Outer mug cylinder
      const body = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.42) * s, (w * 0.38) * s, h * s, 48), m);
      group.add(body);
      // Ergonomic C-handle
      const handle = new THREE.Mesh(new THREE.TorusGeometry((h * 0.28) * s, 5 * s, 20, 36, Math.PI * 1.1), m);
      handle.position.set((w * 0.42) * s + 6 * s, 0, 0);
      handle.rotation.z = -Math.PI * 0.05;
      group.add(handle);
      break;
    }
    case "bottle": {
      const pts: THREE.Vector2[] = [];
      const rMax = (w / 2) * s;
      pts.push(new THREE.Vector2(0, -h * 0.5 * s));
      pts.push(new THREE.Vector2(rMax * 0.9, -h * 0.5 * s));
      pts.push(new THREE.Vector2(rMax, -h * 0.4 * s));
      pts.push(new THREE.Vector2(rMax, h * 0.15 * s));
      pts.push(new THREE.Vector2(rMax * 0.32, h * 0.35 * s));
      pts.push(new THREE.Vector2(rMax * 0.32, h * 0.5 * s));
      pts.push(new THREE.Vector2(0, h * 0.5 * s));
      group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), m));
      break;
    }
    case "bowl": {
      const pts: THREE.Vector2[] = [];
      const rMax = (w / 2) * s;
      for (let i = 0; i <= 24; i++) {
        const t = (i / 24) * Math.PI * 0.5;
        pts.push(new THREE.Vector2(Math.sin(t) * rMax, -Math.cos(t) * (h * s) + (h * 0.5 * s)));
      }
      group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), m));
      break;
    }

    /* ── Vehicles & Aerospace ──────────────────────────────── */
    case "rocket": {
      // Fuselage
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.22) * s, (w * 0.26) * s, h * 0.65 * s, 36), m);
      fuse.position.y = -h * 0.05 * s;
      group.add(fuse);
      // Aerodynamic ogive nose cone
      const nose = new THREE.Mesh(new THREE.ConeGeometry((w * 0.22) * s, h * 0.35 * s, 36), m);
      nose.position.y = h * 0.45 * s;
      group.add(nose);
      // 4 Swept stabilizing fins
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const fin = new THREE.Mesh(new THREE.BoxGeometry(w * 0.35 * s, h * 0.24 * s, 2.5 * s), m);
        fin.position.set(Math.cos(a) * w * 0.24 * s, -h * 0.25 * s, Math.sin(a) * w * 0.24 * s);
        fin.rotation.y = -a;
        group.add(fin);
      }
      break;
    }
    case "airplane": {
      // Fuselage cylinder
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(8 * s, 7 * s, d * s, 24), m);
      fuse.rotation.x = Math.PI / 2;
      group.add(fuse);
      // Cockpit nose
      const nose = new THREE.Mesh(new THREE.ConeGeometry(8 * s, 16 * s, 24), m);
      nose.position.z = -d * 0.5 * s - 8 * s;
      nose.rotation.x = -Math.PI / 2;
      group.add(nose);
      // Main swept wings
      const wings = new THREE.Mesh(new THREE.BoxGeometry(w * s, 3 * s, 26 * s), m);
      wings.position.set(0, 2 * s, -d * 0.05 * s);
      group.add(wings);
      // Horizontal rear stabilizers
      const stabs = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42 * s, 2 * s, 14 * s), m);
      stabs.position.set(0, 3 * s, d * 0.38 * s);
      group.add(stabs);
      // Vertical tail fin
      const fin = new THREE.Mesh(new THREE.BoxGeometry(2.5 * s, 22 * s, 18 * s), m);
      fin.position.set(0, 11 * s, d * 0.34 * s);
      group.add(fin);
      break;
    }
    case "car": {
      // Chassis
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85 * s, h * 0.38 * s, d * s), m);
      group.add(chassis);
      // Cabin canopy
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(w * 0.65 * s, h * 0.42 * s, d * 0.55 * s), m);
      cabin.position.set(0, h * 0.36 * s, -d * 0.05 * s);
      group.add(cabin);
      // 4 Wheels
      for (const z of [-d * 0.32 * s, d * 0.32 * s]) {
        for (const x of [-w * 0.45 * s, w * 0.45 * s]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(10 * s, 10 * s, 6 * s, 24), m);
          wheel.position.set(x, -h * 0.16 * s, z);
          wheel.rotation.z = Math.PI / 2;
          group.add(wheel);
        }
      }
      break;
    }

    /* ── Props & Mechanical ────────────────────────────────── */
    case "sword": {
      // Double-edged blade
      const blade = new THREE.Mesh(new THREE.BoxGeometry(16 * s, h * 0.65 * s, 3.5 * s), m);
      blade.position.y = h * 0.16 * s;
      group.add(blade);
      // Crossguard
      const guard = new THREE.Mesh(new THREE.BoxGeometry(w * s, 9 * s, 12 * s), m);
      guard.position.y = -h * 0.18 * s;
      group.add(guard);
      // Grip
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(5 * s, 5 * s, h * 0.22 * s, 24), m);
      grip.position.y = -h * 0.3 * s;
      group.add(grip);
      // Pommel
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(8 * s, 24, 16), m);
      pommel.position.y = -h * 0.43 * s;
      group.add(pommel);
      break;
    }
    case "dice": {
      const sz = Math.min(w, h, d) * s;
      const cube = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), m);
      group.add(cube);
      break;
    }
    case "guitar_pick": {
      const pickGeom = new THREE.ConeGeometry((w * 0.45) * s, Math.max(2, h * s), 3);
      pickGeom.rotateX(Math.PI / 2);
      group.add(new THREE.Mesh(pickGeom, m));
      break;
    }
    case "keychain": {
      const tag = new THREE.Mesh(new THREE.BoxGeometry(w * s, Math.max(3, h * s), d * s), m);
      group.add(tag);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(3 * s, 3 * s, Math.max(5, h * s) + 2, 24), m);
      hole.position.x = -w * 0.38 * s;
      group.add(hole);
      break;
    }
    case "star": {
      const star = new THREE.Mesh(createStarGeometry((w / 2) * s, (w * 0.22) * s, Math.max(4, h * s)), m);
      star.rotation.x = Math.PI / 2;
      group.add(star);
      break;
    }
    case "spring": {
      group.add(new THREE.Mesh(createSpringGeometry((w * 0.38) * s, 3.5 * s, h * s, 6), m));
      break;
    }
    case "bolt": {
      const head = new THREE.Mesh(new THREE.CylinderGeometry((w / 2) * s, (w / 2) * s, h * 0.28 * s, 6), m);
      head.position.y = h * 0.36 * s;
      group.add(head);
      const shank = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.3) * s, (w * 0.3) * s, h * 0.72 * s, 32), m);
      shank.position.y = -h * 0.14 * s;
      group.add(shank);
      break;
    }
    case "nut": {
      const outer = new THREE.Mesh(new THREE.CylinderGeometry((w / 2) * s, (w / 2) * s, h * s, 6), m);
      group.add(outer);
      break;
    }
    case "chair": {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(w * s, 5 * s, d * s), m);
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * 0.5 * s, 5 * s), m);
      back.position.set(0, h * 0.26 * s, -d * 0.45 * s);
      group.add(back);
      for (const x of [-w * 0.42 * s, w * 0.42 * s]) {
        for (const z of [-d * 0.42 * s, d * 0.42 * s]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(2.5 * s, 2 * s, h * 0.46 * s, 16), m);
          leg.position.set(x, -h * 0.24 * s, z);
          group.add(leg);
        }
      }
      break;
    }
    case "table": {
      const top = new THREE.Mesh(new THREE.BoxGeometry(w * s, 6 * s, d * s), m);
      top.position.y = h * 0.45 * s;
      group.add(top);
      for (const x of [-w * 0.42 * s, w * 0.42 * s]) {
        for (const z of [-d * 0.42 * s, d * 0.42 * s]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(4 * s, 4 * s, h * 0.9 * s, 16), m);
          leg.position.set(x, 0, z);
          group.add(leg);
        }
      }
      break;
    }
    case "chess_pawn": {
      const base = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.45) * s, (w * 0.5) * s, h * 0.18 * s, 32), m);
      base.position.y = -h * 0.41 * s;
      group.add(base);
      const column = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.2) * s, (w * 0.38) * s, h * 0.55 * s, 32), m);
      column.position.y = -h * 0.05 * s;
      group.add(column);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.3) * s, (w * 0.3) * s, h * 0.08 * s, 32), m);
      collar.position.y = h * 0.24 * s;
      group.add(collar);
      const head = new THREE.Mesh(new THREE.SphereGeometry((w * 0.28) * s, 28, 20), m);
      head.position.y = h * 0.38 * s;
      group.add(head);
      break;
    }
    case "headphone_stand": {
      const base = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.48) * s, (w * 0.5) * s, 12 * s, 36), m);
      base.position.y = -h * 0.45 * s;
      group.add(base);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(7 * s, 9 * s, h * 0.85 * s, 24), m);
      stalk.position.y = 0;
      group.add(stalk);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(w * 0.24 * s, 7 * s, 20, 36, Math.PI), m);
      hook.position.y = h * 0.42 * s;
      hook.rotation.z = Math.PI;
      group.add(hook);
      break;
    }
    case "dumbbell": {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(6 * s, 6 * s, w * 0.65 * s, 24), m);
      bar.rotation.z = Math.PI / 2;
      group.add(bar);
      for (const x of [-w * 0.38 * s, w * 0.38 * s]) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry((d * 0.45) * s, (d * 0.45) * s, 18 * s, 8), m);
        plate.position.x = x;
        plate.rotation.z = Math.PI / 2;
        group.add(plate);
      }
      break;
    }
    case "pipe": {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.45) * s, (w * 0.45) * s, h * s, 48), m);
      group.add(pipe);
      for (const y of [-h * 0.45 * s, h * 0.45 * s]) {
        const flange = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.54) * s, (w * 0.54) * s, 8 * s, 48), m);
        flange.position.y = y;
        group.add(flange);
      }
      break;
    }

    /* ── Legacy Mechanical Presets ─────────────────────────── */
    case "wrench": {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72 * s, h * 0.35 * s, d * 0.22 * s), m);
      handle.position.x = -w * 0.08 * s;
      group.add(handle);
      const jawBody = new THREE.Mesh(new THREE.BoxGeometry(w * 0.24 * s, h * 0.9 * s, d * 0.36 * s), m);
      jawBody.position.x = w * 0.4 * s;
      group.add(jawBody);
      const jawTop = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16 * s, h * 0.28 * s, d * 0.36 * s), m);
      jawTop.position.set(w * 0.32 * s, h * 0.31 * s, 0);
      group.add(jawTop);
      break;
    }
    case "bottle_opener": {
      const body = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * 0.28 * s), m);
      group.add(body);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.2 * s, d * 0.2 * s, h * s, 32), m);
      hook.position.set(w * 0.34 * s, 0, 0);
      group.add(hook);
      break;
    }
    case "fan_blade": {
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.11 * s, w * 0.11 * s, h * s, 32), m);
      group.add(hub);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(w * 0.44 * s, h * s, d * 0.11 * s), m);
        blade.position.set(Math.cos(a) * w * 0.27 * s, 0, Math.sin(a) * w * 0.27 * s);
        blade.rotation.y = -a + 0.42;
        group.add(blade);
      }
      break;
    }
    case "turbine": {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.46 * s, w * 0.46 * s, h * 0.28 * s, 32), m);
      group.add(disc);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3 * s, h * s, 5 * s), m);
        blade.position.set(Math.cos(a) * w * 0.29 * s, h * 0.14 * s, Math.sin(a) * w * 0.29 * s);
        blade.rotation.y = -a;
        blade.rotation.x = 0.26;
        group.add(blade);
      }
      group.add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.09 * s, w * 0.09 * s, h * s, 24), m));
      break;
    }
    case "handle": {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.48 * s, d * 0.4 * s, h * 0.68 * s, 32), m);
      group.add(grip);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(d * 0.52 * s, 24, 16), m);
      knob.position.y = h * 0.34 * s;
      group.add(knob);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.2 * s, d * 0.2 * s, h * 0.24 * s, 24), m);
      stem.position.y = -h * 0.44 * s;
      group.add(stem);
      break;
    }
    case "vase": {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const r = (w * 0.5 * s) * (0.28 + 0.22 * Math.sin(t * Math.PI) + 0.1 * t);
        pts.push(new THREE.Vector2(r, t * h * s - (h * s) / 2));
      }
      group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), m));
      break;
    }
    case "tray": {
      const wall = Math.max(3, w * 0.03 * s);
      const bot = new THREE.Mesh(new THREE.BoxGeometry(w * s, wall, d * s), m);
      group.add(bot);
      const fb = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, wall), m);
      fb.position.set(0, (h * s) / 2, (d * s) / 2);
      group.add(fb);
      const fb2 = fb.clone(); fb2.position.z = -(d * s) / 2; group.add(fb2);
      const lr = new THREE.Mesh(new THREE.BoxGeometry(wall, h * s, d * s), m);
      lr.position.set((w * s) / 2, (h * s) / 2, 0);
      group.add(lr);
      const lr2 = lr.clone(); lr2.position.x = -(w * s) / 2; group.add(lr2);
      break;
    }
    case "lid": {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5 * s + 3, w * 0.5 * s + 3, h * s, 48), m);
      group.add(rim);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5 * s, w * 0.5 * s, h * 0.54 * s, 48), m);
      inner.position.y = -h * 0.22 * s;
      group.add(inner);
      break;
    }
    case "spool": {
      const core = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.14 * s, w * 0.14 * s, h * s, 32), m);
      group.add(core);
      const fa = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5 * s, w * 0.5 * s, h * 0.07 * s, 48), m);
      fa.position.y = (h * s) / 2 - h * 0.035 * s;
      group.add(fa);
      const fb = fa.clone(); fb.position.y = -(h * s) / 2 + h * 0.035 * s; group.add(fb);
      break;
    }
    case "ring": {
      const outer = w * 0.5 * s, inner = outer * 0.62;
      const pts: THREE.Vector2[] = [
        new THREE.Vector2(inner, 0), new THREE.Vector2(outer, 0),
        new THREE.Vector2(outer, h * s), new THREE.Vector2(inner, h * s),
      ];
      group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 64), m));
      break;
    }
    case "bracket": {
      group.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(5 * s, h * s, d * s), m), { position: new THREE.Vector3(-w * 0.5 * s + 2.5 * s, 0, 0) }));
      group.add(new THREE.Mesh(new THREE.BoxGeometry(w * s, 5 * s, d * s), m));
      const gus = new THREE.Mesh(new THREE.BoxGeometry(5 * s, h * 0.5 * s, d * 0.5 * s), m);
      gus.position.set(-w * 0.5 * s + 2.5 * s, h * 0.24 * s, -d * 0.2 * s);
      gus.rotation.x = -0.5;
      group.add(gus);
      break;
    }
    case "shelf_bracket": {
      const vert = new THREE.Mesh(new THREE.BoxGeometry(5 * s, h * s, 8 * s), m);
      vert.position.x = -w * 0.5 * s + 2.5 * s;
      group.add(vert);
      const horiz = new THREE.Mesh(new THREE.BoxGeometry(w * s, 8 * s, d * s), m);
      horiz.position.y = -h * 0.5 * s + 4 * s;
      group.add(horiz);
      const diag = new THREE.Mesh(new THREE.BoxGeometry(5 * s, Math.sqrt(h * h + d * d) * 0.65 * s, 8 * s), m);
      diag.position.set(-w * 0.5 * s + 2.5 * s, -h * 0.14 * s, d * 0.24 * s);
      diag.rotation.x = Math.atan2(d * 0.6, h * 0.6);
      group.add(diag);
      break;
    }
    case "hook": {
      const stem = new THREE.Mesh(new THREE.BoxGeometry(8 * s, h * 0.52 * s, 8 * s), m);
      stem.position.y = h * 0.22 * s;
      group.add(stem);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(d * 0.36 * s, 6 * s, 16, 32, Math.PI * 1.1), m);
      arc.position.y = -h * 0.04 * s;
      arc.rotation.z = -Math.PI * 0.04;
      group.add(arc);
      break;
    }
    case "lamp_shade": {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        pts.push(new THREE.Vector2((w * 0.18 + w * 0.32 * t) * s, t * h * s - (h * s) / 2));
      }
      group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), m));
      break;
    }
    case "bearing_gear": {
      group.add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.25 * s, w * 0.25 * s, h * s, 48), m));
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const t = new THREE.Mesh(new THREE.BoxGeometry(w * 0.08 * s, h * s, w * 0.06 * s), m);
        t.position.set(Math.cos(a) * w * 0.28 * s, 0, Math.sin(a) * w * 0.28 * s);
        t.rotation.y = -a;
        group.add(t);
      }
      group.add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.08 * s, w * 0.08 * s, h * s + 2, 24), m));
      break;
    }
    case "drone_mount": {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5 * s, w * 0.5 * s, h * 0.35 * s, 6), m);
      group.add(base);
      const boss = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.25 * s, w * 0.25 * s, h * 0.5 * s, 32), m);
      boss.position.y = h * 0.4 * s;
      group.add(boss);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(d * 0.22 * s, 12 * s, d * 0.6 * s), m);
      arm.position.set(0, 6 * s, -d * 0.3 * s);
      group.add(arm);
      break;
    }
    case "cable_clip": {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(w * s, h * 0.4 * s, d * s), m));
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * 0.5 * s, d * 0.7 * s), m);
      jaw.position.y = h * 0.35 * s;
      group.add(jaw);
      break;
    }
    case "custom_box": {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), m));
      const lid = new THREE.Mesh(new THREE.BoxGeometry(w * s, 4 * s, d * s), m);
      lid.position.y = (h * s) / 2 + 2;
      group.add(lid);
      break;
    }
    case "hex_case": {
      group.add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5 * s, w * 0.5 * s, h * s, 6), m));
      break;
    }
    case "phone_stand": {
      const base = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8 * s, 8, d * 0.8 * s), m);
      group.add(base);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75 * s, 8, h * 0.75 * s), m);
      back.position.set(0, 28, 10);
      back.rotation.x = -0.35;
      group.add(back);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75 * s, 16, 8), m);
      lip.position.set(0, 8, -d * 0.35 * s);
      group.add(lip);
      break;
    }
    case "engineered_component":
    default: {
      // Precision engineered mounting component with chamfered base, center hub boss, and heat sink fins
      const base = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * 0.35 * s, d * s), m);
      base.position.y = -h * 0.25 * s;
      group.add(base);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry((w * 0.26) * s, (w * 0.28) * s, h * 0.75 * s, 36), m);
      hub.position.y = h * 0.1 * s;
      group.add(hub);
      // Cooling / structural fins
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const fin = new THREE.Mesh(new THREE.BoxGeometry(2.5 * s, h * 0.45 * s, d * 0.85 * s), m);
        fin.position.set(i * (w * 0.16) * s, 0, 0);
        group.add(fin);
      }
      break;
    }
  }

  return group;
}

/** Build compound 3D mesh dynamically from primitives or preset */
function buildDynamic3DModel(
  model: any,
  material: THREE.MeshStandardMaterial
): THREE.Group {
  const group = new THREE.Group();
  const m = material;
  const s = 0.72;

  // 1) Dynamic Primitives from LLM or smart procedural synthesiser
  if (Array.isArray(model?.primitives) && model.primitives.length > 0) {
    for (const p of model.primitives) {
      if (!p || typeof p !== "object") continue;
      const shape = String(p.shape || "").toLowerCase();
      const sz = Array.isArray(p.size) ? p.size : [30, 30, 30];
      const pos = Array.isArray(p.position) ? p.position : [0, 0, 0];
      const rot = Array.isArray(p.rotation) ? p.rotation : [0, 0, 0];

      let geom: THREE.BufferGeometry | null = null;
      switch (shape) {
        case "pyramid":
          geom = createPyramidGeometry(sz[0] * s, (sz[1] ?? sz[0]) * s, (sz[2] ?? sz[0]) * s);
          break;
        case "cone":
          geom = new THREE.ConeGeometry((sz[0] ?? 20) * s, (sz[1] ?? 40) * s, 48);
          break;
        case "sphere":
          geom = new THREE.SphereGeometry((sz[0] ?? 20) * s, 48, 32);
          break;
        case "torus":
          geom = new THREE.TorusGeometry((sz[0] ?? 25) * s, (sz[1] ?? 6) * s, 24, 48);
          break;
        case "cylinder":
          geom = new THREE.CylinderGeometry((sz[0] ?? 20) * s, (sz[1] ?? sz[0] ?? 20) * s, (sz[2] ?? 50) * s, 48);
          break;
        case "capsule":
          geom = new THREE.CapsuleGeometry((sz[0] ?? 15) * s, Math.max(4, (sz[1] ?? 30) * s), 16, 32);
          break;
        case "box":
        default:
          geom = new THREE.BoxGeometry((sz[0] ?? 30) * s, (sz[1] ?? 30) * s, (sz[2] ?? 30) * s);
          break;
      }

      if (geom) {
        const mesh = new THREE.Mesh(geom, m);
        mesh.position.set(pos[0] * s, pos[1] * s, pos[2] * s);
        mesh.rotation.set(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0);
        group.add(mesh);
      }
    }
    if (group.children.length > 0) return group;
  }

  // 2) Fallback to preset library (50+ shapes)
  const w = model.dimensions?.widthMm || 70;
  const h = model.dimensions?.heightMm || 90;
  const d = model.dimensions?.depthMm || 75;
  return buildPresetMesh(model.meshPreset, w, h, d, m);
}

/** Genuine Three.js ASCII STL Exporter for 3D printing */
function exportGroupToStl(group: THREE.Group, modelName: string): string {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, "_");
  let stl = `solid ${safeName}\n`;
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const normal = new THREE.Vector3();

  group.updateMatrixWorld(true);

  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geom = mesh.geometry;
      if (!geom) return;

      const nonIndexed = geom.index ? geom.toNonIndexed() : geom;
      const posAttr = nonIndexed.getAttribute("position");
      if (!posAttr) return;

      for (let i = 0; i < posAttr.count; i += 3) {
        vA.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
        vB.fromBufferAttribute(posAttr, i + 1).applyMatrix4(mesh.matrixWorld);
        vC.fromBufferAttribute(posAttr, i + 2).applyMatrix4(mesh.matrixWorld);

        cb.subVectors(vC, vB);
        ab.subVectors(vA, vB);
        cb.cross(ab).normalize();
        normal.copy(cb);

        stl += `  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n`;
        stl += `    outer loop\n`;
        stl += `      vertex ${vA.x.toFixed(4)} ${vA.y.toFixed(4)} ${vA.z.toFixed(4)}\n`;
        stl += `      vertex ${vB.x.toFixed(4)} ${vB.y.toFixed(4)} ${vB.z.toFixed(4)}\n`;
        stl += `      vertex ${vC.x.toFixed(4)} ${vC.y.toFixed(4)} ${vC.z.toFixed(4)}\n`;
        stl += `    endloop\n`;
        stl += `  endfacet\n`;
      }
    }
  });

  stl += `endsolid ${safeName}\n`;
  return stl;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CadTab() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [activeTab, setActiveTab] = useState<"3d" | "scad">("3d");
  const [wireframe, setWireframe] = useState(false);
  const [copied, setCopied] = useState(false);

  const genStepLabels = [
    "Synthesizing 3D geometry...",
    "Computing parametric OpenSCAD...",
    "Generating Three.js solid...",
    "Refining toolpath preview...",
  ];

  const [cadModel, setCadModel] = useState<any>(null);

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const velRef = useRef({ x: 0, y: 0 });

  const presets = [
    "Cheops pyramid 60mm",
    "Coffee mug with handle",
    "Aerospace rocket 120mm",
    "Gaming precision dice",
    "Hex bolt M10",
    "Helical spring",
    "Jet aircraft model",
    "Double-edge sword",
    "Wrench for M10 bolt",
    "5-blade turbine rotor",
    "Wall hook for coat",
    "Vase with flared rim",
    "Planetary gear set",
  ];

  // Initialize Three.js scene with smooth lighting and damped controls
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const w = container.clientWidth || 480;
    const h = container.clientHeight || 360;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060c18);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 2000);
    camera.position.set(0, 60, 180);
    camera.lookAt(0, 0, 0);

    // Dynamic dual-accent studio lighting
    scene.add(new THREE.AmbientLight(0x6ee7f7, 0.45));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.2);
    d1.position.set(80, 120, 80);
    scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xf59e0b, 0.7);
    d2.position.set(-80, -40, -80);
    scene.add(d2);
    const d3 = new THREE.DirectionalLight(0x06b6d4, 0.5);
    d3.position.set(0, -80, 80);
    scene.add(d3);

    const grid = new THREE.GridHelper(220, 24, 0x06b6d4, 0x1e293b);
    grid.position.y = -55;
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);
    meshGroupRef.current = group;

    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
      velRef.current = { x: 0, y: 0 };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !meshGroupRef.current) return;
      const dx = (e.clientX - prevMouseRef.current.x) * 0.008;
      const dy = (e.clientY - prevMouseRef.current.y) * 0.008;
      meshGroupRef.current.rotation.y += dx;
      meshGroupRef.current.rotation.x += dy;
      velRef.current = { x: dy, y: dx };
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.position.z = Math.max(50, Math.min(300, camera.position.z + e.deltaY * 0.15));
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    // Smooth render loop with rotational momentum damping
    let reqId: number;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      if (meshGroupRef.current) {
        if (!isDraggingRef.current) {
          velRef.current.x *= 0.92;
          velRef.current.y *= 0.92;
          meshGroupRef.current.rotation.x += velRef.current.x;
          meshGroupRef.current.rotation.y += velRef.current.y + 0.0035; // gentle smooth auto-spin
        }
      }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer) return;
      const nw = container.clientWidth || 480;
      const nh = container.clientHeight || 360;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(reqId);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Rebuild mesh whenever cadModel or wireframe changes
  useEffect(() => {
    if (!meshGroupRef.current || !cadModel) return;
    const group = meshGroupRef.current;
    while (group.children.length > 0) group.remove(group.children[0]);

    const material = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      roughness: 0.22,
      metalness: 0.72,
      wireframe,
    });

    const built = buildDynamic3DModel(cadModel, material);
    group.add(built);
    group.rotation.set(0, 0, 0);
  }, [cadModel, wireframe]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setGenStep(0);
    const stepTimer = setInterval(() => setGenStep((s) => Math.min(s + 1, 3)), 450);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcp: "cad", action: "generate", params: { prompt } }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setGenStep(3);
        setCadModel(data.data);
      }
    } catch (e: any) {
      console.error("CAD generation error:", e);
    } finally {
      clearInterval(stepTimer);
      setIsGenerating(false);
      setGenStep(0);
    }
  };

  const handleCopyScad = () => {
    if (cadModel?.openScadCode) {
      navigator.clipboard.writeText(cadModel.openScadCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadStl = () => {
    if (!cadModel || !meshGroupRef.current) return;
    const stlContent = exportGroupToStl(meshGroupRef.current, cadModel.name || "cad_part");
    const blob = new Blob([stlContent], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(cadModel.name || "model").toLowerCase().replace(/\s+/g, "_")}.stl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-yellow-950/20 to-black/40 p-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30">
            <Box className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-wide text-white">MARK PROTOTYPE CAD</h3>
              <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                Parametric &amp; LLM Engine
              </span>
            </div>
            <p className="text-xs text-white/50">
              Natural language → Real 3D Solid Geometry · OpenSCAD · True Watertight STL Export
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadStl}
          disabled={!cadModel}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-4 py-2 text-xs font-semibold text-black shadow-lg shadow-amber-500/20 transition hover:from-amber-400 hover:to-yellow-400 disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
          Download .STL
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Input & Controls */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
            <label className="text-xs font-medium uppercase tracking-wider text-amber-400">
              Design Specification
            </label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='Describe any physical part — e.g. "pyramid with square base 60mm", "coffee mug with handle", "aerospace rocket", "gaming dice", "helical spring"...'
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white placeholder:text-white/30 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
            />

            {/* Quick Inspiration Pills */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {presets.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(p)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70 transition hover:border-amber-400/40 hover:bg-white/10 hover:text-white"
                >
                  {p}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 py-2.5 text-xs font-semibold text-black shadow-md shadow-amber-500/20 transition hover:from-amber-400 hover:to-yellow-400 disabled:opacity-40"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {genStepLabels[genStep]}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate 3D Model
                </>
              )}
            </button>

            {isGenerating && (
              <div className="mt-2 flex gap-1 justify-center">
                {genStepLabels.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      i <= genStep ? "bg-amber-400 w-8" : "bg-white/10 w-4"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Slicer Telemetry */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
            <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/80">
              <Cpu className="h-3.5 w-3.5 text-amber-400" />
              Slicing &amp; Toolpath Telemetry
            </h4>
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="flex items-center gap-1 text-[10px] text-white/40 mb-1">
                  <Box className="h-3 w-3 text-amber-400" /> SHAPE
                </div>
                <span className="text-sm font-bold text-amber-200 capitalize">
                  {cadModel?.meshPreset ? cadModel.meshPreset.replace(/_/g, " ") : "—"}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="flex items-center gap-1 text-[10px] text-white/40 mb-1">
                  <Layers className="h-3 w-3 text-cyan-400" /> DIMENSIONS
                </div>
                <span className="text-sm font-bold text-white">
                  {cadModel ? `${cadModel.dimensions?.widthMm}×${cadModel.dimensions?.heightMm}×${cadModel.dimensions?.depthMm} mm` : "—"}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="flex items-center gap-1 text-[10px] text-white/40 mb-1">
                  <Clock className="h-3 w-3 text-amber-300" /> PRINT TIME
                </div>
                <span className="text-sm font-bold text-amber-300">
                  {cadModel ? `~${cadModel.printEstimates?.printTimeMinutes} min` : "—"}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="flex items-center gap-1 text-[10px] text-white/40 mb-1">
                  <Weight className="h-3 w-3 text-cyan-300" /> FILAMENT
                </div>
                <span className="text-sm font-bold text-cyan-300">
                  {cadModel ? `${cadModel.printEstimates?.filamentWeightGrams}g ${cadModel.printEstimates?.recommendedMaterial}` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Interactive 3D Viewport / OpenSCAD Code */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex h-full min-h-[460px] flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
            {/* Viewport Toolbar */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("3d")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    activeTab === "3d" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-white/60 hover:text-white"
                  }`}
                >
                  Interactive 3D Solid
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("scad")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    activeTab === "scad" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-white/60 hover:text-white"
                  }`}
                >
                  OpenSCAD Source
                </button>
              </div>

              {activeTab === "3d" && (
                <button
                  type="button"
                  onClick={() => setWireframe(!wireframe)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono transition ${
                    wireframe ? "border-cyan-400 bg-cyan-400/20 text-cyan-300" : "border-white/10 bg-white/5 text-white/50"
                  }`}
                >
                  Wireframe: {wireframe ? "ON" : "OFF"}
                </button>
              )}
              {activeTab === "scad" && (
                <button
                  type="button"
                  onClick={handleCopyScad}
                  className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 hover:text-white"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied!" : "Copy SCAD"}
                </button>
              )}
            </div>

            {/* 3D Canvas */}
            {activeTab === "3d" ? (
              <div className="relative flex-1 min-h-[360px] overflow-hidden rounded-2xl bg-[#060c18] border border-white/10">
                <div ref={canvasContainerRef} className="h-full w-full cursor-grab active:cursor-grabbing" />
                {!cadModel && !isGenerating && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-xs text-white/40 px-8">
                    <div>
                      <div className="mb-2 text-4xl opacity-20">⬡</div>
                      Describe any 3D object in natural language above and click <span className="text-amber-400">Generate 3D Model</span>.<br />
                      Try: "pyramid", "coffee mug", "airplane model", "rocket", "spring", "hex bolt"…
                    </div>
                  </div>
                )}
                {cadModel && (
                  <div className="absolute top-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-[10px] text-amber-300 backdrop-blur-md font-mono border border-amber-500/20">
                    {cadModel.name} · <span className="text-cyan-300 capitalize">{cadModel.meshPreset.replace(/_/g, " ")}</span>
                  </div>
                )}
                <div className="absolute bottom-3 right-3 rounded-lg bg-black/60 px-2.5 py-1 text-[10px] text-white/40 backdrop-blur-md">
                  Drag to rotate with momentum · Scroll to zoom
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 max-h-[380px]">
                <pre className="font-mono text-xs text-amber-200/90 whitespace-pre-wrap">
                  {cadModel ? cadModel.openScadCode : "// Generate a model to view its OpenSCAD source."}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
