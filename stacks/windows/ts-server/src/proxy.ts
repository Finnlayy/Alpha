/**
 * =========================================================
 * Datei:      stacks/windows/ts-server/src/proxy.ts
 * Zweck:      Reverse-Proxy → Alpha Execution Core
 *             (Ubuntu 192.168.178.50:8000 / ALPHA_CORE_URL)
 * =========================================================
 */

export class CoreProxy {
  constructor(public coreUrl: string) {}

  async forward(
    req: { method: string; url: string; headers: Record<string, string | string[] | undefined> },
    body: Buffer | undefined,
  ): Promise<{ status: number; headers: Record<string, string>; body: Buffer } | null> {
    try {
      const upstream = new URL(req.url, this.coreUrl);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (k.toLowerCase() === "host") continue;
        headers[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      const res = await fetch(upstream.toString(), {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : (body ? new Uint8Array(body) : undefined),
        signal: AbortSignal.timeout(180_000),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (!["transfer-encoding", "connection", "content-encoding"].includes(k.toLowerCase())) {
          outHeaders[k] = v;
        }
      });
      return { status: res.status, headers: outHeaders, body: buf };
    } catch {
      return null;
    }
  }

  /** GET JSON von der Core-API (z.B. OHLC für den GA). */
  async getJson<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(new URL(path, this.coreUrl).toString(), {
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}
