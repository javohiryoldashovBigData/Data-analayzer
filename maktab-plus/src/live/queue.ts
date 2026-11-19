// Offline-safe "after lesson" saves.
// Weak classroom Wi-Fi is normal, so a save that cannot reach the server is
// kept on this device and sent again later. Each save carries a client_op_id;
// the database answers a repeated id with the first result (api.finish_lesson),
// so sending twice never creates duplicate grades or attendance.
import { api, ApiError } from "./api";

const KEY = "maktab.live.queue";
export type QueuedSave = { card_id: string; payload: Record<string, unknown> & { client_op_id: string }; label: string; at: number };

function read(): QueuedSave[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function write(q: QueuedSave[]) {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* storage full or private mode */ }
}
export const pending = () => read();

export function newOpId(): string {
  return crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));
}

// "sent" = saved on the server now; "queued" = no connection, kept on the device.
export async function saveLesson(item: Omit<QueuedSave, "at">): Promise<"sent" | "queued"> {
  try {
    await api("/teacher/finish", { method: "POST", body: JSON.stringify({ card_id: item.card_id, payload: item.payload }) });
    return "sent";
  } catch (e) {
    if (e instanceof ApiError) throw e;               // the server answered "no": show it, don't queue
    write([...read().filter((x) => x.payload.client_op_id !== item.payload.client_op_id), { ...item, at: Date.now() }]);
    return "queued";
  }
}

// Send everything waiting. Returns how many are still waiting.
// Only one flush runs at a time (reconnect + screen reload can both ask).
let running: Promise<number> | null = null;
export function flush(): Promise<number> {
  running ??= doFlush().finally(() => { running = null; });
  return running;
}
async function doFlush(): Promise<number> {
  for (const item of read()) {
    try {
      await api("/teacher/finish", { method: "POST", body: JSON.stringify({ card_id: item.card_id, payload: item.payload }) });
      write(read().filter((x) => x.payload.client_op_id !== item.payload.client_op_id));
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401 && e.status < 500) {
        // the server refused it for good (e.g. not your lesson): drop it so it can't block the rest
        write(read().filter((x) => x.payload.client_op_id !== item.payload.client_op_id));
      } else break;                                    // still offline / logged out: try again later
    }
  }
  return read().length;
}
