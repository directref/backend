# Vouch Backend API

A referral-first job network. Friends help friends get hired, and earn referral bonuses.

## Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- npm

### 1. Clone & Install

```bash
cd vouch-backend
npm install
```

### 2. Start the Database

```bash
npm run docker:up
# PostgreSQL on :5432  |  Adminer (DB admin UI) on :8080
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env — the defaults work for local development
# Add GOOGLE_CLIENT_ID/SECRET for Google OAuth (optional)
# Add RESEND_API_KEY for transactional email (optional in dev)
```

### 4. Run Migrations & Seed

```bash
npm run db:migrate   # applies SQL migrations
npm run db:seed      # creates 3 test users + 2 jobs
```

### 5. Start Dev Server

```bash
npm run dev
# API running on http://localhost:3000
# Hot-reloads on file changes
```

### 6. Verify

```bash
curl http://localhost:3000/health
# → { "status": "ok", "checks": { "database": "connected", "uploads": "writable" } }
```

---

## Test Accounts (after seeding)

| Name | Email | Password | Role |
|---|---|---|---|
| Sarah Alon | sarah@example.com | Password1 | Referrer (Google) |
| Jonathan Katz | jonathan@example.com | Password1 | Referrer (Wix) |
| Maya Ron | maya@example.com | Password1 | Job Seeker |

Maya is already connected to both Sarah and Jonathan.

---

## API Reference

### Base URL: `http://localhost:3000`

All API routes are under `/api`. Authentication uses httpOnly cookies set on login.

---

### Auth `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | — | Register with email + password |
| `POST` | `/login` | — | Login; sets JWT cookies |
| `POST` | `/logout` | ✓ | Clear cookies |
| `GET` | `/me` | ✓ | Current authenticated user |
| `GET` | `/google` | — | Start Google OAuth |
| `GET` | `/google/callback` | — | Google OAuth callback |
| `POST` | `/refresh` | cookie | Refresh access token |
| `POST` | `/forgot-password` | — | Send reset email |
| `POST` | `/reset-password` | — | `{ token, newPassword }` |
| `GET` | `/verify-email/:token` | — | Verify email address |

**Register example:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Password1","fullName":"Your Name"}'
```

---

### Users `/api/users`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/me` | ✓ | Full profile |
| `PATCH` | `/me` | ✓ | Update profile / toggle referrer mode |
| `GET` | `/:id` | ✓ | Public profile |
| `GET` | `/search?q=` | ✓ | Search by name or company |
| `DELETE` | `/me` | ✓ | Delete account |

---

### Connections `/api/connections`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/` | ✓ | Send connection request `{ addresseeId }` |
| `GET` | `/` | ✓ | List connections (`?status=accepted&direction=sent`) |
| `PATCH` | `/:id` | ✓ | Accept or reject `{ status: "accepted"/"rejected" }` |
| `DELETE` | `/:id` | ✓ | Remove connection |
| `GET` | `/mutual/:userId` | ✓ | Check if friends |

---

### Jobs `/api/jobs`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/scrape` | ✓ | `{ url }` → auto-fill job fields from URL |
| `GET` | `/feed` | ✓ | Jobs from accepted connections |
| `GET` | `/mine` | ✓ | Your posted jobs (referrers) |
| `GET` | `/` | ✓ | Search all jobs (`?q=engineer&company=google`) |
| `GET` | `/:id` | ✓ | Job detail + referrer info |
| `POST` | `/` | ✓ referrer | Create job posting |
| `PATCH` | `/:id` | ✓ owner | Update job |
| `DELETE` | `/:id` | ✓ owner | Deactivate job |

---

### Applications `/api/applications`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/` | ✓ | Submit CV — multipart form: `jobId`, `cv` file, `coverNote?` |
| `GET` | `/inbox` | ✓ | CVs received (referrers) `?status=submitted` |
| `GET` | `/mine` | ✓ | Applications you sent |
| `GET` | `/:id` | ✓ | Single application |
| `PATCH` | `/:id/status` | ✓ referrer | `{ status: "viewed"/"rejected" }` |
| `POST` | `/:id/forward` | ✓ referrer | Forward CV to HR `{ hrEmail, referrerNote? }` |
| `GET` | `/:id/cv` | ✓ | Download CV file |

**Business rules enforced in the API:**
- You must be an accepted connection with the referrer to submit a CV
- One application per job per seeker
- You cannot apply to your own job posting
- Only the referrer on an application can forward it to HR

---

## npm Scripts

```bash
npm run dev          # Start with hot-reload
npm run build        # Compile TypeScript → dist/
npm run start        # Run compiled build
npm run typecheck    # TypeScript strict check (0 errors)

npm run db:generate  # Generate new migration from schema changes
npm run db:migrate   # Apply pending migrations
npm run db:push      # Push schema directly (dev only, no migration file)
npm run db:studio    # Open Drizzle Studio (visual DB browser)
npm run db:seed      # Reset DB + insert test data

npm run docker:up    # Start PostgreSQL + Adminer
npm run docker:down  # Stop containers
npm run docker:logs  # Follow Postgres logs
```

---

## Project Structure

```
src/
├── config/          # env, db, passport, multer
├── db/
│   ├── schema/      # Drizzle table definitions (source of truth)
│   ├── migrations/  # Auto-generated SQL
│   └── seed.ts      # Dev seed script
├── middleware/       # auth, validate, upload, errorHandler, rateLimiter
├── modules/          # Feature modules (auth, users, connections, jobs, applications)
│   └── [module]/
│       ├── *.router.ts
│       ├── *.controller.ts
│       ├── *.service.ts
│       └── *.schemas.ts   # Zod validation
├── services/         # email, jobScraper, tokenService
├── types/            # Express augmentation, shared types
├── utils/            # asyncHandler, pagination, slugify
└── app.ts            # Express factory
```

---

## Environment Variables

See [.env.example](.env.example) for all variables.

**Required for core features:**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — at least 32 chars each

**Required for Google OAuth:**
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from Google Cloud Console

**Required for email:**
- `RESEND_API_KEY` — from resend.com

---

## Architecture Decisions

**Why Drizzle ORM?** Pure TypeScript schemas, SQL-like query builder, migration files are plain SQL you can inspect and commit. No magic binary.

**Why JWT cookies instead of sessions?** Stateless — no Redis needed for MVP. Access token (15 min) limits exposure window. Refresh token (7 days) auto-renews.

**Why local disk for CV storage?** Zero setup for dev. The `getCVPath()` function in `applications.service.ts` is the only place that touches the filesystem — swap it for an S3 pre-signed URL by changing ~5 lines.

**Connection required to apply:** Core product rule — CVs flow only through established relationships. Enforced in `applications.service.ts`, not just the frontend.
