# Fly Next Social Hub

Unified ticketing/social lead inbox for Fly Next.

## Included in v1
- JWT login
- Unified lead inbox
- Fresh Ticket, Reissue, Date Change, Sector Change, Fare, Availability and Refund categories
- New, Contacted, Quote, Won and Lost pipeline
- WhatsApp, Facebook, Instagram, TikTok, YouTube and Manual channel labels
- Search and filters
- Lead assignment
- Conversation/reply composer (saves drafts/records in this app; does not send to social platforms)
- PostgreSQL production support
- Automatic database table creation
- Meta webhook verification endpoint
- Responsive mobile dashboard

## Run locally
1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set a unique, random `JWT_SECRET` of at least 32 characters and a unique strong `ADMIN_PASSWORD`.
4. Set `DATABASE_URL` to your PostgreSQL connection string.
5. Run `npm start` and open `http://localhost:3000`.

## Production database (Neon PostgreSQL)
1. Create a project on the Neon Free plan.
2. In the Neon Console, open **Connect** and select the default branch, database, and role.
3. Copy the **pooled** connection string (hostname includes `-pooler`). Keep `sslmode=require` in the URL.
4. Add the connection string to the hosting provider's environment variables as `DATABASE_URL`. Never commit it to GitHub or paste it into chats.
5. In the hosting provider, ensure `NODE_ENV=production`, `JWT_SECRET` (at least 32 random characters), and a unique `ADMIN_PASSWORD` are configured.
6. Redeploy the service. At startup, the app creates the `users`, `leads`, and `messages` tables automatically.
7. Check `/api/health`. A successful response should show `"ok": true`, `"database": true`, and `"persistence": "postgresql"`.

The first production startup creates the Admin account using `ADMIN_EMAIL` (default `admin@flynext.pk`) and `ADMIN_PASSWORD` only if the users table is empty. Keep these credentials private.

Without `DATABASE_URL`, local development can use temporary in-memory demo data; production startup intentionally refuses to start without a persistent database. The app's reply composer does not send messages to WhatsApp/Facebook/Instagram/TikTok/YouTube until those platforms are separately configured and integrated.
