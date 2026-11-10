# Fly Next Social Hub

Fly Next's mobile-friendly ticketing lead dashboard and airline-update workspace.

## Current application capabilities
- Password login with bcrypt password hashes and signed 12-hour JWT sessions.
- Protected dashboard, lead CRUD/status updates, filters, search, and stored conversation history.
- PostgreSQL persistence through Neon.
- Authenticated airline update listing with official source references.
- Responsive static frontend under `public/`.
- Meta webhook verification and inbound text-message parsing for Facebook Messenger, Instagram Messaging, and WhatsApp Cloud API, with HMAC signature validation and event deduplication. Provider app configuration and subscribed webhooks are still required.
- Node/Express runtime and a Cloudflare Workers + Hyperdrive deployment target.

## Run the Node app locally
1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL`, `JWT_SECRET` (32+ random characters), `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (12+ characters).
5. Run `npm start` and open `http://localhost:3000`.
6. Run `npm run check` to validate JavaScript syntax.

The Node server creates the initial admin only when the users table is empty. Never commit `.env` or real credentials.

## Cloudflare Workers deployment (free-tier target)
The edge entry point is `worker/index.js`; static files are served from `public/`. PostgreSQL is accessed through Cloudflare Hyperdrive. The Hyperdrive binding must point to the Neon database before deployment.

1. Sign in to a Cloudflare account and install dependencies with `npm install`.
2. Create a Hyperdrive configuration using the Neon PostgreSQL connection string (prefer the direct/non-pooled connection for Hyperdrive) and replace the placeholder ID in `wrangler.jsonc`.
3. Set Worker secrets: `JWT_SECRET`, `BOOTSTRAP_SECRET`, `META_APP_SECRET`, and `META_VERIFY_TOKEN`. Generate unique high-entropy values; do not paste them into GitHub.
4. Deploy with `npx wrangler deploy`.
5. Create the first admin exactly once by sending a POST to `/api/auth/bootstrap` with header `x-bootstrap-secret` and JSON body containing `name`, `email`, and a password of at least 12 characters. The endpoint closes permanently once an admin exists. Keep the bootstrap secret private and rotate/remove it after use.
6. Verify `/api/health`, sign in, create a test lead, update its status, and reload to verify persistence.

Cloudflare account authorization, Hyperdrive resource creation, and secret configuration require the account owner. No live deployment URL is valid until these steps have been completed and health-checked.

## Meta webhook setup
Configure the same `META_VERIFY_TOKEN` in the Meta developer console and set `META_APP_SECRET` as a Worker/host secret. Subscribe the correct Facebook Page, Instagram professional account, or WhatsApp Business account to the required message webhook fields. The endpoint validates `X-Hub-Signature-256`, deduplicates provider events, and stores supported inbound text messages as leads and messages.

This does not send replies to social networks. The current composer saves internal reply drafts only. Outbound messaging needs separate provider-specific send APIs, permissions, templates/consent where required, and account approval.

## Integration status and limits
- **Facebook / Instagram / WhatsApp:** signed inbound webhook handler is implemented; provider setup and live end-to-end verification remain required.
- **TikTok / YouTube:** labels/status placeholders only; provider-specific ingestion and sending are not implemented.
- **Airline updates:** official source directory and saved-notice display exist. Automated collection and alert delivery are not implemented yet; do not treat the page as a live flight-status feed.
- **Authentication:** JWT and bcrypt login are implemented. MFA/2FA is not yet implemented.
