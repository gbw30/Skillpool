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
      <div className="mx-auto max-w-sm pt-8 sm:pt-16">
        <h1>Enter the access code</h1>
        <p className="mt-2 text-muted">SkillPool is a private demo. Use the code you were given to open it.</p>
        <form className="panel mt-6 p-4 sm:p-5" onSubmit={submit}>
          <label className="label mb-1.5 block" htmlFor="access-code">Access code</label>
          <input
            id="access-code" className="input" type="password" autoComplete="current-password" autoFocus required
            value={code} disabled={checking} aria-invalid={error ? true : undefined} aria-describedby={error ? "access-error" : undefined}
            onChange={(event) => setCode(event.target.value)}
          />
          {error && (
            <p id="access-error" className="mt-3 flex items-start gap-2 text-sm text-danger" role="alert">
              <Alert className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <button className="btn mt-4 w-full" type="submit" disabled={checking || !code}>
            {checking ? "Checking…" : "Open SkillPool"}
          </button>
        </form>
      </div>
    </div>
  );
}
