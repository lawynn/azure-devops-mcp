import assert from "node:assert/strict";
import { test } from "node:test";
import { RestClient, apiUrl, redact } from "../src/rest.js";
import { publicError } from "../src/errors.js";

const ctx = { organization: "one", profile: "one" };
const auth = { authorization: "Bearer fake-secret", secrets: ["fake-secret"] };
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  ...init, headers: { "content-type": "application/json", ...init?.headers },
});

test("API URLs encode segments/query and stay inside their organization", () => {
  const url = apiUrl("one", ["Project A", "_apis", "wit", "workitems", "$Bug"], { "$top": "5" });
  assert.equal(url.origin, "https://dev.azure.com");
  assert.match(url.pathname, /^\/one\/Project%20A\/_apis\/wit\/workitems\/%24Bug$/);
  assert.equal(url.searchParams.get("api-version"), "7.1");
  for (const part of ["..", ".", "../two", "%2e%2e", "a\\b", "https://evil.invalid", "a?b", "a#b", "a\nb"]) {
    assert.throws(() => apiUrl("one", [part]));
  }
  assert.throws(() => apiUrl("one/../two", ["_apis"]));
});

test("all redirects are refused without forwarding credentials, including same-origin different organizations", async () => {
  for (const location of ["https://evil.invalid", "https://dev.azure.com/two/_apis/projects", "/one/_apis/projects"]) {
    let calls = 0;
    const rest = new RestClient(async (_url, options) => {
      calls++;
      assert.equal(options?.redirect, "manual");
      return new Response(null, { status: 302, headers: { location } });
    });
    await assert.rejects(rest.request(ctx, auth, ["_apis", "projects"]), /redirect refused/);
    assert.equal(calls, 1);
  }
});

test("an unexpected response URL is not accepted", async () => {
  const response = json({ value: [] });
  Object.defineProperty(response, "url", { value: "https://dev.azure.com/two/_apis/projects" });
  await assert.rejects(new RestClient(async () => response).request(ctx, auth, ["_apis", "projects"]), /origin boundary/);
});

test("HTTP errors never echo response secrets and never retry writes", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const rest = new RestClient(async () => { calls++; return new Response("fake-secret", { status }); });
    await assert.rejects(rest.request(ctx, auth, ["_apis", "projects"], { method: "POST", body: { title: "test" } }),
      (error: unknown) => publicError(error).includes(String(status)) && !publicError(error).includes("fake-secret"));
    assert.equal(calls, 1);
  }
});

test("JSON results redact credential values, encoded basic secrets, headers and sensitive keys", async () => {
  const rest = new RestClient(async () => json({
    title: "echo fake-secret", accessToken: "another-token", nested: { password: "p", authorization: "x", description: "Bearer abc.def.ghi" },
  }, { headers: { "x-ms-continuationtoken": "next-page" } }));
  const result = await rest.request(ctx, auth, ["_apis", "projects"]);
  assert.deepEqual(result, {
    data: { title: "echo [REDACTED]", accessToken: "[REDACTED]", nested: { password: "[REDACTED]", authorization: "[REDACTED]", description: "Bearer [REDACTED]" } },
    continuationToken: "next-page",
  });
  assert.equal(redact("encoded-secret", ["encoded-secret"]), "[REDACTED]");
});

test("non-JSON, oversize bodies, oversized requests and malformed JSON fail safely", async () => {
  for (const response of [
    new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    new Response("invalid fake-secret", { headers: { "content-type": "application/json" } }),
    new Response('"' + "x".repeat(4 * 1024 * 1024) + '"', { headers: { "content-type": "application/json" } }),
  ]) await assert.rejects(new RestClient(async () => response).request(ctx, auth, ["_apis", "projects"]));
  let calls = 0;
  const rest = new RestClient(async () => { calls++; return json({}); });
  await assert.rejects(rest.request(ctx, auth, ["_apis"], { method: "POST", body: "x".repeat(1024 * 1024) }), /1 MiB/);
  assert.equal(calls, 0);
});
