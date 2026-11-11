"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type DragEvent } from "react";
import { Alert, Check, Folder, Upload as UploadIcon } from "@/components/icons";
import { api, ApiError, FAILURE_REASONS, type JobStatus } from "@/lib/api";

// Mirrors the service's limits (service/skillpool/config.py); the service enforces them again.
const MAX_FILES = 200;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = [".pdf", ".txt", ".md"];
const MAX_DROPPED = 2000; // stop reading a dropped folder past this; only MAX_FILES can be sent anyway

type Chosen = { file: File; path: string };
type Picked = Chosen & { problem?: string };
type Upload = { index: number; path: string; url: string; fields: Record<string, string> };
type Phase = "pick" | "uploading";
/** Where one file is on its way from the visitor's disk to being searchable. */
type State = "ready" | "skipped" | "sending" | "sent" | "unsent" | "queued" | "processing" | "ingested" | "failed";
type Tile = { key: string; path: string; state: State; detail: string };

const extension = (path: string) => path.slice(path.lastIndexOf(".")).toLowerCase();
const megabytes = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function check(files: Chosen[]): Picked[] {
  let accepted = 0;
  return files.map(({ file, path }) => {
    let problem: string | undefined;
    if (!ALLOWED.includes(extension(path))) problem = "Not a PDF, TXT, or MD file";
    else if (file.size === 0) problem = "Empty file";
    else if (file.size > MAX_BYTES) problem = "Larger than 10 MB";
    else if (++accepted > MAX_FILES) problem = `Over the limit of ${MAX_FILES} files per batch`;
    return { file, path, problem };
  });
}

const fromInput = (files: FileList | null): Chosen[] => Array.from(files ?? [], (file) => ({ file, path: file.webkitRelativePath || file.name }));

/** Every file in what was dropped, with folders opened, each under its path from the dropped item. */
async function fromDrop(entries: FileSystemEntry[]): Promise<Chosen[]> {
  const found: Chosen[] = [];
  async function open(entry: FileSystemEntry, folder: string) {
    if (found.length >= MAX_DROPPED) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      found.push({ file, path: folder + entry.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) { // a folder is read a batch at a time until a batch comes back empty
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) break;
        for (const child of batch) await open(child, `${folder}${entry.name}/`);
      }
    }
  }
  for (const entry of entries) await open(entry, "");
  return found;
}

async function send(upload: Upload, file: File) {
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", file); // storage requires the file to be the last field
  const response = await fetch(upload.url, { method: "POST", body: form });
  if (!response.ok) throw new Error(`storage answered ${response.status}`);
}

const STEPS = ["Choose", "Upload", "Process"];

function Steps({ current, done }: { current: number; done: boolean }) {
  return (
    <ol className="flex items-center gap-3 font-mono text-xs" aria-label="Progress">
      {STEPS.map((name, i) => {
        const past = i < current || done;
        return (
          <li key={name} className="flex items-center gap-3" aria-current={i === current && !done ? "step" : undefined}>
            {i > 0 && <span className={`h-px w-6 sm:w-10 ${past || i === current ? "bg-accent" : "bg-line"}`} aria-hidden />}
            <span className={`flex items-center gap-2 ${past || i === current ? "text-ink" : "text-muted"}`}>
              <span className={`grid size-5 place-items-center rounded-full border text-[10px] ${past ? "border-accent bg-accent text-accent-ink" : i === current ? "border-accent text-accent" : "border-edge"}`}>
                {past ? <Check /> : i + 1}
              </span>
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const TYPE_TONE: Record<string, string> = { ".pdf": "text-project border-project/40", ".md": "text-skill border-skill/40" };
const STATE_TEXT: Partial<Record<State, string>> = { sending: "Sending", sent: "Sent", queued: "Queued", processing: "Processing", ingested: "Searchable" };

function Mark({ state }: { state: State }) {
  if (state === "sent" || state === "ingested") return <Check className="shrink-0 text-accent" />;
  if (state === "skipped" || state === "unsent" || state === "failed") return <Alert className="shrink-0 text-danger" />;
  if (state === "sending" || state === "processing") return <span className="pulse size-2 shrink-0 rounded-full bg-project" />;
  if (state === "queued") return <span className="size-2 shrink-0 rounded-full border border-edge" />;
  return null;
}

/** The files as tiles, grouped by folder: the same picture before, during and after the upload. */
function Files({ tiles }: { tiles: Tile[] }) {
  const still = useReducedMotion();
  const folders = new Map<string, Tile[]>();
  for (const tile of tiles) {
    const folder = tile.path.includes("/") ? tile.path.slice(0, tile.path.lastIndexOf("/")) : "";
    folders.set(folder, [...(folders.get(folder) ?? []), tile]);
  }
  let order = 0;
  return (
    <div className="grid grid-cols-1 gap-5">
      {[...folders].map(([folder, list]) => (
        <section key={folder} aria-label={folder || "Files outside a folder"}>
          <h3 className="flex items-center gap-2 font-mono text-xs text-muted">
            <Folder className="text-sm" /> <span className="min-w-0 truncate">{folder || "No folder"}</span>
            <span className="rounded-full bg-raised px-1.5">{list.length}</span>
          </h3>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((tile) => {
              const bad = tile.state === "skipped" || tile.state === "unsent" || tile.state === "failed";
              const delay = Math.min(order++, 24) * 0.02; // the first tiles arrive in sequence; a long list does not crawl in
              return (
                <motion.li
                  key={tile.key} className={`flex items-center gap-3 rounded-md border bg-surface px-3 py-2 ${bad ? "border-danger/50" : "border-line"}`}
                  initial={still ? false : { opacity: 0, transform: "translateY(8px) scale(0.98)" }}
                  animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                  transition={{ type: "spring", duration: 0.45, bounce: 0.15, delay }}
                >
                  <span className={`w-9 shrink-0 rounded border py-0.5 text-center font-mono text-[10px] uppercase ${TYPE_TONE[extension(tile.path)] ?? "border-edge/60 text-muted"}`}>
                    {extension(tile.path).slice(1, 5) || "file"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" title={tile.path}>{tile.path.slice(tile.path.lastIndexOf("/") + 1)}</span>
                    {/* A reason for failing is shown in full: a tooltip is no use on a touch screen. */}
                    <span className={`block font-mono text-[11px] ${bad ? "wrap-anywhere text-danger" : "truncate text-muted"}`}>{tile.detail}</span>
                  </span>
                  <Mark state={tile.state} />
                </motion.li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** How the batch divides, as one bar: each part's width is its share of the files. */
function Shares({ parts }: { parts: { name: string; count: number; tone: string }[] }) {
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.filter((part) => part.count > 0).map((part) => <span key={part.name} className={part.tone} style={{ flexGrow: part.count }} />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted">
        {parts.filter((part) => part.count > 0).map((part) => (
          <li key={part.name} className="flex items-center gap-1.5"><span className={`size-2 rounded-sm ${part.tone}`} /> {part.count} {part.name}</li>
        ))}
      </ul>
    </div>
  );
}

function Upload() {
  // The batch id lives in the address bar, so a reload keeps showing its status.
  const jobId = useSearchParams().get("job");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [sent, setSent] = useState<Set<number>>(new Set());
  const [unsent, setUnsent] = useState<Set<number>>(new Set());
  const [notSent, setNotSent] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
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
  const choose = (files: Chosen[]) => { setError(""); setPicked(check(files)); };

  async function drop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    if (phase === "uploading") return;
    // The entries must be taken from the event before the first await; afterwards they are gone.
    const entries = Array.from(event.dataTransfer.items, (item) => item.webkitGetAsEntry()).filter((entry) => entry !== null);
    try {
      choose(entries.length ? await fromDrop(entries) : fromInput(event.dataTransfer.files));
    } catch {
      setError("Those files could not be read. Use the buttons to choose them instead.");
    }
  }

  async function start() {
    setError("");
    setPhase("uploading");
    setSent(new Set());
    setUnsent(new Set());
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
          const { index, path } = upload;
          try {
            await send(upload, ready[index].file);
            setSent((done) => new Set(done).add(index));
          } catch {
            failed.push(path);
            setUnsent((lost) => new Set(lost).add(index));
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
  const finished = (counts.ingested ?? 0) + (counts.failed ?? 0);
  const stalled = job && !job.running && (counts.processing ?? 0) + (counts.queued ?? 0) > 0;
  const uploading = phase === "uploading";

  const chosenTiles: Tile[] = [
    ...ready.map((p, i): Tile => ({
      key: p.path, path: p.path,
      state: !uploading ? "ready" : sent.has(i) ? "sent" : unsent.has(i) ? "unsent" : "sending",
      detail: uploading && unsent.has(i) ? "Did not reach storage" : uploading ? `${STATE_TEXT[sent.has(i) ? "sent" : "sending"]} · ${megabytes(p.file.size)}` : megabytes(p.file.size),
    })),
    ...skipped.slice(0, 60).map((p): Tile => ({ key: `skipped:${p.path}`, path: p.path, state: "skipped", detail: `Skipped: ${p.problem}` })),
  ];
  const jobTiles: Tile[] = (job?.documents ?? []).map((d, i) => {
    const state = (["queued", "processing", "ingested", "failed"].includes(d.status) ? d.status : "queued") as State;
    return { key: d.id ?? `${d.path}-${i}`, path: d.path, state, detail: d.error ? `Failed: ${FAILURE_REASONS[d.error] ?? d.error}` : STATE_TEXT[state] ?? d.status };
  });
  const byType = (ext: string) => ready.filter((p) => extension(p.path) === ext).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Add documents</h1>
          <p className="mt-2 text-muted">Resumes and project documents as PDF, TXT or MD. Up to 10 MB each, {MAX_FILES} per batch.</p>
        </div>
        <Steps current={jobId ? 2 : uploading ? 1 : 0} done={Boolean(job && !job.running && !stalled)} />
      </div>
      {error && <p className="panel mt-6 flex items-start gap-2 border-danger/50 p-4 text-danger" role="alert"><Alert className="mt-1 shrink-0" /> {error}</p>}

      {!jobId && (
        <>
          <section
            className={`mt-6 rounded-[10px] border border-dashed p-8 text-center transition-colors duration-(--spring-time) ease-(--spring) sm:p-12 ${over ? "border-accent bg-accent/10" : "border-edge bg-surface/60"}`}
            onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
            aria-label="Choose documents"
          >
            <UploadIcon className={`mx-auto text-3xl ${over ? "text-accent" : "text-muted"}`} />
            <p className="mt-3 text-lg font-medium">{over ? "Drop to add them" : "Drop a folder or files here"}</p>
            <p className="mt-1 text-sm text-muted">or choose them from your computer. Nothing is sent until you press Upload.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <input
                id="folder" className="peer/folder sr-only" type="file" multiple disabled={uploading} {...({ webkitdirectory: "" } as object)}
                onChange={(event) => choose(fromInput(event.target.files))}
              />
              <label className="btn btn-secondary peer-focus-visible/folder:outline-2 peer-focus-visible/folder:outline-offset-2 peer-focus-visible/folder:outline-accent" htmlFor="folder">
                <Folder /> Choose a folder
              </label>
              <input
                id="files" className="peer/files sr-only" type="file" multiple disabled={uploading} accept={ALLOWED.join(",")}
                onChange={(event) => choose(fromInput(event.target.files))}
              />
              <label className="btn btn-secondary peer-focus-visible/files:outline-2 peer-focus-visible/files:outline-offset-2 peer-focus-visible/files:outline-accent" htmlFor="files">
                Choose files
              </label>
            </div>
          </section>

          <p className="sr-only" role="status" aria-live="polite">
            {uploading ? `Uploading ${sent.size} of ${ready.length}` : picked.length === 0 ? "Nothing chosen yet." : `${ready.length} files ready, ${skipped.length} skipped.`}
          </p>

          {picked.length > 0 && (
            <section className="panel mt-6 p-4 sm:p-5" aria-labelledby="batch-title">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="batch-title">Your batch</h2>
                <p className="font-mono text-xs text-muted">
                  {ready.length} ready · {megabytes(ready.reduce((sum, p) => sum + p.file.size, 0))}
                  {skipped.length > 0 && <span className="text-danger"> · {skipped.length} skipped</span>}
                </p>
              </div>
              <div className="mt-3">
                <Shares parts={[
                  { name: "PDF", count: byType(".pdf"), tone: "bg-project" }, { name: "MD", count: byType(".md"), tone: "bg-skill" },
                  { name: "TXT", count: byType(".txt"), tone: "bg-muted" }, { name: "skipped", count: skipped.length, tone: "bg-danger" },
                ]} />
              </div>
              {uploading && (
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Upload" aria-valuemin={0} aria-valuemax={ready.length} aria-valuenow={sent.size + unsent.size}>
                  <motion.div className="h-full origin-left bg-accent" initial={false} animate={{ transform: `scaleX(${(sent.size + unsent.size) / Math.max(ready.length, 1)})` }} transition={{ type: "spring", duration: 0.5, bounce: 0 }} />
                </div>
              )}
              <div className="mt-5"><Files tiles={chosenTiles} /></div>
              {skipped.length > 60 && <p className="mt-3 text-sm text-muted">And {skipped.length - 60} more skipped files.</p>}

              <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                <div className="min-w-0 flex-1 sm:max-w-xs">
                  <label className="label mb-1.5 block" htmlFor="code">Access code</label>
                  <input id="code" className="input" type="password" autoComplete="off" value={code} disabled={uploading} onChange={(event) => setCode(event.target.value)} />
                </div>
                <button className="btn" type="button" onClick={start} disabled={uploading || ready.length === 0 || !code}>
                  <UploadIcon /> {uploading ? `Uploading ${sent.size + unsent.size} of ${ready.length}` : `Upload ${ready.length} ${ready.length === 1 ? "file" : "files"}`}
                </button>
                {!uploading && ready.length > 0 && !code && <p className="basis-full text-sm text-muted">Enter the access code to upload.</p>}
              </div>
            </section>
          )}
        </>
      )}

      {jobId && (
        <section className="panel mt-6 p-4 sm:p-5" aria-labelledby="status-title">
          <h2 id="status-title">Batch status</h2>
          <p className={`mt-1 text-sm text-muted${job?.running ? " pulse" : ""}`} role="status" aria-live="polite">
            {!job ? "Loading…"
              : job.running ? `Processing: ${finished} of ${total} done.`
              : stalled ? "Processing stopped before finishing. Upload the same files again to resume; finished ones are skipped."
              : `Finished: ${counts.ingested ?? 0} searchable, ${counts.failed ?? 0} failed.`}
          </p>
          {job && total > 0 && (
            <>
              {job.running && (
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Processing" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished}>
                  <motion.div className="h-full origin-left bg-accent" initial={false} animate={{ transform: `scaleX(${finished / total})` }} transition={{ type: "spring", duration: 0.5, bounce: 0 }} />
                </div>
              )}
              <div className="mt-4">
                <Shares parts={[
                  { name: "searchable", count: counts.ingested ?? 0, tone: "bg-accent" }, { name: "processing", count: counts.processing ?? 0, tone: "bg-project" },
                  { name: "queued", count: counts.queued ?? 0, tone: "bg-edge" }, { name: "failed", count: counts.failed ?? 0, tone: "bg-danger" },
                ]} />
              </div>
            </>
          )}
          {notSent.length > 0 && (
            <p className="mt-4 text-sm text-danger">{notSent.length} {notSent.length === 1 ? "file" : "files"} did not reach storage: {notSent.slice(0, 5).join(", ")}</p>
          )}
          {job && total === 0 && !job.running && <p className="mt-4 text-muted">No documents are recorded for this batch.</p>}
          {jobTiles.length > 0 && <div className="mt-5"><Files tiles={jobTiles} /></div>}
          <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
            <Link href="/upload">Add another batch</Link>
            {job && !job.running && (counts.ingested ?? 0) > 0 && <Link href="/search">Search these documents</Link>}
          </p>
        </section>
      )}
    </>
  );
}

export default function UploadPage() {
  return (
    <div className="page">
      <Suspense fallback={<p className="pulse font-mono text-xs text-muted" role="status">Loading…</p>}>
        <Upload />
      </Suspense>
    </div>
  );
}
