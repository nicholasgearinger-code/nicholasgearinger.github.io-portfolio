# Portfolio Backend

A small, **dependency-free** Node.js backend (Node 18+) for the portfolio. It
serves the static site and a practical JSON API. All state lives in flat JSON
files under `data/` — there's no database to run. Optional email, chat-webhook,
and AI features turn on only when you set their environment variables.

## Run it

```bash
cd backend
cp .env.example .env        # optional — everything has sane defaults
node server.js              # or: npm start   /   npm run dev (auto-reload)
```

By default it serves `portfolio.html` from the parent folder (or `./public`)
and listens on <http://localhost:3000>. No `npm install` required.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Status + which features are enabled |
| GET | `/api/status` | Availability badge ("open to work") |
| POST | `/api/status` 🔒 | Update availability |
| POST | `/api/contact` | Contact-form submissions (validated, rate-limited, honeypot) |
| GET | `/api/messages` 🔒 | List received messages |
| PATCH | `/api/messages/:id/read` 🔒 | Mark a message read |
| DELETE | `/api/messages/:id` 🔒 | Delete a message |
| GET | `/api/views` | Read the page-view counter |
| POST | `/api/views` | Increment the counter (throttled per visitor) |
| POST | `/api/subscribe` | Newsletter sign-up (de-duplicated) |
| POST | `/api/track` | Record an analytics event `{ type, path, meta }` |
| GET | `/api/analytics` 🔒 | Aggregated summary (unique visitors, top paths, referrers, daily) |
| GET | `/api/guestbook` | Approved guestbook entries |
| POST | `/api/guestbook` | Sign the guestbook (held for approval by default) |
| PATCH | `/api/guestbook/:id` 🔒 | Approve an entry |
| DELETE | `/api/guestbook/:id` 🔒 | Delete an entry |
| GET | `/api/projects` | Projects + clap counts |
| GET | `/api/projects/:id` | A single project |
| POST | `/api/projects/:id/clap` | Clap for a project (max 10/visitor/hr) |
| POST | `/api/ask` | Ask the profile-grounded AI assistant `{ question }` |
| GET | `/api/vcard` | Download a `.vcf` contact card |
| GET | `/api/resume` | Structured JSON résumé |
| GET | `/robots.txt`, `/sitemap.xml` | SEO |

🔒 = requires the `X-Admin-Token` header matching `ADMIN_TOKEN`.

## Examples

```bash
# Contact form
curl -X POST localhost:3000/api/contact -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","message":"Love the site!"}'

# Ask the assistant
curl -X POST localhost:3000/api/ask -H 'Content-Type: application/json' \
  -d '{"question":"What are Nicholas'\''s main skills?"}'

# Admin: read messages
curl localhost:3000/api/messages -H "X-Admin-Token: $ADMIN_TOKEN"
```

## Security notes

- Input is validated and length-capped; JSON bodies are size-limited (32 KB).
- Per-IP sliding-window rate limits on every write endpoint.
- Honeypot fields on contact / subscribe / guestbook drop most bots.
- Static serving is path-traversal-safe.
- Analytics stores a **hashed** visitor id, never the raw IP.
- API keys (Resend, Anthropic) stay server-side and are never sent to the browser.

## Editing content

Your bio, education, experience, skills, socials, and the projects list live in
[`lib/config.js`](lib/config.js) (`PROFILE` and `PROJECTS`). They power `/api/ask`,
`/api/vcard`, `/api/resume`, `/api/projects`, and SEO. Update them there.

## Deploying

- **Any Node host** (Railway, Render, Fly, a VPS): `node server.js` behind a
  reverse proxy. Set env vars from `.env.example`.
- **Serverless** (Vercel/Netlify): each `routes/*` handler is small and pure —
  wrap the ones you need as individual functions and point them at the same
  flat-file logic or swap `lib/store.js` for a KV/Redis provider.
