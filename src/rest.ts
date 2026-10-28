import { segment, orgName } from "./config.js";
import type { Context } from "./context.js";
import type { Credential } from "./auth.js";
import { SafeError } from "./errors.js";

export type Fetcher = typeof fetch;
export type RestOptions = {
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string>;
  body?: unknown;
  patch?: boolean;
};
const MAX_BYTES = 4 * 1024 * 1024;
const sensitiveKey = /^(authorization|proxy-authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|password|client[_-]?secret|secret|pat|token)$/i;

export function redact(value: unknown, secrets: string[], depth = 0): unknown {
  if (depth > 40) return "[depth limit]";
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join("[REDACTED]");
    return text.replace(/\b(Bearer|Basic)\s+[a-zA-Z0-9+/_=.-]+/gi, "$1 [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [String(redact(k, secrets, depth + 1)), sensitiveKey.test(k) ? "[REDACTED]" : redact(v, secrets, depth + 1)]),
  );
  return value;
}

export function apiUrl(organization: string, segments: string[], query: Record<string, string> = {}): URL {
  const org = orgName.safeParse(organization);
  if (!org.success || segments.some((s) => !segment.safeParse(s).success)) throw new SafeError("Invalid API path.");
  const url = new URL(`https://dev.azure.com/${org.data}/${segments.map(encodeURIComponent).join("/")}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("api-version", "7.1");
  if (url.origin !== "https://dev.azure.com" || !url.pathname.startsWith(`/${org.data}/`)) throw new SafeError("API target escaped its organization boundary.");
  return url;
}

export class RestClient {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async request(context: Context, auth: Credential, segments: string[], options: RestOptions = {}) {
    const url = apiUrl(context.organization, segments, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      if (body && Buffer.byteLength(body) > 1024 * 1024) throw new SafeError("Request body exceeds 1 MiB.");
      const response = await this.fetcher(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: auth.authorization, Accept: "application/json",
          ...(body ? { "Content-Type": options.patch ? "application/json-patch+json" : "application/json" } : {}),
        },
        ...(body ? { body } : {}), redirect: "manual", signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new SafeError("Azure DevOps redirect refused. Credentials are never forwarded to redirects; check the target and sign-in setup.");
      }
      if (response.url && response.url !== url.href) {
        await response.body?.cancel();
        throw new SafeError("Unexpected response URL; request stopped at the origin boundary.");
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) throw new SafeError(`Azure DevOps authorization failed (HTTP ${response.status}) for the selected profile. No alternate identity was tried.`);
        throw new SafeError(`Azure DevOps request failed (HTTP ${response.status}). Writes are not retried; verify state before resubmitting.`);
      }
      if (response.status === 204) return { data: null, continuationToken: null };
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        await response.body?.cancel();
        throw new SafeError("Expected Azure DevOps JSON, not a login page or other content.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new SafeError("Azure DevOps returned an empty response.");
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new SafeError("Response exceeds 4 MiB; narrow the query or page size.");
        }
        chunks.push(value);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const continuation = response.headers.get("x-ms-continuationtoken");
      if (continuation && continuation.length > 2048) throw new SafeError("Continuation token exceeds limit.");
      return {
        data: redact(data, auth.secrets),
        continuationToken: continuation ? String(redact(continuation, auth.secrets)) : null,
      };
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw new SafeError("Azure DevOps request failed, timed out or returned invalid JSON. Sensitive details suppressed. If writing, verify state before retrying.");
    } finally { clearTimeout(timer); }
  }
}
