// http_request step: generic fetch driven by config.url/method/headers/body.
// Retries live in the executor's generic wrapper (withRetry) — this file
// just throws on non-2xx or network failure so the caller can retry/fail.
export interface HttpRequestResult {
  output: any;
}

function interpolateDeep(value: any, previousOutput: unknown): any {
  if (typeof value === "string") {
    const prevStr =
      typeof previousOutput === "string"
        ? previousOutput
        : JSON.stringify(previousOutput ?? "");
    return value.replace(/\{\{\s*previous_output\s*\}\}/g, prevStr);
  }
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, previousOutput));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateDeep(v, previousOutput);
    return out;
  }
  return value;
}

export async function runHttpRequest(
  config: any,
  previousOutput: unknown
): Promise<HttpRequestResult> {
  const url = config?.url;
  if (!url) throw new Error("http_request step is missing config.url");
  const method = config?.method || "POST";
  const headers = config?.headers || { "content-type": "application/json" };
  const body = config?.body !== undefined ? interpolateDeep(config.body, previousOutput) : undefined;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`http_request failed with status ${res.status}: ${text.slice(0, 500)}`);
  }

  let responseBody: any;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = await res.text().catch(() => null);
  }

  return { output: { status: res.status, body: responseBody } };
}
