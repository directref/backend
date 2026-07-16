# Refrd — Backend API

> Referral-first job network. Your CV, straight to a friend inside the company.

## Prerequisites

- [Node.js 20+](https://nodejs.org)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Setup

### 1. Clone the repo
```bash
git clone https://github.com/anatAtar/refrd-backend.git
cd refrd-backend
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
```

The defaults in `.env` work out of the box for local development.
No external accounts needed to get started.

### 4. Start the database
```bash
npm run docker:up
```

This starts PostgreSQL on port 5432 and Adminer (DB admin UI) on port 8080.
Wait for the terminal to show `Container vouch_postgres Healthy`.

### 5. Run migrations & seed data
```bash
npm run db:migrate   # creates all tables
npm run db:seed      # adds 3 test users + 2 jobs
```

### 6. Start the server
```bash
npm run dev
```

API is now running at **http://localhost:3000**

---

## Test Accounts

| Name | Email | Password | Role |
|---|---|---|---|
| Sarah Alon | sarah@example.com | Password1 | Works at Google |
| Jonathan Katz | jonathan@example.com | Password1 | Works at Wix |
| Maya Ron | maya@example.com | Password1 | Job seeker |

---

## Useful URLs

| URL | What |
|---|---|
| http://localhost:3000/health | API health check |
| http://localhost:8080 | Adminer DB admin UI |

**Adminer login:** System: PostgreSQL · Server: `postgres` · User: `vouch` · Password: `vouch_pass` · DB: `vouch_db`

---

## Optional Services

Add these to `.env` to enable full functionality:

| Service | Variable | Get it from |
|---|---|---|
| Google OAuth | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | [Google Cloud Console](https://console.cloud.google.com) |
| Email sending | `RESEND_API_KEY` | [Resend.com](https://resend.com) (free) |

---

## npm Scripts

```bash
npm run dev          # Start with hot-reload
npm run build        # Compile TypeScript
npm run start        # Run compiled build

npm run db:migrate   # Apply database migrations
npm run db:seed      # Reset DB + insert test data
npm run db:studio    # Open Drizzle Studio (visual DB browser)

npm run docker:up    # Start PostgreSQL + Adminer
npm run docker:down  # Stop containers
```

---

## Tech Stack

- **Runtime:** Node.js 20 + TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL 16 (Docker)
- **ORM:** Drizzle ORM
- **Auth:** Passport.js (email/password + Google OAuth) · JWT httpOnly cookies
- **Email:** Resend
- **File uploads:** Multer (CV files, PDF/DOCX)
- **Validation:** Zod

## Related

👉 Frontend repo: https://github.com/anatAtar/refrd-frontend
