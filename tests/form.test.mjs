// The quote form logic in public/site.js, run in a stand-in page. node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../public/site.js", import.meta.url), "utf8");

class FormDataStub {
  constructor(values) {
    this.values = values;
  }
  get(key) {
    return this.values[key] ?? null;
  }
}

/** Loads site.js into a fake page and returns handles to submit the form and see what happened. */
function loadPage({ fetchImpl, search = "", values = {}, withStatus = true } = {}) {
  const listeners = {};
  const button = { disabled: false };
  let resetCalls = 0;
  const form = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    querySelector: () => button,
    reset: () => resetCalls++,
  };
  const status = { textContent: "", hidden: true };
  const emailNote = { hidden: false };
  const location = { search, hash: "", href: "https://suncoastservers.com/" };
  const fetchCalls = [];
  const page = {
    document: {
      documentElement: { dataset: {} },
      getElementById: (id) =>
        id === "quote-form" ? form : id === "form-status" && withStatus ? status : id === "form-email-note" ? emailNote : null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
    },
    location,
    history: { replaceState() {} },
    URLSearchParams,
    AbortController,
    FormData: function () {
      return new FormDataStub({
        name: "Ann",
        email: "ann@example.com",
        service: "Cloud & servers",
        message: "Hello",
        company_url: "",
        ...values,
      });
    },
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
    setTimeout,
    clearTimeout,
    Date,
    String,
    encodeURIComponent,
    Object,
    Array,
    JSON,
  };
  page.window = Object.assign(page, { scrollY: 0, addEventListener() {} });
  const context = vm.createContext(page);
  vm.runInContext(SOURCE, context);
  const submit = async () => {
    let prevented = false;
    await listeners.submit({ preventDefault: () => (prevented = true) });
    return prevented;
  };
  return { submit, status, emailNote, button, location, fetchCalls, resets: () => resetCalls };
}

const okResponse = { ok: true, json: async () => ({ ok: true }) };
const fallbackResponse = { ok: false, json: async () => ({ ok: false, fallback: true }) };

test("CRM accepts: thank-you shown, form cleared, no email app opened", async () => {
  const page = loadPage({ fetchImpl: async () => okResponse });
  assert.equal(await page.submit(), true);
  assert.equal(page.status.hidden, false);
  assert.match(page.status.textContent, /we got it/i);
  assert.equal(page.resets(), 1);
  assert.equal(page.emailNote.hidden, true, "the email-app note is hidden after a real send");
  assert.equal(page.location.href, "https://suncoastservers.com/", "no mailto");
  assert.equal(page.button.disabled, false);
});

test("CRM answers fallback (off, or refused): the email app opens like before", async () => {
  const page = loadPage({ fetchImpl: async () => fallbackResponse });
  await page.submit();
  assert.match(page.location.href, /^mailto:info@suncoastservers\.com\?subject=Suncoast%20Servers%20inquiry%3A%20Cloud%20%26%20servers&body=/);
  assert.ok(decodeURIComponent(page.location.href).includes("Name: Ann\nEmail: ann@example.com\nService: Cloud & servers\n\nHello"));
  assert.equal(page.status.hidden, true);
  assert.equal(page.emailNote.hidden, false, "the note stays for the email fallback");
  assert.equal(page.resets(), 0);
});

test("network error, bad answer or timeout also opens the email app", async () => {
  for (const impl of [
    async () => {
      throw new Error("offline");
    },
    async () => ({ ok: true, json: async () => ({}) }), // 200 without ok:true
    async () => ({ ok: true, json: async () => ({ ok: false }) }),
    async () => ({ ok: true, json: async () => Promise.reject(new Error("not json")) }),
  ]) {
    const page = loadPage({ fetchImpl: impl });
    await page.submit();
    assert.match(page.location.href, /^mailto:/);
    assert.equal(page.button.disabled, false, "the button works again");
  }
});

test("no status element on the page: still falls back to email, never loses the lead", async () => {
  const page = loadPage({ fetchImpl: async () => okResponse, withStatus: false });
  await page.submit();
  assert.match(page.location.href, /^mailto:/);
});

test("the honeypot filled: nothing is sent anywhere", async () => {
  const page = loadPage({ fetchImpl: async () => okResponse, values: { company_url: "http://spam" } });
  await page.submit();
  assert.equal(page.fetchCalls.length, 0);
  assert.equal(page.location.href, "https://suncoastservers.com/");
});

test("posts the form and campaign tags to /api/lead", async () => {
  const page = loadPage({
    fetchImpl: async () => okResponse,
    search: "?utm_source=google&utm_campaign=spring&utm_medium=cpc&other=1",
  });
  await page.submit();
  assert.equal(page.fetchCalls.length, 1);
  const { url, init } = page.fetchCalls[0];
  assert.equal(url, "/api/lead");
  assert.equal(init.method, "POST");
  const sent = JSON.parse(init.body);
  assert.deepEqual(
    { name: sent.name, email: sent.email, service: sent.service, message: sent.message, company_url: sent.company_url },
    { name: "Ann", email: "ann@example.com", service: "Cloud & servers", message: "Hello", company_url: "" },
  );
  assert.deepEqual(sent.utm, { utm_source: "google", utm_medium: "cpc", utm_campaign: "spring" });
  assert.ok(Number.isFinite(sent.elapsedMs) && sent.elapsedMs >= 0);
});

test("the button is off while sending", async () => {
  let seenDisabled;
  const page = loadPage({
    fetchImpl: async () => {
      seenDisabled = page.button.disabled;
      return okResponse;
    },
  });
  await page.submit();
  assert.equal(seenDisabled, true);
  assert.equal(page.button.disabled, false);
});
