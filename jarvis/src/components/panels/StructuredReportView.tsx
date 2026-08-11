"use client";

import React from "react";
import { motion } from "framer-motion";
import type { ReportBlock, StructuredReport } from "@/services/ResearchTypes";

interface StructuredReportViewProps {
  report: StructuredReport;
  compact?: boolean;
}

/**
 * Renders a StructuredReport as glassmorphic blocks. Same shape that
 * gets sent to Notion — what you see in the panel is what you get
 * in your database. Used by the research panel's "Report" tab.
 */
export default function StructuredReportView({
  report,
  compact = false,
}: StructuredReportViewProps) {
  return (
    <div className="space-y-3">
      {report.blocks.map((block, i) => (
        <BlockView key={i} block={block} index={i} compact={compact} />
      ))}
    </div>
  );
}

function BlockView({
  block,
  index,
  compact,
}: {
  block: ReportBlock;
  index: number;
  compact: boolean;
}) {
  const baseDelay = 0.05 * index;
  const fadeIn = (delay: number) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, delay },
  });

  switch (block.type) {
    case "heading_1":
      return (
        <motion.h1
          {...fadeIn(baseDelay)}
          className="text-lg font-bold text-white border-b border-white/10 pb-1"
        >
          {block.text}
        </motion.h1>
      );
    case "heading_2":
      return (
        <motion.h2
          {...fadeIn(baseDelay)}
          className="text-sm font-semibold uppercase tracking-wider text-violet-300 mt-3"
        >
          {block.text}
        </motion.h2>
      );
    case "heading_3":
      return (
        <motion.h3
          {...fadeIn(baseDelay)}
          className="text-xs font-semibold uppercase tracking-wider text-white/70 mt-2"
        >
          {block.text}
        </motion.h3>
      );
    case "paragraph":
      return (
        <motion.p
          {...fadeIn(baseDelay)}
          className="text-sm text-white/85 leading-relaxed"
        >
          {block.text}
        </motion.p>
      );
    case "bulleted_list":
      return (
        <motion.ul
          {...fadeIn(baseDelay)}
          className="space-y-1 list-disc list-inside text-sm text-white/85"
        >
          {block.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {item}
            </li>
          ))}
        </motion.ul>
      );
    case "numbered_list":
      return (
        <motion.ol
          {...fadeIn(baseDelay)}
          className="space-y-1 list-decimal list-inside text-sm text-white/85"
        >
          {block.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {item}
            </li>
          ))}
        </motion.ol>
      );
    case "table":
      return (
        <motion.div
          {...fadeIn(baseDelay)}
          className="overflow-x-auto rounded-lg border border-white/10 bg-white/5"
        >
          <TableView rows={block.rows} compact={compact} />
        </motion.div>
      );
    case "callout":
      return (
        <motion.div
          {...fadeIn(baseDelay)}
          className="rounded-xl p-3 bg-violet-500/10 border border-violet-500/30 text-white/90 text-sm leading-relaxed flex gap-2"
        >
          <span className="text-base flex-shrink-0">{block.emoji || "💡"}</span>
          <p>{block.text}</p>
        </motion.div>
      );
    case "divider":
      return <hr className="border-white/10 my-2" />;
  }
}

function TableView({ rows, compact }: { rows: string[][]; compact: boolean }) {
  if (rows.length === 0) return null;
  const [header, ...body] = rows;
  const colCount = Math.max(header.length, ...body.map((r) => r.length));

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-white/10">
          {Array.from({ length: colCount }).map((_, i) => (
            <th
              key={i}
              className="px-3 py-2 text-left font-semibold text-violet-300 uppercase tracking-wider"
            >
              {header[i] || ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, ri) => (
          <tr
            key={ri}
            className="border-b border-white/5 hover:bg-white/5 transition-colors"
          >
            {Array.from({ length: colCount }).map((_, i) => (
              <td
                key={i}
                className="px-3 py-2 text-white/85 align-top"
              >
                {row[i] || "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
