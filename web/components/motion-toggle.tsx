"use client";

import { setMotionPaused, useMotionPaused } from "@/lib/motion";
import { Pause, Play } from "./icons";

/** Stops what moves on its own. Hidden by CSS, not by script, when the system already asks for
 *  reduced motion: the server cannot know that, and the markup must match on both sides. */
export function MotionToggle() {
  const paused = useMotionPaused();
  const name = paused ? "Resume motion" : "Pause motion";
  return (
    <button
      type="button" aria-label={name} title={name} aria-pressed={paused} onClick={() => setMotionPaused(!paused)}
      className="grid size-7 cursor-pointer motion-reduce:hidden place-items-center rounded-[2px] border border-line text-muted sm:size-8 hover:text-ink"
    >
      {paused ? <Play /> : <Pause />}
    </button>
  );
}
