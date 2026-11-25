# Suncoast Servers

This site was created by Suncoast Servers LLC.

The source, design, and assets are proprietary. See [LICENSE](LICENSE). Do not copy them without permission.

Contact: [info@suncoastservers.com](mailto:info@suncoastservers.com)

## Quote form to the CRM

The quote form posts to `functions/api/lead.js` (a Cloudflare Pages Function), which sends the lead to the
Suncoast Core CRM through n8n `lead-inbound-generic` (SuncoastServersCore #21, contract in that repo's
`docs/integration-contracts.md` section 1). If the CRM does not clearly accept the lead, the page opens the
visitor's email app with everything filled in, exactly as before, so no lead is lost.

It is **off until the secret is set**. Cloudflare Pages, Settings, Environment variables, Production:

| Variable | What |
|---|---|
| `LEAD_WEBHOOK_SECRET` | The n8n credential "Lead webhook secret". Never commit it. Without it the form behaves as before |
| `LEAD_WEBHOOK_URL` | Optional. Default `https://n8n.suncoastservers.com/webhook/lead-inbound-generic` |

The service picked on the form sets the CRM business line: Website or hosting and Cloud & servers go to
`hosting`, Mobile device cloud to `mobile-cloud`, AI & automation to `chatbot`, everything else to `suncoast-it`.

Before turning it on, update the texts that say the form only opens an email app or that there is no contact
database: the note under the form (`public/index.html`), `public/privacy/index.html` and `public/llms.txt`.

Tests (no install needed, Node 20+): `node --test tests/lead.test.mjs tests/form.test.mjs`.
