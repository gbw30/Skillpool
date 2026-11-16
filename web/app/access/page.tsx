"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/icons";

/** Where to go after the code is accepted: only a path on this site, never another address. */
function destination(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  try {
    // Parsed the way the browser will parse it, so "//host", "/\host" and "/<tab>/host" are all caught.
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

export default function AccessPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (response.ok) {
        window.location.assign(destination()); // a full load, so the server sees the new cookie
        return;
      }
      const body = await response.json().catch(() => null);
      setError(typeof body?.message === "string" ? body.message : "That did not work. Try again.");
    } catch {
      setError("SkillPool could not be reached. Check your connection and try again.");
    }
    setChecking(false);
  }

  return (
    <div className="page">
      <div className="mx-auto max-w-md pt-8 text-center sm:pt-20">
        <p className="label">A private demo</p>
        <h1 className="mt-4">Enter the <em>access code</em></h1>
        <p className="mt-4 text-muted">Use the code you were given to open SkillPool.</p>
        <form className="ruled mt-10 text-left" onSubmit={submit}>
          <label className="label mb-1.5 block" htmlFor="access-code">Access code</label>
          <input
            id="access-code" className="input h-14 border-accent/55 px-5 text-base" type="password" autoComplete="current-password" autoFocus required
            value={code} disabled={checking} aria-invalid={error ? true : undefined} aria-describedby={error ? "access-error" : undefined}
            onChange={(event) => setCode(event.target.value)}
          />
          {error && (
            <p id="access-error" className="mt-3 flex items-start gap-2 text-sm text-danger" role="alert">
              <Alert className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <button className="btn mt-4 h-14 w-full" type="submit" disabled={checking || !code}>
            {checking ? "Checking…" : "Open SkillPool"}
          </button>
        </form>
      </div>
    </div>
  );
}
