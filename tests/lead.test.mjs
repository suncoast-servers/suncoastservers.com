// node --test tests/
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { onRequestPost } from "../functions/api/lead.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SECRET = "test-secret-value-123";
const form = (over = {}) => ({
  name: "Ann Tester",
  email: "Ann@Example.com ",
  service: "Website or hosting",
  message: "My site is slow",
  company_url: "",
  elapsedMs: 9000,
  utm: { utm_source: "google", utm_medium: "cpc", utm_campaign: "spring" },
  ...over,
});

function call(body, { env = { LEAD_WEBHOOK_SECRET: SECRET }, headers = {}, raw } = {}) {
  const request = new Request("https://suncoastservers.com/api/lead", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://suncoastservers.com", ...headers },
    body: raw ?? JSON.stringify(body),
  });
  return onRequestPost({ request, env });
}

function fakeN8n(status = 201, body = '{"status":"created"}') {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(body, { status });
  };
  return seen;
}

test("off without a secret: answers fallback, calls nothing", async () => {
  const seen = fakeN8n();
  const res = await call(form(), { env: {} });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, fallback: true });
  assert.equal(seen.length, 0);
});

test("sends the lead to n8n with the secret in the header and an allow-listed body", async () => {
  const seen = fakeN8n();
  const res = await call(form());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(seen.length, 1);
  const { url, init } = seen[0];
  assert.equal(url, "https://n8n.suncoastservers.com/webhook/lead-inbound-generic");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["x-webhook-secret"], SECRET);
  assert.equal(init.redirect, "manual", "redirects are never followed");
  assert.deepEqual(JSON.parse(init.body), {
    businessLine: "hosting",
    contactName: "Ann Tester",
    contactEmail: "ann@example.com",
    leadSource: "suncoastservers.com quote form",
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "spring",
    notes: "Service: Website or hosting\n\nMy site is slow",
  });
  assert.ok(!init.body.includes(SECRET), "the secret is only in the header");
});

test("service picked decides the business line", async () => {
  const expected = {
    "Website or hosting": "hosting",
    "Cloud & servers": "hosting",
    "Mobile device cloud": "mobile-cloud",
    "AI & automation": "chatbot",
    "IT support & troubleshooting": "suncoast-it",
    "Social media & ads": "suncoast-it",
    "Customer & community support": "suncoast-it",
    "Security & backups": "suncoast-it",
    "Email, Microsoft 365 & Google Workspace": "suncoast-it",
    "Not sure yet": "suncoast-it",
    "something not on the list": "suncoast-it",
    "": "suncoast-it",
  };
  for (const [service, line] of Object.entries(expected)) {
    const seen = fakeN8n();
    await call(form({ service }));
    assert.equal(JSON.parse(seen[0].init.body).businessLine, line, service || "(empty)");
  }
});

test("a duplicate counts as delivered, a custom webhook URL is used", async () => {
  const seen = fakeN8n(200, '{"status":"duplicate","dealId":"x"}');
  const res = await call(form(), { env: { LEAD_WEBHOOK_SECRET: SECRET, LEAD_WEBHOOK_URL: "https://n8n.example/test" } });
  assert.equal(res.status, 200);
  assert.equal(seen[0].url, "https://n8n.example/test");
});

test("anything but a clear created/duplicate falls back to email", async () => {
  const cases = [
    [403, "Authorization data is wrong!"],
    [500, '{"error":"x"}'],
    [400, '{"errors":["x"]}'],
    [200, "<!DOCTYPE html><title>Sign in</title>"], // an Access login page
    [200, '{"message":"Workflow was started"}'],
    [302, ""],
    [201, "not json"],
  ];
  for (const [status, body] of cases) {
    fakeN8n(status, body);
    const res = await call(form());
    assert.equal(res.status, 503, `${status} ${body.slice(0, 20)}`);
    assert.deepEqual(await res.json(), { ok: false, fallback: true });
  }
});

test("a network error or timeout falls back to email", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNRESET");
  };
  assert.equal((await call(form())).status, 503);
  globalThis.fetch = async () => {
    throw new DOMException("timed out", "TimeoutError");
  };
  assert.equal((await call(form())).status, 503);
});

test("bots get a quiet ok and nothing is sent", async () => {
  const seen = fakeN8n();
  for (const bot of [form({ company_url: "http://spam.example" }), form({ elapsedMs: 300 }), form({ elapsedMs: undefined })]) {
    const res = await call(bot);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  }
  assert.equal(seen.length, 0);
});

test("invalid forms are refused with 400 before anything is sent", async () => {
  const seen = fakeN8n();
  for (const bad of [form({ name: "  " }), form({ email: "nope" }), form({ email: "a@b" }), form({ name: undefined })]) {
    const res = await call(bad);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
  }
  assert.equal((await call(null, { raw: "not json" })).status, 400);
  assert.equal((await call(null, { raw: "[1,2]" })).status, 400);
  assert.equal(seen.length, 0);
});

test("other websites and oversized bodies are refused", async () => {
  const seen = fakeN8n();
  assert.equal((await call(form(), { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await call(null, { raw: JSON.stringify({ message: "x".repeat(9000) }) })).status, 413);
  assert.equal((await call(null, { raw: "{}", headers: { "content-length": "99999" } })).status, 413);
  assert.equal(seen.length, 0);
});

test("text is cleaned and capped before it leaves", async () => {
  const seen = fakeN8n();
  await call(form({ name: "Ann\u0000\n\tTester" + "x".repeat(300), message: "line1\r\nline2\u0007" + "y".repeat(3000) }));
  const sent = JSON.parse(seen[0].init.body);
  assert.ok(sent.contactName.startsWith("Ann Tester") && sent.contactName.length === 120);
  assert.ok(!/[\u0000-\u0008]/.test(sent.notes));
  assert.ok(sent.notes.includes("line1\nline2"));
  assert.ok(sent.notes.length <= 2000 + "Service: Website or hosting\n\n".length);
});

test("missing utm is left out, no message is noted", async () => {
  const seen = fakeN8n();
  await call(form({ utm: undefined, message: "   " }));
  const sent = JSON.parse(seen[0].init.body);
  assert.ok(!("utmSource" in sent) && !("utmMedium" in sent) && !("utmCampaign" in sent));
  assert.equal(sent.notes, "Service: Website or hosting\n\n(no message)");
});

test("the answer never contains the secret or lead details", async () => {
  fakeN8n(500, "boom");
  const res = await call(form());
  const text = await res.text();
  assert.ok(!text.includes(SECRET) && !text.includes("ann@example.com"));
});
