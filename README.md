# Fly Next Social Hub

Unified ticketing/social lead inbox for Fly Next.

## Included in v1
- JWT login with login-attempt throttling
- Unified lead inbox and pipeline
- Fresh Ticket, Reissue, Date Change, Sector Change, Fare, Availability and Refund categories
- New, Contacted, Quote, Won and Lost pipeline
- WhatsApp, Facebook, Instagram, TikTok, YouTube and Manual channel labels
- Search, filters, lead assignment and conversation/reply composer
- PostgreSQL persistence and automatic table creation
- Meta webhook verification endpoint (message ingestion still requires implementation and Meta configuration)
- Responsive mobile dashboard

## Run locally
1. Install Node.js 20 or later.
2. Run \`npm install\`.
3. Copy \`.env.example\` to \`.env\`.
4. Set a unique JWT_SECRET and ADMIN_PASSWORD.
5. Set DATABASE_URL to a PostgreSQL connection string for persistent storage.
6. Run \`npm start\` and open \`http://localhost:3000\`.

## Production requirements
- \`DATABASE_URL\` is mandatory in production; the server exits if it is missing.
- \`JWT_SECRET\` must be a unique random secret at least 32 characters long.
- \`ADMIN_PASSWORD\` must be at least 12 characters long. The initial admin is created only if the users table is empty.
- Set \`NODE_ENV=production\`.
- Configure \`ALLOWED_ORIGINS\` only if browser requests come from a separate frontend origin; list exact origins separated by commas.
- Use HTTPS and keep secrets only in the hosting provider's environment settings. Never commit a real \`.env\` file or credentials.
- Back up the PostgreSQL database before production schema changes.

## Current integration limits
The app can track leads manually and record replies in its database. Actual Facebook/Instagram/WhatsApp/TikTok/YouTube message ingestion and sending are **not yet connected**; valid provider app setup, tokens, webhook subscriptions, and provider-specific API handlers are still required. The current Meta POST webhook returns an explicit not-implemented response rather than pretending messages were saved.
