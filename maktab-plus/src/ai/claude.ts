/**
 * Claude integration for the prototype.
 *
 * PROTOTYPE ONLY: the API key is entered in Settings and kept in this browser's storage, and calls go
 * straight from the browser. In the production version (Phase 1) these calls move to the Maktab+ server,
 * so the key is never exposed to users.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "../data/types";

export const MODEL = "claude-opus-5-5";

const LANG_NAME: Record<Lang, string> = { uz: "Uzbek (Latin script)", ru: "Russian", en: "English" };

export class AIError extends Error {
  constructor(public code: "noKey" | "refusal" | "auth" | "rate" | "network" | "parse" | "other", message?: string) {
    super(message ?? code);
  }
}

function client(apiKey: string) {
  if (!apiKey) throw new AIError("noKey");
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export function systemPrompt(lang: Lang, role: string, extra = "") {
  return [
    "You are Maktab+ AI, the assistant inside a school e-diary platform used in Uzbekistan.",
    `The current user is a ${role}. Always answer in ${LANG_NAME[lang]}.`,
    "Use only the school data you are given; never invent grades, names or attendance.",
    "Anything you say about a specific student is a suggestion for a teacher or parent to check, not a final decision.",
    "Be warm, practical and concise. Use short headings and bullet lists where they help.",
    extra,
  ].filter(Boolean).join("\n");
}

type Content = Anthropic.Beta.Messages.BetaContentBlockParam[];

function mapError(e: unknown): AIError {
  if (e instanceof AIError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AIError("auth", (e as Error).message);
  if (e instanceof Anthropic.RateLimitError) return new AIError("rate", (e as Error).message);
  if (e instanceof Anthropic.APIConnectionError) return new AIError("network", (e as Error).message);
  if (e instanceof Anthropic.APIError) return new AIError("other", (e as Error).message);
  return new AIError("other", String(e));
}

/** Streams a text answer. `onText` receives each new piece as it arrives. */
export async function streamText(opts: {
  apiKey: string;
  system: string;
  content: string | Content;
  /** earlier turns of a chat, oldest first */
  history?: { role: "user" | "assistant"; content: string }[];
  onText?: (delta: string, full: string) => void;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<string> {
  try {
    const stream = client(opts.apiKey).beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        system: opts.system,
        messages: [...(opts.history ?? []), { role: "user", content: opts.content }],
        output_config: { effort: opts.effort ?? "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal: opts.signal },
    );
    let full = "";
    stream.on("text", (delta) => { full += delta; opts.onText?.(delta, full); });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new AIError("refusal");
    return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  } catch (e) {
    throw mapError(e);
  }
}

/** Asks for JSON matching `schema` (structured outputs) and returns the parsed object. */
export async function askJSON<T>(opts: {
  apiKey: string;
  system: string;
  content: string | Content;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  try {
    const stream = client(opts.apiKey).beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
      output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema: opts.schema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new AIError("refusal");
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AIError("parse", text.slice(0, 200));
    }
  } catch (e) {
    throw mapError(e);
  }
}

export async function fileToImageBlock(file: File): Promise<Anthropic.Beta.Messages.BetaImageBlockParam> {
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const media = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type) ? file.type : "image/jpeg") as
    "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  return { type: "image", source: { type: "base64", media_type: media, data } };
}
