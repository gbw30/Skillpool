"use client";

import { Exit } from "@/components/icons";

/**
 * Ends this browser's access, for a shared or borrowed computer. The access page comes next.
 * An icon on phones, where the header has no room for the words; hidden below 360px, where it
 * has no room at all.
 */
export function SignOut() {
  async function leave() {
    await fetch("/api/access", { method: "DELETE" }).catch(() => null);
    window.location.replace("/access"); // a full load, so pages kept in memory for this visitor are dropped
  }
  return (
    <button
      className="flex cursor-pointer items-center whitespace-nowrap text-[0.8125rem] text-ink/80 hover:text-ink max-[359px]:hidden"
      type="button" aria-label="Sign out" title="Sign out" onClick={leave}
    >
      <Exit className="text-base sm:hidden" />
      <span className="max-sm:hidden">Sign out</span>
    </button>
  );
}
