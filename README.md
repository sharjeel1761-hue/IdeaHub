# IdeaHub DDUC

**Share an idea. Find a mistake. Improve it together.**

A peer-review website for students of Deen Dayal Upadhyaya College (University of Delhi). Students post unfinished ideas, others challenge them with specific corrections, and when a correction is verified the student who found it gets reputation and is credited on the improved version.

The full user flow and database design are in [docs/DESIGN.md](docs/DESIGN.md).

## Run it

Needs **Node.js 22 or newer**. Running it on your own computer needs no `npm install`; the only package (`@libsql/client`) is for the hosted Turso database used when the site is online.

```bash
node server.js
# open http://localhost:3000
```

On first start it creates `data/ideahub.db` (SQLite) and fills it with sample ideas from fictional students.

The site opens only after signing in. New students click **Create account**, pick a unique username (3 to 20 letters, numbers, dots or underscores; uniqueness ignores upper/lower case) and a password (at least 6 characters, does not need to be unique). After that they log in with that username and password. "Keep me logged in on this device" is optional; without it the session ends when the browser closes.

For testing, the sample accounts use password `dduc1234` (usernames such as `priya`, `aarav`, and `neha` for the moderator view).

| Setting | Meaning |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `DB_PATH` | Database file (default `data/ideahub.db`) |
| `SEED=0` | Start with an empty database (no sample ideas) |
| `MODERATORS` | Comma-separated usernames that get the moderator role, e.g. `sharjeel` |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Keep all data in a hosted Turso database instead of the local file (needs `npm install`) |

## Put it online

See [DEPLOY.md](DEPLOY.md) for free hosting on Render with a free Turso database.

To start over, stop the server and delete `data/ideahub.db`.

## Browser-only demo

```bash
node build-demo.js
```

Writes `dist/ideahub-demo.html`, one file that runs the whole site in the browser (same rules engine, data kept in `localStorage`). That is what the shared preview link runs.

## What's inside

```
server.js          HTTP server: static files, JSON API, username + password auth (scrypt hashes, HttpOnly session cookie), SQLite
src/core.js        Every rule: reputation, badges, verdicts and quorum, civility check, rate limits, feeds, search
src/schema.sql     Database tables
src/seed.js        Demo students, ideas, corrections, versions and Lab activity (created through the real API)
src/demo.js        In-browser backend used by the demo build
public/            The single-page app (index.html, app.js, styles.css, vendor/ libraries)
docs/DESIGN.md     User flow, reputation table, database design
```

## Features

* Student profiles with course, year, interests, level, reputation, streak, badges, ideas, corrections and full reputation history
* Ideas with category, type (idea or unsolved problem), difficulty, Markdown, code, LaTeX maths, image links and sources
* "Challenge this idea" with six challenge types, quoted text, explanation, suggested fix and evidence
* Verification: the author or a moderator gives a final verdict, or 3 reviewers (30+ reputation) agree. Correct, Partially correct, Incorrect, Needs discussion
* Versioned ideas: publish an improved version and credit the corrections and Lab contributors used; full history timeline and word-level diff between versions
* Idea Lab: shared editable draft, open-questions list with claim/done, credit on publish
* Discussion threads under ideas and under each correction, "helpful" marks from the author
* Upvotes on ideas, corrections and comments (deliberately worth few points)
* Discovery: trending, new, needs review, recently corrected, best (verified), unsolved problems, top improvers, weekly challenge
* Search and filters by subject/category, course, year, difficulty, status, type; sort by most discussed, most improved, trending
* Leaderboard "Top Idea Improvers at DDUC" (week / month / all time, by course) and a Recognition wall with improvement stories
* Safety: community pledge at sign-up, civility check that blocks personal attacks, reports with a moderator queue, auto-hide after 3 reports, rate limits, no self-votes or self-verdicts, similar-idea warning to discourage plagiarism
* Responsive layout with a bottom tab bar on phones, light and dark themes

## Going further

The store keeps all rows in memory and writes every change through to SQLite, which is fine for a college-sized community (thousands of ideas). For a much larger deployment, move the read queries in `src/core.js` to SQL.
