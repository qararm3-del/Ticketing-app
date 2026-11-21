# Fly Next Social Hub

Responsive B2B ticket-lead inbox for Fly Next.

## Features
- Admin login with bcrypt password hashes, signed 12-hour JWT sessions and login-attempt throttling
- Unified lead inbox, dashboard counts, search and filters
- Ticket categories: Fresh Ticket, Reissue, Date Change, Sector Change, Fare, Availability and Refund
- Pipeline statuses: New, Contacted, Quote, Won and Lost
- PostgreSQL persistence for users, leads, messages, social connection state, webhook events and audit records
- Social-channel status panel for Facebook, Instagram, WhatsApp, TikTok and YouTube
- Meta webhook verification and HMAC-SHA256 signature validation
- Idempotent inbound WhatsApp text-message ingestion into ticket leads and conversation history
- Responsive mobile dashboard

## Run locally
1. Use Node.js 20 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and enter local values.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Required production environment
- `NODE_ENV=production`
- `DATABASE_URL`: Neon PostgreSQL connection string
- `DATABASE_SSL=true`
- `JWT_SECRET`: unique random secret, at least 32 characters
- `ADMIN_EMAIL`: administrator login email
- `ADMIN_PASSWORD`: initial admin password, at least 12 characters

The initial admin account is created only when the users table is empty. Keep secrets in the hosting provider's environment settings; never commit a real `.env` file.

## Render
A free-plan web-service Blueprint is provided in `render.yaml`. Connect this repository to Render, create the Blueprint, provide the Neon `DATABASE_URL` and a strong `ADMIN_PASSWORD`, and apply the free web service. Render may require payment-information verification before creating a service even when the selected compute plan is free.

## Social integrations
The dashboard reports real configuration state and does not mark a channel connected merely because a token exists. WhatsApp inbound text-message capture is implemented for Meta's WhatsApp Business Cloud API. It requires `META_APP_SECRET`, `META_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, and a Meta webhook subscription to `/webhooks/meta`.

Facebook and Instagram inbox ingestion, plus TikTok and YouTube ingestion, need provider app approvals, scopes, account tokens, webhook subscriptions and their respective provider-specific handlers. Provider credentials and approvals must be issued by the account owner and cannot be fabricated. Reply composition currently saves internal drafts; it does not send replies to social platforms.

## Health
`GET /api/health` reports app and database connectivity. In production it returns HTTP 503 if PostgreSQL is unavailable.
