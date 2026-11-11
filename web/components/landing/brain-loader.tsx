"use client";

// The loading screen: a small flat drawing of the hero's brain that appears point by point while
// the 3D scene, the graph and the fonts load behind it. When they are ready it fades out over the
// real brain, which starts where this drawing stands (graph-canvas.tsx) and travels to its place.
import { motion, useIsPresent } from "motion/react";
import type { CSSProperties, RefObject } from "react";
import { brainSketch } from "@/lib/brain";

const SKETCH = brainSketch();
const TINT = ["var(--color-person)", "var(--color-project)", "var(--color-skill)"];

/** `sketchRef`: the drawing itself, which the 3D scene measures to know where to start. */
export function BrainLoader({ sketchRef }: { sketchRef: RefObject<HTMLDivElement | null> }) {
  const present = useIsPresent();
  return (
    <motion.div
      className={`loader fixed inset-0 z-50 grid place-items-center bg-bg ${present ? "" : "pointer-events-none"}`}
      role="status" exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}
    >
      <div className="flex flex-col items-center gap-7">
        <div
          ref={sketchRef} aria-hidden className="sketch-wait relative w-[min(56vw,15rem)]"
          style={{ aspectRatio: `${SKETCH.width} / ${SKETCH.height}` }}
        >
          {/* One layer per band, so each can fade and grow on its own while the page's scripts are busy. */}
          {SKETCH.bands.map((band, k) => (
            <svg
              key={k} className="sketch-band absolute inset-0 size-full overflow-visible"
              style={{ "--i": k, transformOrigin: `${SKETCH.origin.x}% ${SKETCH.origin.y}%` } as CSSProperties}
              viewBox={`0 0 ${SKETCH.width} ${SKETCH.height}`}
            >
              {band.links.map((link, i) => (
                <line key={i} x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2} stroke="var(--color-person)" strokeOpacity={link.alpha} strokeWidth={0.35} />
              ))}
              {band.nodes.map((node, i) => (
                <circle key={i} cx={node.x} cy={node.y} r={node.r} fill={TINT[node.kind]} fillOpacity={node.alpha} />
              ))}
            </svg>
          ))}
        </div>
        <p className="label sketch-label">Reading the index</p>
      </div>
    </motion.div>
  );
}
