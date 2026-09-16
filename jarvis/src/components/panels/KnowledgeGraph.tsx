"use client";

/**
 * KnowledgeGraph — visual node-graph of memory entities.
 * SVG-based with animated connections, category colors, hover expand.
 * Each node pulses based on strength, pinned nodes glow.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface GraphEntity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  strength: number;
  pinned: boolean;
  archived: boolean;
}

interface KnowledgeGraphProps {
  entities: GraphEntity[];
  onNodeClick?: (entity: GraphEntity) => void;
  width?: number;
  height?: number;
}

const TYPE_COLORS: Record<string, { bg: string; border: string; glow: string; text: string }> = {
  person: { bg: "rgba(0, 212, 255, 0.15)", border: "#00D4FF", glow: "rgba(0, 212, 255, 0.4)", text: "#00D4FF" },
  project: { bg: "rgba(0, 255, 157, 0.15)", border: "#00FF9D", glow: "rgba(0, 255, 157, 0.4)", text: "#00FF9D" },
  concept: { bg: "rgba(255, 107, 43, 0.15)", border: "#FF6B2B", glow: "rgba(255, 107, 43, 0.4)", text: "#FF6B2B" },
  place: { bg: "rgba(191, 0, 255, 0.15)", border: "#BF00FF", glow: "rgba(191, 0, 255, 0.4)", text: "#BF00FF" },
  task: { bg: "rgba(255, 215, 0, 0.15)", border: "#FFD700", glow: "rgba(255, 215, 0, 0.4)", text: "#FFD700" },
  default: { bg: "rgba(126, 184, 212, 0.15)", border: "#7EB8D4", glow: "rgba(126, 184, 212, 0.4)", text: "#7EB8D4" },
};

function getNodeColor(type: string) {
  return TYPE_COLORS[type.toLowerCase()] || TYPE_COLORS.default;
}

/**
 * Force-directed layout — simple spring simulation to position nodes
 * without heavy deps. Runs once on mount, settles in ~50 iterations.
 */
function forceLayout(entities: GraphEntity[], width: number, height: number) {
  const nodes = entities.map((e, i) => {
    const angle = (i / entities.length) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.3;
    return {
      ...e,
      x: width / 2 + Math.cos(angle) * radius * (0.5 + Math.random() * 0.5),
      y: height / 2 + Math.sin(angle) * radius * (0.5 + Math.random() * 0.5),
      vx: 0,
      vy: 0,
    };
  });

  // Simple force simulation
  for (let iter = 0; iter < 80; iter++) {
    const alpha = 1 - iter / 80;

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (200 * alpha) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Center gravity
    for (const node of nodes) {
      node.vx += (width / 2 - node.x) * 0.01 * alpha;
      node.vy += (height / 2 - node.y) * 0.01 * alpha;
    }

    // Apply velocities with damping
    for (const node of nodes) {
      node.x += node.vx * 0.3;
      node.y += node.vy * 0.3;
      node.vx *= 0.85;
      node.vy *= 0.85;
      // Keep within bounds
      node.x = Math.max(40, Math.min(width - 40, node.x));
      node.y = Math.max(30, Math.min(height - 30, node.y));
    }
  }

  return nodes;
}

/**
 * Find connections between entities — shared type or name substring overlap.
 */
function findConnections(nodes: ReturnType<typeof forceLayout>) {
  const connections: Array<{ from: number; to: number; strength: number }> = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      // Same type = strong connection
      if (nodes[i].type === nodes[j].type) {
        connections.push({ from: i, to: j, strength: 0.6 });
        continue;
      }
      // Name overlap (one contains the other)
      const a = nodes[i].name.toLowerCase();
      const b = nodes[j].name.toLowerCase();
      if (a.includes(b) || b.includes(a)) {
        connections.push({ from: i, to: j, strength: 0.4 });
      }
    }
  }
  return connections;
}

export default function KnowledgeGraph({
  entities,
  onNodeClick,
  width = 280,
  height = 300,
}: KnowledgeGraphProps) {
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);

  const nodes = useMemo(
    () => forceLayout(entities.slice(0, 20), width, height),
    [entities, width, height]
  );

  const connections = useMemo(() => findConnections(nodes), [nodes]);

  const handleNodeClick = useCallback(
    (idx: number) => {
      setSelectedNode(idx === selectedNode ? null : idx);
      onNodeClick?.(nodes[idx]);
    },
    [nodes, selectedNode, onNodeClick]
  );

  if (entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary/40 font-rajdhani text-xs">
        No memories yet. I&apos;ll learn as we talk.
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
    >
      <defs>
        {/* Glow filter for nodes */}
        <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Pulse filter for pinned */}
        <filter id="pin-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Connections */}
      {connections.map((conn, i) => {
        const from = nodes[conn.from];
        const to = nodes[conn.to];
        const isHighlighted =
          hoveredNode === conn.from || hoveredNode === conn.to;
        return (
          <line
            key={`conn-${i}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={isHighlighted ? "#00D4FF" : "rgba(0, 212, 255, 0.12)"}
            strokeWidth={isHighlighted ? 1.5 : 0.8}
            strokeDasharray={isHighlighted ? "none" : "4 4"}
            style={{
              transition: "stroke 0.3s, stroke-width 0.3s",
              opacity: isHighlighted ? 0.8 : 0.4,
            }}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((node, i) => {
        const color = getNodeColor(node.type);
        const isHovered = hoveredNode === i;
        const isSelected = selectedNode === i;
        const nodeSize = 6 + node.strength * 8 + (node.pinned ? 3 : 0);
        const pulseScale = isHovered ? 1.3 : isSelected ? 1.2 : 1;

        return (
          <g
            key={node.id}
            onMouseEnter={() => setHoveredNode(i)}
            onMouseLeave={() => setHoveredNode(null)}
            onClick={() => handleNodeClick(i)}
            style={{ cursor: "pointer" }}
          >
            {/* Outer glow ring for pinned */}
            {node.pinned && (
              <circle
                cx={node.x}
                cy={node.y}
                r={nodeSize + 6}
                fill="none"
                stroke={color.border}
                strokeWidth={0.5}
                opacity={0.3}
                filter="url(#pin-glow)"
              >
                <animate
                  attributeName="r"
                  values={`${nodeSize + 4};${nodeSize + 8};${nodeSize + 4}`}
                  dur="3s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.2;0.5;0.2"
                  dur="3s"
                  repeatCount="indefinite"
                />
              </circle>
            )}

            {/* Node circle */}
            <circle
              cx={node.x}
              cy={node.y}
              r={nodeSize * pulseScale}
              fill={color.bg}
              stroke={color.border}
              strokeWidth={isHovered || isSelected ? 1.5 : 0.8}
              filter={node.pinned || isHovered ? "url(#node-glow)" : undefined}
              style={{
                transition: "r 0.3s, stroke-width 0.3s",
              }}
            >
              {/* Subtle breathing animation */}
              <animate
                attributeName="r"
                values={`${nodeSize * pulseScale};${nodeSize * pulseScale * 1.08};${nodeSize * pulseScale}`}
                dur={`${2 + (i % 3)}s`}
                repeatCount="indefinite"
              />
            </circle>

            {/* Label */}
            <text
              x={node.x}
              y={node.y + nodeSize + 12}
              textAnchor="middle"
              fill={color.text}
              fontSize={isHovered ? "10" : "8"}
              fontFamily="Rajdhani, sans-serif"
              fontWeight={isHovered ? "600" : "400"}
              opacity={isHovered ? 1 : 0.7}
              style={{ transition: "font-size 0.2s, opacity 0.2s" }}
            >
              {node.name.length > 18 ? node.name.slice(0, 16) + "…" : node.name}
            </text>

            {/* Type badge */}
            {isHovered && (
              <text
                x={node.x}
                y={node.y + nodeSize + 22}
                textAnchor="middle"
                fill={color.text}
                fontSize="7"
                fontFamily="Orbitron, sans-serif"
                opacity={0.5}
                letterSpacing="0.1em"
              >
                {node.type.toUpperCase()}
              </text>
            )}

            {/* Expanded tooltip on hover */}
            {isHovered && node.description && (
              <foreignObject
                x={node.x - 60}
                y={node.y - nodeSize - 40}
                width={120}
                height={30}
              >
                <div
                  style={{
                    background: "rgba(3, 10, 20, 0.9)",
                    border: `1px solid ${color.border}40`,
                    borderRadius: "4px",
                    padding: "4px 6px",
                    fontSize: "8px",
                    color: color.text,
                    fontFamily: "Rajdhani, sans-serif",
                    textAlign: "center",
                    lineHeight: "1.2",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {node.description.slice(0, 60)}
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}
    </svg>
  );
}
