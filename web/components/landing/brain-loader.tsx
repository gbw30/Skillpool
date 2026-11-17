"use client";

// The loading screen: a small flat drawing of the hero's brain that appears point by point while
// the 3D scene, the graph and the fonts load behind it. When they are ready it fades out over the
// real brain, which starts where this drawing stands (graph-canvas.tsx) and travels to its place.
import { motion, useIsPresent } from "motion/react";
import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { brainSketch } from "@/lib/brain";

const SKETCH = brainSketch();
const TINT = ["var(--color-person)", "var(--color-project)", "var(--color-skill)"];

/** `sketchRef`: the drawing itself, which the 3D scene measures to know where to start.
 *  `slow`: the graph is taking long, most likely because the service is waking up. */
export function BrainLoader({ sketchRef, slow }: { sketchRef: RefObject<HTMLDivElement | null>; slow: boolean }) {
  const present = useIsPresent();
  const screen = useRef<HTMLDivElement>(null);
  // The stylesheet hides this screen after 10 s in case no script runs. A running script decides.
  useEffect(() => { screen.current?.setAttribute("data-live", ""); }, []);
  return (
    <motion.div
      ref={screen}
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
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="label sketch-label">{slow ? "Waking the index" : "Reading the index"}</p>
          {slow && <p className="max-w-64 text-sm text-muted">The free server sleeps when idle, so this can take up to a minute.</p>}
        </div>
      </div>
    </motion.div>
  );
}
