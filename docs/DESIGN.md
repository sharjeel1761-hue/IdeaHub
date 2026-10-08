# IdeaHub DDUC: user flow and database design

> **Share an idea. Find a mistake. Improve it together.**
> A place for DDUC students to post unfinished ideas and help each other make them better.
> We criticise the idea, never the person.

## 1. Product principles

1. **Improvement beats popularity.** Most reputation comes from corrections that turn out to be right, not from likes. An upvote on an idea is worth +1 and stops counting after 10. A correction confirmed as correct is worth +25.
2. **Imperfect ideas are welcome.** You never lose points when someone corrects your idea. You *gain* points for accepting corrections (the "Open Mind" reward) and when your idea becomes Verified.
3. **Nobody is penalised for a wrong correction.** A correction marked "Incorrect" earns 0, never negative. That keeps people willing to speak up.
4. **Credit is permanent and visible.** Every version of an idea records who wrote it and whose corrections went into it. "Original idea by A · Improved by B, C" shows on the card and the idea page.
5. **One verdict can't be bought.** A correction is accepted only by the author, a moderator, or a community quorum (3 matching verdicts from students with at least 30 reputation). Upvotes alone never accept a correction.

## 2. Roles

| Role | Can do |
|---|---|
| Visitor (logged out) | Read ideas, corrections, history, profiles, leaderboards |
| Student | Everything a visitor can, plus post ideas, challenge ideas, comment, vote, report, join Idea Labs |
| Reviewer (student with 30+ reputation) | Also casts community verdicts on corrections |
| Idea author | Gives the final verdict on corrections to their own idea, publishes new versions, marks comments helpful, opens or closes the Lab |
| Moderator | Final verdict on any correction, handles reports, hides content, can mark an idea Verified |

## 3. User flows

### 3.1 Join
`Log-in page (the site opens only after signing in) → Create account (unique username, name, password + confirm, course, year, interests) → Home feed`

`Next visit → Log in with the same username and password → back to the page they were going to`

Usernames are unique ignoring case; passwords don't need to be unique. The signup form shows the community pledge ("I'll criticise ideas, not people") as a required checkbox. "Keep me logged in on this device" is optional; without it the session ends when the browser closes.

### 3.2 Share an idea
`New idea → title, category, type (Idea / Unsolved problem), difficulty, body (Markdown + LaTeX math + code), optional image links and sources → live preview → similarity check ("3 similar ideas exist, take a look") → Publish`

* The idea starts as **Open for discussion**, version 1.
* The "Sources / inspiration" field and the similarity check discourage plagiarism.
* The author can tick **"I know this is unfinished, please help"**, which puts it in the *Needs review* feed.

### 3.3 Challenge an idea (the core loop)
`Idea page → "Challenge this idea" → pick a type (Mathematical error / Logical error / Factual error / Missing information / Better approach / Alternative solution) → quote the exact part → explain why → suggest a fix → add evidence → civility check → Submit`

* The author is notified. The idea's status moves to **Improving** as soon as it has a pending correction.
* Others can upvote the correction as useful, reply in its own thread, and (if Reviewer) cast a verdict.

### 3.4 Verify a correction
```
pending ──author/moderator verdict──▶ correct | partial | incorrect | needs discussion   (final)
pending ──3 matching community verdicts──▶ same outcomes                                   (final)
```
* **Correct**: corrector gets +25 and their name is attached to the idea as a contributor.
* **Partially correct**: +10 and contributor credit.
* **Incorrect**: 0. The correction stays visible as part of the learning record.
* **Needs discussion**: stays open, discussion thread highlighted.
* Reviewers whose community verdict matched the final verdict get +2 each.

### 3.5 Improve and verify the idea
`Author clicks "Publish improved version" → edits the text → ticks which accepted corrections and Lab contributions went in → writes a change note → Version N+1`

* Each credited contributor gets +8 per version they're credited in; the author gets +5 for every correction they accepted ("Open Mind").
* The author or a moderator marks the idea **Solved / Verified** once there are no pending corrections. The author gets +20 and every credited contributor gets +10.

### 3.6 Idea Lab (collaborate instead of comment)
`Idea page → "Open Idea Lab" (author) → shared working draft that any student can edit, with an edit log + open questions list (claim / mark done) → author publishes the draft as the next version, crediting lab contributors`

### 3.7 History
`Idea page → History tab → timeline: v1 original → corrections (with verdicts) → discussion → v2 improved (credits) → Verified`, with a word-level diff between any two versions.

### 3.8 Recognition
* **Profile**: course/year, interests, level, reputation, streak, badges, ideas, corrections with outcomes, reputation history.
* **Leaderboard "Top Idea Improvers at DDUC"**: ranked by *improvement points only* (corrections, contributions, reviews), filterable by this week / all time / course.
* **Recognition wall**: top improvers with name, course and badges, plus "improvement stories" (before → correction → after).

### 3.9 Safety and moderation
* Pledge on signup, "Criticise the idea, not the person" reminder inside every correction and comment form.
* Civility check: text aimed at a person ("you are stupid", insults) is blocked with a request to rephrase.
* Report button on ideas, corrections and comments (bullying, harassment, plagiarism, spam, personal attack, other) → moderator queue → hide / dismiss.
* Rate limits against spam (ideas, corrections, comments per hour). No self-votes, no verdicts on your own corrections.

### 3.10 Gamification
* **Levels**: Curious (0) → Thinker (50) → Reviewer (150) → Improver (400) → Mentor (1000) → Sage (2500).
* **Streaks**: consecutive days with a meaningful action (idea, correction, comment, verdict, lab edit).
* **Weekly challenge**: a prompt each week ("Find the flaw", "Fix a campus problem"). Ideas can be submitted to it.
* **Badges**: First Spark, First Contributor, Problem Finder, Idea Improver, Helpful Reviewer, Mathematics Mentor, Physics Mentor, Code Doctor, Open Mind, Verified Thinker, Lab Partner, On a Roll, Top Contributor.

## 4. Reputation table

| Action | Points | Who |
|---|---|---|
| Correction verified **Correct** | +25 | corrector |
| Correction verified **Partially correct** | +10 | corrector |
| Credited in a new version | +8 | contributor |
| Idea reaches **Verified** | +20 / +10 | author / each contributor |
| Accepting a correction (Correct/Partial) | +5 | idea author |
| Comment marked helpful by the author | +5 | commenter |
| Community verdict matched the final one | +2 | reviewer |
| Upvote on a correction (max 10 counted) | +2 | corrector |
| Upvote on an idea (max 10 counted) | +1 | author |
| Posting an idea (first 3 per day) | +2 | author |
| Lab edit published in a version | (covered by "credited in a new version") | |

The ledger (`reputation_events`) keeps every change, so reputation can always be recomputed and explained on the profile.

## 5. Database

SQLite, file `data/ideahub.db`. Schema lives in `src/schema.sql`.

```
users ─┬─< ideas ─┬─< idea_versions
       │          ├─< corrections ─┬─< verdicts
       │          │                └─< comments (correction thread)
       │          ├─< comments (idea discussion, nested via parent_id)
       │          ├─< lab_edits
       │          └─< lab_tasks
       ├─< votes            (target_type + target_id: idea | correction | comment)
       ├─< reputation_events
       ├─< user_badges
       ├─< notifications
       ├─< reports
       └─< sessions
weekly_challenges ─< ideas (challenge_id)
```

| Table | Key columns |
|---|---|
| `users` | id, username (unique, case-insensitive), name, email (optional), password_hash, course, year, bio, interests (JSON), role (`student`/`moderator`), reputation, streak, last_active_day, created_at |
| `sessions` | token (PK), user_id, created_at |
| `ideas` | id, author_id, title, body, category, kind (`idea`/`problem`), difficulty, status (`open`/`improving`/`verified`), needs_help, lab_open, lab_draft, current_version, challenge_id, sources, images (JSON), hidden, created_at, updated_at, verified_at |
| `idea_versions` | id, idea_id, version, title, body, change_note, editor_id, credited_user_ids (JSON), credited_correction_ids (JSON), created_at |
| `corrections` | id, idea_id, author_id, type, quote, explanation, suggestion, evidence, status (`pending`/`correct`/`partial`/`incorrect`/`discussion`), decided_by, decided_via (`author`/`moderator`/`community`), decision_note, applied_in_version, hidden, created_at, decided_at |
| `verdicts` | id, correction_id, user_id, verdict, created_at · unique(correction_id, user_id) |
| `comments` | id, idea_id, correction_id (nullable), parent_id (nullable), author_id, body, helpful, hidden, created_at |
| `votes` | id, user_id, target_type, target_id, created_at · unique(user_id, target_type, target_id) |
| `reputation_events` | id, user_id, points, reason, kind (`improvement`/`quality`/`activity`), idea_id, created_at |
| `user_badges` | id, user_id, badge, awarded_at · unique(user_id, badge) |
| `lab_edits` | id, idea_id, editor_id, body, note, created_at |
| `lab_tasks` | id, idea_id, text, created_by, claimed_by, done, created_at |
| `notifications` | id, user_id, text, link, read, created_at |
| `reports` | id, reporter_id, target_type, target_id, reason, details, status (`open`/`hidden`/`dismissed`), resolved_by, created_at |
| `weekly_challenges` | id, title, prompt, category, starts_on, ends_on |

Categories, course list, badge definitions and level thresholds are constants in `src/core.js` so they can change without a migration.

## 6. Architecture

```
public/  index.html · app.js · styles.css      single-page app (hash routes, no build step)
src/     core.js     all business rules + API router, runs in Node *and* the browser
         schema.sql  database schema
         seed.js     demo data, created by calling the same core functions
server.js            Node 22 HTTP server: static files, auth (scrypt + session cookie), SQLite
build-demo.js        bundles everything into one HTML file that runs entirely in the browser
```

`core.js` holds every rule (reputation, badges, verdict quorum, civility check, rate limits) once. The server and the in-browser demo call the same router, so the demo behaves exactly like the real site.
