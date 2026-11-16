"use client";

// The site's background: a faint wall of resumes and reports, and a soft light that passes over
// it and shows, on each page it touches, the one line that matched. The light follows the pointer
// on a spring; left alone, or on a touch screen, it wanders. It never moves under reduced motion.
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

const LIGHT = 460; // px across
const RESUME = [62, 54, 62, 40, 58, 30], REPORT = [60, 52, 60, 46, 56, 28]; // line lengths
const MATCH = 2; // which line of each page is the one that matched

/** One repeating tile: a resume (photo, name, lines) and a report (title, lines). */
function Pages({ id, lit }: { id: string; lit: boolean }) {
  const line = (x: number, y: number, width: number, i: number) => (
    <rect key={`${x}-${y}`} x={x} y={y} width={width} height="3" rx="1.5" fill={lit && i === MATCH ? "var(--color-accent)" : undefined} />
  );
  return (
    <svg className={`size-full ${lit ? "text-muted" : "text-line"}`} aria-hidden>
      <defs>
        <pattern id={id} width="232" height="264" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
          <g fill="none" stroke="currentColor">
            <rect x="14.5" y="18.5" width="84" height="108" rx="5" />
            <rect x="132.5" y="150.5" width="84" height="96" rx="5" />
          </g>
          <g fill="currentColor">
            <circle cx="31" cy="36" r="7" />
            <rect x="45" y="30" width="34" height="4" rx="2" />
            <rect x="45" y="38" width="22" height="3" rx="1.5" />
            {RESUME.map((width, i) => line(25, 56 + i * 10, width, i))}
            <rect x="143" y="162" width="44" height="5" rx="2.5" />
            {REPORT.map((width, i) => line(143, 180 + i * 10, width, i))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function Backdrop() {
  const still = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 50, damping: 16 });
  const y = useSpring(useMotionValue(0), { stiffness: 50, damping: 16 });
  // The light is a small box that moves; the pages inside it move the other way by the same
  // amount, so they stay lined up with the faint ones. Only transforms change, which is cheap.
  const box = useMotionTemplate`translate(${useTransform(x, (v) => v - LIGHT / 2)}px, ${useTransform(y, (v) => v - LIGHT / 2)}px)`;
  const inside = useMotionTemplate`translate(${useTransform(x, (v) => LIGHT / 2 - v)}px, ${useTransform(y, (v) => LIGHT / 2 - v)}px)`;

  useEffect(() => {
    x.jump(innerWidth * 0.72);
    y.jump(innerHeight * 0.3);
    if (still) return;
    let moved = 0;
    const follow = (event: PointerEvent) => {
      moved = performance.now();
      x.set(event.clientX);
      y.set(event.clientY);
    };
    // With no pointer to follow for a while, look somewhere else.
    const wander = setInterval(() => {
      if (performance.now() - moved < 4000 || document.hidden) return;
      x.set(innerWidth * (0.15 + Math.random() * 0.7));
      y.set(innerHeight * (0.15 + Math.random() * 0.7));
    }, 4500);
    addEventListener("pointermove", follow);
    return () => {
      removeEventListener("pointermove", follow);
      clearInterval(wander);
    };
  }, [still, x, y]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 opacity-[0.13]"><Pages id="pages" lit={false} /></div>
      <motion.div
        className="absolute left-0 top-0 overflow-hidden opacity-30 [mask-image:radial-gradient(closest-side,black,transparent)]"
        style={{ width: LIGHT, height: LIGHT, transform: box }}
      >
        <motion.div className="absolute left-0 top-0 h-screen w-screen" style={{ transform: inside }}>
          <Pages id="pages-lit" lit />
        </motion.div>
      </motion.div>
    </div>
  );
}
