// Minimal fetch helpers with timeout + JSON handling for provider calls.

export async function httpJson<T = any>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 20000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let body: any = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = typeof body === "object" ? JSON.stringify(body) : String(body);
      const err = new Error(`HTTP ${res.status} from ${url}: ${msg}`);
      (err as any).status = res.status;
      (err as any).body = body;
      throw err;
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export function form(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}
