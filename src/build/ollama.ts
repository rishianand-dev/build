/**
 * Minimal client for a local Ollama server (https://ollama.com), used to
 * run vision classification against a local, free, fine-tunable model
 * (qwen2.5vl:7b by default) instead of a hosted LLM API. No SDK — Ollama's
 * HTTP API is small enough that a raw `fetch` is simpler than a dependency.
 */

export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
export const DEFAULT_VISION_MODEL = "qwen2.5vl:7b";

export interface OllamaVisionRequest {
  model?: string;
  host?: string;
  prompt: string;
  imageBase64: string;
  /** JSON Schema constraining the response shape (Ollama's structured-output `format`). */
  schema: object;
  /** Abort the request after this many ms. Local CPU/GPU-constrained inference on a full
   * screenshot can genuinely take tens of seconds — measured ~30-45s for qwen2.5vl:7b on
   * a full 1440x900 crop on ordinary hardware — so this defaults well above that, not to a
   * typical hosted-API timeout. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Runs one structured-output vision call. Returns null on any failure —
 * unreachable server, timeout, non-2xx, or a response that doesn't parse
 * as JSON — so callers can treat "no local model available" as a normal,
 * expected condition rather than a build failure.
 */
export async function ollamaVisionJson<T>(req: OllamaVisionRequest): Promise<T | null> {
  const host = req.host ?? DEFAULT_OLLAMA_HOST;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: req.model ?? DEFAULT_VISION_MODEL,
        prompt: req.prompt,
        images: [req.imageBase64],
        format: req.schema,
        stream: false,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    if (!data.response) return null;
    return JSON.parse(data.response) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
