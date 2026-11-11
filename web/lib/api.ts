// Browser-side types and helpers for the /api routes.

export type Evidence = { n: number; chunkId: string; docId: string; path: string; text: string };

export type PersonResult = {
  id: string;
  name: string;
  title: string | null;
  matchedSkills: { name: string; level: string | null }[];
  paths: string[];
  /** The same paths as data: each project the person worked on and the matching skills it used. */
  links: { project: string; skills: string[] }[];
  evidence: Evidence[];
};

export type SearchResults = { confidence: "ok" | "none"; people: PersonResult[] };

export type PersonProfile = {
  id: string;
  name: string;
  title: string | null;
  aliases: string[] | null;
  skills: { name: string; level: string | null }[];
  roles: { org: string; title: string; start: string | null; end: string | null }[];
  education: { school: string; degree: string; field: string }[];
  projects: { id: string; name: string; scope: string; role: string | null; collaborators: { id: string; name: string }[] }[];
  possibleSame: { id: string; name: string }[];
  evidence: { chunkId: string; docId: string; path: string; text: string }[];
};

/** The landing page's graph: organisation projects, the people on them, and the skills they used. */
export type GraphData = {
  people: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  skills: { id: string; name: string }[];
  /** [person id, project id] */
  workedOn: [string, string][];
  /** [project id, skill id] */
  used: [string, string][];
  /** [person id, skill id] */
  has: [string, string][];
};

export type JobStatus = {
  jobId: string;
  running: boolean;
  counts: Record<string, number>;
  documents: { id: string | null; path: string; status: string; error: string | null }[];
};

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.code ?? "error", data?.message ?? `Request failed (${response.status}).`);
  }
  return data as T;
}

/** Opens the stored source file for a document in a new tab, or explains why it cannot. */
export async function openSource(docId: string): Promise<string | null> {
  try {
    const { url } = await api<{ url: string }>(`documents/${docId}/url`);
    window.open(url, "_blank", "noopener");
    return null;
  } catch (cause) {
    return cause instanceof ApiError ? cause.message : "Could not open the source file.";
  }
}

export const FAILURE_REASONS: Record<string, string> = {
  no_text: "No readable text (a scanned PDF?)",
  type_mismatch: "The file is not the type its name says",
  unreadable_pdf: "The PDF could not be opened",
  not_utf8: "The text file is not UTF-8",
  unsupported_type: "Unsupported file type",
  too_large: "Larger than 10 MB",
  fetch_failed: "The upload did not arrive",
  refused: "The model declined to read this document",
  budget_exceeded: "Today's processing budget is used up",
  internal_error: "Something went wrong while processing",
};
