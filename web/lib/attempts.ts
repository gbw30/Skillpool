// Server only: counts wrong codes, per address and for everyone together.
import type { NextRequest } from "next/server";

/** The caller's address as the hosting platform's proxy reports it. A caller can fake it elsewhere. */
export function clientAddress(request: Pick<NextRequest, "headers">): string {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (/\d+\.\d+\.\d+\.\d+$/.test(address)) return address.slice(address.lastIndexOf(":") + 1); // IPv4, or IPv4 inside IPv6
  if (!address.includes(":")) return address;
  // One IPv6 visitor is given a whole /64 and can take a new address in it at will: count the /64.
  const [head, tail = ""] = address.toLowerCase().split("::");
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = address.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * A limit on wrong tries: `perAddress` from one address and `total` from everyone in a window.
 * The total does not depend on the address, which a caller can fake unless the platform sets it:
 * past it nobody gets through until the window passes. That lets an attacker lock the door for
 * ten minutes, which is the safe way for a private demo to fail.
 * shortcut: counted in this process's memory, so each server instance counts on its own and a
 * restart forgets. Use long random codes; move to a shared store if guessing shows up in the logs.
 */
export function attemptLimit(perAddress = 10, total = 100, windowMs = 10 * 60 * 1000) {
  const byAddress = new Map<string, number[]>();
  let everyone: number[] = [];
  const fresh = (now: number) => (at: number) => now - at < windowMs;
  return {
    /** Whether a try from this address is refused for now. Call it in the same step as `failed`. */
    locked(address: string): boolean {
      const recent = fresh(Date.now());
      everyone = everyone.filter(recent);
      return everyone.length >= total || (byAddress.get(address) ?? []).filter(recent).length >= perAddress;
    },
    failed(address: string): void {
      const now = Date.now();
      const recent = fresh(now);
      everyone.push(now);
      byAddress.set(address, [...(byAddress.get(address) ?? []).filter(recent), now]);
      // Bounded by `total` new entries per window; drop the ones that have aged out.
      for (const [key, times] of byAddress) if (!times.some(recent)) byAddress.delete(key);
    },
    passed(address: string): void {
      byAddress.delete(address);
    },
  };
}

/**
 * A request that some other page made a visitor's browser send. Browsers label every request with
 * where it came from; this site's own pages send "same-origin". Clients that send no label
 * (curl, the service's tests) are not browsers acting for a signed-in visitor, so they pass.
 */
export function crossSite(request: NextRequest): boolean {
  const from = request.headers.get("sec-fetch-site");
  return from !== null && from !== "same-origin";
}
