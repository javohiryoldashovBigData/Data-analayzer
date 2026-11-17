import { ANTHROPIC_URL, ANTHROPIC_VERSION } from "./config.ts";

function headers(): HeadersInit {
  return {
    "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
}

export interface BatchRequest {
  custom_id: string;             // ^[a-zA-Z0-9_-]{1,64}$
  params: Record<string, unknown>;
}

export interface Batch {
  id: string;
  processing_status: "in_progress" | "canceling" | "ended";
  results_url: string | null;
  request_counts: Record<string, number>;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ANTHROPIC_URL}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`anthropic_${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json() as T;
}

export function createBatch(requests: BatchRequest[]): Promise<Batch> {
  for (const r of requests) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(r.custom_id)) throw new Error(`bad_custom_id:${r.custom_id}`);
  }
  return call<Batch>("/messages/batches", { method: "POST", body: JSON.stringify({ requests }) });
}

export function getBatch(id: string): Promise<Batch> {
  return call<Batch>(`/messages/batches/${encodeURIComponent(id)}`);
}

export interface BatchResultLine {
  custom_id: string;
  result: {
    type: "succeeded" | "errored" | "canceled" | "expired";
    message?: {
      model: string;
      content: Array<{ type: string; text?: string }>;
      stop_reason: string;
      usage: Record<string, number>;
    };
    error?: unknown;
  };
}

/** Results are JSONL, any order — match by custom_id. */
export async function getResults(resultsUrl: string): Promise<BatchResultLine[]> {
  const res = await fetch(resultsUrl, { headers: headers() });
  if (!res.ok) throw new Error(`anthropic_results_${res.status}`);
  const text = await res.text();
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as BatchResultLine);
}
