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
- Conversation/reply composer
- PostgreSQL production support
- Automatic database table creation
- Meta webhook verification endpoint
- Responsive mobile dashboard

## Run
1. npm install
2. Copy .env.example to .env
3. Set JWT_SECRET and optionally DATABASE_URL
4. npm start
5. Open http://localhost:3000

Without DATABASE_URL the app uses demo in-memory data. Production should use PostgreSQL.
