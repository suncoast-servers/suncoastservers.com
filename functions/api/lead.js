// POST /api/lead: sends the quote form to the Suncoast Core CRM (SuncoastServersCore #21).
//
// The browser posts the form here. This function adds the webhook secret on the server side and
// posts the lead to n8n `lead-inbound-generic` (contract: SuncoastServersCore docs/integration-contracts.md
// section 1), which creates the contact + deal in Twenty.
//
// OFF until the secret is set: with no LEAD_WEBHOOK_SECRET this answers 503 {fallback:true} and the
// page opens the visitor's email app exactly like before, so merging this changes nothing for visitors.
//
// Env vars (Cloudflare Pages -> Settings -> Environment variables, Production):
//   LEAD_WEBHOOK_SECRET   the n8n credential "Lead webhook secret" (never commit it)
//   LEAD_WEBHOOK_URL      optional, default https://n8n.suncoastservers.com/webhook/lead-inbound-generic
//
// Answers:
//   200 {ok:true}                     the CRM accepted it (also for bots, which get nothing sent)
//   4xx {ok:false, error}             the form data is not valid
//   503 {ok:false, fallback:true}     not set up or the CRM did not accept it: page falls back to email

const DEFAULT_URL = 'https://n8n.suncoastservers.com/webhook/lead-inbound-generic';
const MAX_BODY = 8000;
const TIMEOUT_MS = 8000;
const MIN_FILL_MS = 1500;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Service picked on the form -> Twenty businessLine slug (schema/v1/workspace.yaml). Proposal in
// SuncoastServersCore docs/site-lead-inventory.md, for Ryan to confirm.
const BUSINESS_LINES = {
  'Website or hosting': 'hosting',
  'Cloud & servers': 'hosting',
  'Mobile device cloud': 'mobile-cloud',
  'AI & automation': 'chatbot',
};
const DEFAULT_LINE = 'suncoast-it';

const oneLine = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const block = (value, max) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const fallback = () => json(503, { ok: false, fallback: true });

/** n8n answers {"status":"created"} (201) or {"status":"duplicate"} (200). Nothing else counts as delivered. */
function delivered(status, text) {
  if (status !== 200 && status !== 201) return false;
  try {
    const answer = JSON.parse(text)?.status;
    return answer === 'created' || answer === 'duplicate';
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  // Only our own page may post here.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json(403, { ok: false, error: 'forbidden' });

  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) return json(413, { ok: false, error: 'too large' });
  let raw;
  try {
    raw = await request.text();
  } catch {
    return json(400, { ok: false, error: 'bad request' });
  }
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: 'too large' });

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'bad json' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { ok: false, error: 'bad json' });

  // Bots: the hidden field is filled, or the form was "filled" faster than a person can. Pretend it worked.
  if (oneLine(body.company_url, 50) || (Number(body.elapsedMs) || 0) < MIN_FILL_MS) return json(200, { ok: true });

  const name = oneLine(body.name, 120);
  const email = oneLine(body.email, 200).toLowerCase();
  const service = oneLine(body.service, 80) || 'Not sure yet';
  const message = block(body.message, 2000);
  const errors = [];
  if (!name) errors.push('name');
  if (!EMAIL_RE.test(email)) errors.push('email');
  if (errors.length) return json(400, { ok: false, error: `invalid: ${errors.join(', ')}` });

  const secret = String((env && env.LEAD_WEBHOOK_SECRET) || '').trim();
  if (!secret) return fallback();
  const target = String((env && env.LEAD_WEBHOOK_URL) || '').trim() || DEFAULT_URL;

  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  const payload = {
    businessLine: BUSINESS_LINES[service] || DEFAULT_LINE,
    contactName: name,
    contactEmail: email,
    leadSource: 'suncoastservers.com quote form',
    utmSource: oneLine(utm.utm_source, 120) || undefined,
    utmMedium: oneLine(utm.utm_medium, 120) || undefined,
    utmCampaign: oneLine(utm.utm_campaign, 120) || undefined,
    notes: `Service: ${service}\n\n${message || '(no message)'}`,
  };

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': secret },
      body: JSON.stringify(payload),
      // A redirect to a login page answers 200 HTML and would look delivered, so never follow one.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (delivered(response.status, await response.text().catch(() => ''))) return json(200, { ok: true });
  } catch {
    // network error or timeout: fall through
  }
  return fallback();
}
