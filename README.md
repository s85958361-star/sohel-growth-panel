# SOHEL GROWTH PANEL

Premium Node.js + PostgreSQL starter for legitimate social-media management services.

## Included
- Responsive black-and-gold interface with logo/text branding and glow-style buttons
- Customer registration and login (bcrypt password hashing)
- Admin role and admin console
- Service catalogue and admin service creation
- Customer orders and order history
- Transaction history
- Admin order-status controls
- Admin wallet adjustment with transaction logging
- PostgreSQL schema initialized automatically
- Render deployment blueprint

## Important limitations
This is a starter project, not a finished commercial payment platform. It does **not** collect card details or claim that a payment succeeded. UPI/Razorpay must be integrated using an approved provider account, server-side order creation, signed webhook verification, idempotency checks, and test-mode validation before enabling automatic wallet credits. Never credit a wallet from a browser redirect alone.

The included provider API manager is not wired to a third-party provider yet. Add only documented, authorized APIs for permitted services. Do not use this project to sell fake engagement, spam, account access, or platform-manipulation services. Use it for legitimate services such as content strategy, profile audits, creative production and account-management work.

## Run locally
1. Install Node.js 20+ and PostgreSQL.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:10000`.

The first startup creates the admin account if it does not already exist. Set a strong unique admin password. Do not commit `.env`.

## Deploy on Render
1. Push this folder to a private GitHub repository.
2. In Render, choose **New > Blueprint** and select the repository.
3. Review the `render.yaml` resources and deploy.
4. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the web service environment.
5. Wait for `/api/health` to return `{"ok":true,...}`.
6. Sign in with the configured admin credentials and change them if your deployment process requires it.

## Money handling
Amounts are stored as integer paise. Admin wallet adjustments are manual bookkeeping only. Verify a payment in the payment provider dashboard before applying a credit. For live gateway integration, implement and test provider webhooks before launch.

## Security before production
- Use a persistent session store (for example PostgreSQL-backed sessions); the default in-memory session store is for starter/testing only.
- Add CSRF protection, rate limiting, email verification, password reset, audit logs, backups and stricter validation.
- Add provider API credentials only through server-side environment variables or encrypted secret storage. Never expose API keys in frontend code.
- Restrict admin access and enable HTTPS.
