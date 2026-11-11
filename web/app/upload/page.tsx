"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError, FAILURE_REASONS, type JobStatus } from "@/lib/api";

// Mirrors the service's limits (service/skillpool/config.py); the service enforces them again.
const MAX_FILES = 200;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = [".pdf", ".txt", ".md"];

type Picked = { file: File; path: string; problem?: string };
type Upload = { index: number; path: string; url: string; fields: Record<string, string> };
type Phase = "pick" | "uploading";

function check(files: File[]): Picked[] {
  let accepted = 0;
  return files.map((file) => {
    const path = file.webkitRelativePath || file.name;
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    let problem: string | undefined;
    if (!ALLOWED.includes(ext)) problem = "Not a PDF, TXT, or MD file";
    else if (file.size === 0) problem = "Empty file";
    else if (file.size > MAX_BYTES) problem = "Larger than 10 MB";
    else if (++accepted > MAX_FILES) problem = `Over the limit of ${MAX_FILES} files per batch`;
    return { file, path, problem };
  });
}

async function send(upload: Upload, file: File) {
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", file); // storage requires the file to be the last field
  const response = await fetch(upload.url, { method: "POST", body: form });
  if (!response.ok) throw new Error(`storage answered ${response.status}`);
}

function Upload() {
  // The batch id lives in the address bar, so a reload keeps showing its status.
  const jobId = useSearchParams().get("job");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [sent, setSent] = useState(0);
  const [notSent, setNotSent] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [latest, setJob] = useState<JobStatus | null>(null);
  const job = latest?.jobId === jobId ? latest : null; // never show another batch's status

  useEffect(() => {
    if (!jobId) return;
    let timer: ReturnType<typeof setTimeout>;
    let current = true;
    const poll = async () => {
      try {
        const status = await api<JobStatus>(`jobs/${jobId}`);
        if (!current) return;
        setJob(status);
        if (status.running) timer = setTimeout(poll, 2000);
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : "Could not read the batch status.");
      }
    };
    poll();
    return () => { current = false; clearTimeout(timer); };
  }, [jobId]);

  const ready = picked.filter((p) => !p.problem);
  const skipped = picked.filter((p) => p.problem);

  async function start() {
    setError("");
    setPhase("uploading");
    setSent(0);
    const headers = { "content-type": "application/json", "x-access-code": code };
    try {
      const session = await api<{ jobId: string; uploads: Upload[] }>("upload/session", {
        method: "POST", headers,
        body: JSON.stringify({ files: ready.map((p) => ({ path: p.path, size: p.file.size })) }),
      });
      const failed: string[] = [];
      const queue = [...session.uploads];
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let upload = queue.shift(); upload; upload = queue.shift()) {
          try {
            await send(upload, ready[upload.index].file);
            setSent((n) => n + 1);
          } catch {
            failed.push(upload.path);
          }
        }
      }));
      setNotSent(failed);
      if (failed.length === session.uploads.length) throw new Error("None of the files reached storage. Nothing was processed.");
      await api("ingest/start", { method: "POST", headers, body: JSON.stringify({ jobId: session.jobId }) });
      setPhase("pick");
      router.replace(`/upload?job=${session.jobId}`);
    } catch (cause) {
      setError(cause instanceof ApiError || cause instanceof Error ? cause.message : "Upload failed.");
      setPhase("pick");
    }
  }

  const counts = job?.counts ?? {};
  const total = job?.documents.length ?? 0;
  const stalled = job && !job.running && (counts.processing ?? 0) + (counts.queued ?? 0) > 0;

  return (
    <>
      <h1>Add documents</h1>
      <p className="muted">PDF, TXT, and MD files. Up to 10 MB each and {MAX_FILES} per batch.</p>
      {error && <p className="notice" role="alert">{error}</p>}

      {!jobId && (
        <section className="card">
          <label htmlFor="code">Access code</label>
          <input id="code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />

          <div className="file-inputs">
            <input
              id="folder" type="file" multiple {...({ webkitdirectory: "" } as object)}
              onChange={(e) => setPicked(check(Array.from(e.target.files ?? [])))}
            />
            <label className="button secondary" htmlFor="folder">Choose a folder</label>
            <input
              id="files" type="file" multiple accept={ALLOWED.join(",")}
              onChange={(e) => setPicked(check(Array.from(e.target.files ?? [])))}
            />
            <label className="button secondary" htmlFor="files">Choose files</label>
          </div>

          <p role="status" aria-live="polite">
            {phase === "uploading" ? <span className="pulse">Uploading {sent} of {ready.length}…</span>
              : picked.length === 0 ? <span className="muted">Nothing chosen yet.</span>
              : `${ready.length} ${ready.length === 1 ? "file" : "files"} ready${skipped.length ? `, ${skipped.length} skipped` : ""}.`}
          </p>
          {skipped.length > 0 && (
            <details>
              <summary>Skipped files</summary>
              <ul className="plain small">
                {skipped.slice(0, 50).map((p) => <li key={p.path}>{p.path}: {p.problem}</li>)}
              </ul>
            </details>
          )}
          <p style={{ marginTop: 16 }}>
            <button type="button" onClick={start} disabled={phase === "uploading" || ready.length === 0 || !code}>
              Upload and process
            </button>
          </p>
        </section>
      )}

      {jobId && (
        <section className="card">
          <h2>Batch status</h2>
          <p className={job?.running ? "pulse" : undefined} role="status" aria-live="polite">
            {!job ? "Loading…"
              : job.running ? `Processing: ${counts.ingested ?? 0} of ${total} done.`
              : stalled ? "Processing stopped before finishing. Upload the same files again to resume; finished ones are skipped."
              : `Finished: ${counts.ingested ?? 0} searchable, ${counts.failed ?? 0} failed.`}
          </p>
          {notSent.length > 0 && (
            <p className="notice">{notSent.length} {notSent.length === 1 ? "file" : "files"} did not reach storage: {notSent.slice(0, 5).join(", ")}</p>
          )}
          {job && total === 0 && !job.running && <p className="muted">No documents are recorded for this batch.</p>}
          {job && total > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">File</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
                <tbody>
                  {job.documents.map((d, i) => (
                    <tr key={d.id ?? `${d.path}-${i}`}>
                      <td className="path-cell">{d.path}</td>
                      <td><span className={`pill${d.status === "failed" ? " failed" : ""}`}>{d.status}</span></td>
                      <td>{d.error ? FAILURE_REASONS[d.error] ?? d.error : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginTop: 16 }}><Link href="/upload">Add another batch</Link></p>
        </section>
      )}
    </>
  );
}

export default function UploadPage() {
  return (
    <div className="page">
      <Suspense fallback={<p className="status pulse" role="status">Loading…</p>}>
        <Upload />
      </Suspense>
    </div>
  );
}
