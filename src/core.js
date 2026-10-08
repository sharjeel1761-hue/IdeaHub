/*
 * IdeaHub core: every business rule and the JSON API router.
 * Runs unchanged in Node (server.js, backed by SQLite) and in the browser (demo build, backed by localStorage).
 * The store keeps rows in memory; an adapter mirrors every write to durable storage.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IdeaHubCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────── constants ─────────────────────────

  const TABLES = ['users', 'sessions', 'weekly_challenges', 'ideas', 'idea_versions', 'corrections', 'verdicts',
    'comments', 'votes', 'reputation_events', 'user_badges', 'lab_edits', 'lab_tasks', 'notifications', 'reports'];
  const JSON_COLS = { users: ['interests'], ideas: ['images'], idea_versions: ['credited_user_ids', 'credited_correction_ids'] };

  const CATEGORIES = [
    { slug: 'mathematics', name: 'Mathematics', icon: '∑' },
    { slug: 'physics', name: 'Physics', icon: '⚛' },
    { slug: 'computer-science', name: 'Computer Science', icon: '⌘' },
    { slug: 'programming', name: 'Programming', icon: '</>' },
    { slug: 'electronics', name: 'Electronics', icon: '⚡' },
    { slug: 'research', name: 'Research', icon: '🔬' },
    { slug: 'robotics', name: 'Robotics', icon: '🤖' },
    { slug: 'business', name: 'Business', icon: '📈' },
    { slug: 'startups', name: 'Startups', icon: '🚀' },
    { slug: 'environment', name: 'Environment', icon: '🌱' },
    { slug: 'social', name: 'Social Problems', icon: '🤝' },
    { slug: 'campus', name: 'Campus Life', icon: '🏫' },
    { slug: 'general', name: 'General Ideas', icon: '💡' },
  ];
  const CATEGORY_SLUGS = CATEGORIES.map(c => c.slug);

  const COURSES = [
    'B.Sc. (H) Computer Science', 'B.Sc. (H) Mathematics', 'B.Sc. (H) Physics', 'B.Sc. (H) Electronics',
    'B.Sc. (H) Chemistry', 'B.Sc. (H) Biomedical Science', 'B.Sc. Physical Science', 'B.Sc. Mathematical Sciences',
    'B.A. (H) Economics', 'B.A. Programme', 'B.Com (H)', 'B.Com', 'BMS', 'Other',
  ];

  const CORRECTION_TYPES = {
    math: { label: 'Mathematical error', short: 'Math error', icon: '∑' },
    logic: { label: 'Logical error', short: 'Logic error', icon: '⇄' },
    fact: { label: 'Factual error', short: 'Factual error', icon: '📚' },
    missing: { label: 'Missing information', short: 'Missing info', icon: '🧩' },
    better: { label: 'Better approach', short: 'Better approach', icon: '✨' },
    alternative: { label: 'Alternative solution', short: 'Alternative', icon: '🔀' },
  };

  const VERDICTS = {
    correct: 'Correct', partial: 'Partially correct', incorrect: 'Incorrect', discussion: 'Needs discussion',
  };

  const IDEA_STATUS = { open: 'Open for discussion', improving: 'Improving', verified: 'Solved / Verified' };
  const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
  const REPORT_REASONS = {
    bullying: 'Bullying', harassment: 'Harassment', plagiarism: 'Plagiarism', spam: 'Spam',
    personal_attack: 'Personal attack', other: 'Something else',
  };

  const LEVELS = [
    { name: 'Curious', min: 0 }, { name: 'Thinker', min: 50 }, { name: 'Reviewer', min: 150 },
    { name: 'Improver', min: 400 }, { name: 'Mentor', min: 1000 }, { name: 'Sage', min: 2500 },
  ];

  const POINTS = {
    correctionCorrect: 25, correctionPartial: 10, credited: 8, verifiedAuthor: 20, verifiedContributor: 10,
    acceptCorrection: 5, helpfulComment: 5, matchedVerdict: 2, correctionUpvote: 2, ideaUpvote: 1,
    postIdea: 2, upvoteCap: 10, postIdeaDailyCap: 3,
  };
  const REVIEWER_MIN_REP = 30;
  const QUORUM = 3;
  const AUTO_HIDE_REPORTS = 3;

  const BADGES = {
    first_spark: { name: 'First Spark', icon: '💡', desc: 'Shared a first idea' },
    first_contributor: { name: 'First Contributor', icon: '🌱', desc: 'Submitted a first correction' },
    problem_finder: { name: 'Problem Finder', icon: '🔍', desc: 'Found a mistake that was verified as correct' },
    idea_improver: { name: 'Idea Improver', icon: '🛠️', desc: '5 corrections accepted as correct or partially correct' },
    helpful_reviewer: { name: 'Helpful Reviewer', icon: '🤝', desc: '5 helpful explanations or accurate community verdicts' },
    math_mentor: { name: 'Mathematics Mentor', icon: '∑', desc: '3 correct corrections on Mathematics ideas' },
    physics_mentor: { name: 'Physics Mentor', icon: '⚛', desc: '3 correct corrections on Physics ideas' },
    code_doctor: { name: 'Code Doctor', icon: '🩺', desc: '3 correct corrections on Computer Science or Programming ideas' },
    open_mind: { name: 'Open Mind', icon: '🧠', desc: 'Accepted 3 corrections on own ideas' },
    verified_thinker: { name: 'Verified Thinker', icon: '✅', desc: 'An idea reached Solved / Verified' },
    lab_partner: { name: 'Lab Partner', icon: '🧪', desc: 'Helped build someone else\'s idea in the Idea Lab' },
    on_a_roll: { name: 'On a Roll', icon: '🔥', desc: 'A 7-day contribution streak' },
    top_contributor: { name: 'Top Contributor', icon: '🏆', desc: 'Reached the top 3 Idea Improvers at DDUC' },
  };

  const STOPWORDS = new Set(('the and for that this with from have will would could should their there about which when what into ' +
    'than then them they your more most some such also been being each other only over very just like using use idea ideas ' +
    'because these those where while does make made can not are was were has its our out how why who').split(' '));

  // ───────────────────────── store ─────────────────────────

  function createStore(adapter) {
    const tables = {}, index = {}, seq = {};
    for (const t of TABLES) { tables[t] = []; index[t] = new Map(); seq[t] = 0; }
    const store = {
      adapter: adapter || null,
      tables,
      load(table, rows) {
        for (const r of rows) {
          for (const c of JSON_COLS[table] || []) if (typeof r[c] === 'string') r[c] = JSON.parse(r[c]);
          tables[table].push(r); index[table].set(r.id, r); if (r.id > seq[table]) seq[table] = r.id;
        }
      },
      reset() { for (const t of TABLES) { tables[t] = []; index[t] = new Map(); seq[t] = 0; } store.tables = tables; },
      all(table) { return tables[table]; },
      get(table, id) { return index[table].get(Number(id)) || null; },
      insert(table, row) {
        row.id = ++seq[table];
        tables[table].push(row); index[table].set(row.id, row);
        if (store.adapter) store.adapter.insert(table, row);
        return row;
      },
      update(table, id, patch) {
        const row = store.get(table, id);
        if (!row) return null;
        Object.assign(row, patch);
        if (store.adapter) store.adapter.update(table, row.id, patch);
        return row;
      },
      remove(table, id) {
        const row = store.get(table, id);
        if (!row) return;
        tables[table].splice(tables[table].indexOf(row), 1); index[table].delete(row.id);
        if (store.adapter) store.adapter.remove(table, row.id);
      },
      snapshot() { const o = {}; for (const t of TABLES) o[t] = tables[t]; return o; },
    };
    return store;
  }

  // ───────────────────────── helpers ─────────────────────────

  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const fail = (status, message) => { throw new ApiError(status, message); };
  const str = (v, max = 20000) => (v == null ? '' : String(v)).trim().slice(0, max);
  const dayOf = iso => iso.slice(0, 10);
  const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
  const where = (s, table, fn) => s.all(table).filter(fn);
  const count = (s, table, fn) => { let n = 0; for (const r of s.all(table)) if (fn(r)) n++; return n; };

  function levelFor(rep) {
    let i = 0;
    while (i + 1 < LEVELS.length && rep >= LEVELS[i + 1].min) i++;
    const next = LEVELS[i + 1];
    return {
      index: i + 1, name: LEVELS[i].name, min: LEVELS[i].min, next: next ? next.name : null, nextAt: next ? next.min : null,
      progress: next ? Math.round(100 * (rep - LEVELS[i].min) / (next.min - LEVELS[i].min)) : 100,
    };
  }

  function publicUser(s, u) {
    if (!u) return null;
    const badges = where(s, 'user_badges', b => b.user_id === u.id).map(b => b.badge);
    return {
      id: u.id, name: u.name, username: u.username, course: u.course, year: u.year, role: u.role, reputation: u.reputation,
      level: levelFor(u.reputation), streak: u.streak, badges,
    };
  }

  function requireUser(ctx) {
    const u = ctx.userId ? ctx.store.get('users', ctx.userId) : null;
    if (!u) fail(401, 'Please log in first.');
    return u;
  }
  const isMod = u => !!u && u.role === 'moderator';

  // "Criticise the idea, not the person."
  const ALWAYS_BLOCK = /\b(idiot|idiotic|moron|retard\w*|dumbass|imbecile|loser|clown|chutiya\w*|bewakoof|gadha|pagal)\b/i;
  const AT_PERSON = /\b(you|u|ur|you're|youre|youre|author|op|poster|he|she|they)\b[^.!?\n]{0,30}\b(stupid|dumb|useless|worthless|pathetic|brainless|joke|ignorant|clueless|embarrassing|shameful)\b/i;
  const MOCKING = /\b(what a joke|lol+ ?what|are you serious|go back to school|did you even|how can someone be this)\b/i;
  function civility(...texts) {
    const t = texts.join('\n');
    if (ALWAYS_BLOCK.test(t) || AT_PERSON.test(t) || MOCKING.test(t)) {
      fail(422, 'This reads like it is aimed at a person rather than the idea. Please rephrase: criticise the idea, not the person.');
    }
  }

  function rateLimit(ctx, user, table, ownerField, max, label) {
    if (isMod(user)) return;
    const n = count(ctx.store, table, r => r[ownerField] === user.id && hoursBetween(r.created_at, ctx.now) < 1);
    if (n >= max) fail(429, `You can post up to ${max} ${label} per hour. Please take a short break and come back.`);
  }

  function addRep(ctx, userId, points, reason, kind, ideaId) {
    if (!points) return;
    const s = ctx.store;
    s.insert('reputation_events', { user_id: userId, points, reason, kind, idea_id: ideaId || null, created_at: ctx.now });
    const u = s.get('users', userId);
    s.update('users', userId, { reputation: Math.max(0, u.reputation + points) });
  }

  function notify(ctx, userId, text, link) {
    if (!userId || userId === ctx.userId) return;
    ctx.store.insert('notifications', { user_id: userId, text, link: link || '', read: 0, created_at: ctx.now });
  }

  function touchStreak(ctx, user) {
    const today = dayOf(ctx.now);
    if (user.last_active_day === today) return;
    const streak = user.last_active_day === addDays(today, -1) ? user.streak + 1 : 1;
    ctx.store.update('users', user.id, { streak, best_streak: Math.max(streak, user.best_streak || 0), last_active_day: today });
  }

  function improvementPoints(s, sinceIso) {
    const m = new Map();
    for (const e of s.all('reputation_events')) {
      if (e.kind !== 'improvement' || (sinceIso && e.created_at < sinceIso)) continue;
      m.set(e.user_id, (m.get(e.user_id) || 0) + e.points);
    }
    return m;
  }

  function checkBadges(ctx, userId) {
    const s = ctx.store;
    const u = s.get('users', userId);
    if (!u) return;
    const have = new Set(where(s, 'user_badges', b => b.user_id === userId).map(b => b.badge));
    const ideaCat = id => (s.get('ideas', id) || {}).category;
    const myCorr = where(s, 'corrections', c => c.author_id === userId);
    const correct = myCorr.filter(c => c.status === 'correct');
    const accepted = myCorr.filter(c => c.status === 'correct' || c.status === 'partial');
    const myIdeaIds = new Set(where(s, 'ideas', i => i.author_id === userId).map(i => i.id));
    const matched = count(s, 'reputation_events', e => e.user_id === userId && e.reason.startsWith('Accurate review'));
    const helpful = count(s, 'comments', c => c.author_id === userId && c.helpful);
    const top = [...improvementPoints(s).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const earned = {
      first_spark: myIdeaIds.size >= 1,
      first_contributor: myCorr.length >= 1,
      problem_finder: correct.length >= 1,
      idea_improver: accepted.length >= 5,
      helpful_reviewer: matched + helpful >= 5,
      math_mentor: correct.filter(c => ideaCat(c.idea_id) === 'mathematics').length >= 3,
      physics_mentor: correct.filter(c => ideaCat(c.idea_id) === 'physics').length >= 3,
      code_doctor: correct.filter(c => ['computer-science', 'programming'].includes(ideaCat(c.idea_id))).length >= 3,
      open_mind: count(s, 'corrections', c => myIdeaIds.has(c.idea_id) && (c.status === 'correct' || c.status === 'partial')) >= 3,
      verified_thinker: count(s, 'ideas', i => i.author_id === userId && i.status === 'verified') >= 1,
      lab_partner: count(s, 'lab_edits', e => e.editor_id === userId && !myIdeaIds.has(e.idea_id)) >= 1,
      on_a_roll: (u.best_streak || 0) >= 7,
      top_contributor: top.some(([id, pts]) => id === userId && pts >= 100),
    };
    for (const [badge, ok] of Object.entries(earned)) {
      if (ok && !have.has(badge)) {
        s.insert('user_badges', { user_id: userId, badge, awarded_at: ctx.now });
        if (userId !== ctx.userId) notify(ctx, userId, `You earned the ${BADGES[badge].name} badge ${BADGES[badge].icon}`, `#/u/${userId}`);
        else ctx.store.insert('notifications', { user_id: userId, text: `You earned the ${BADGES[badge].name} badge ${BADGES[badge].icon}`, link: `#/u/${userId}`, read: 0, created_at: ctx.now });
      }
    }
  }

  function tokens(text) {
    return new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w)));
  }
  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0; for (const w of a) if (b.has(w)) inter++;
    return inter / (a.size + b.size - inter);
  }

  // ───────────────────────── idea views ─────────────────────────

  function stats(s) {
    const st = { votes: new Map(), corr: new Map(), accepted: new Map(), pending: new Map(), comments: new Map(), recent: new Map() };
    const inc = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
    for (const v of s.all('votes')) inc(st.votes, v.target_type + ':' + v.target_id);
    for (const c of s.all('corrections')) {
      if (c.hidden) continue;
      inc(st.corr, c.idea_id);
      if (c.status === 'correct' || c.status === 'partial') inc(st.accepted, c.idea_id);
      if (c.status === 'pending' || c.status === 'discussion') inc(st.pending, c.idea_id);
    }
    for (const c of s.all('comments')) if (!c.hidden) inc(st.comments, c.idea_id);
    return st;
  }

  function contributorsOf(s, idea) {
    const ids = new Set();
    for (const c of s.all('corrections')) {
      if (c.idea_id === idea.id && !c.hidden && (c.status === 'correct' || c.status === 'partial')) ids.add(c.author_id);
    }
    for (const v of s.all('idea_versions')) if (v.idea_id === idea.id) for (const id of v.credited_user_ids) ids.add(id);
    ids.delete(idea.author_id);
    return [...ids];
  }

  function trendScore(s, idea, st, now) {
    const since = new Date(Date.parse(now) - 7 * 864e5).toISOString();
    let act = 0;
    for (const v of s.all('votes')) if (v.target_type === 'idea' && v.target_id === idea.id && v.created_at >= since) act += 1;
    for (const c of s.all('corrections')) if (c.idea_id === idea.id && c.created_at >= since) act += 3;
    for (const c of s.all('comments')) if (c.idea_id === idea.id && c.created_at >= since) act += 1;
    const age = Math.max(0, hoursBetween(idea.updated_at, now));
    return (act + (st.votes.get('idea:' + idea.id) || 0) * 0.2) / Math.pow(age / 24 + 1, 0.8);
  }

  function ideaCard(ctx, idea, st) {
    const s = ctx.store;
    st = st || stats(s);
    const excerpt = idea.body.replace(/```[\s\S]*?```/g, ' [code] ').replace(/\$\$[\s\S]*?\$\$/g, ' [equation] ').replace(/\$[^$\n]+\$/g, ' [math] ')
      .replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
    return {
      id: idea.id, title: idea.title, excerpt, category: idea.category, kind: idea.kind, difficulty: idea.difficulty,
      status: idea.status, needs_help: !!idea.needs_help, lab_open: !!idea.lab_open, hidden: !!idea.hidden,
      version: idea.current_version, created_at: idea.created_at, updated_at: idea.updated_at, challenge_id: idea.challenge_id,
      author: publicUser(s, s.get('users', idea.author_id)),
      contributors: contributorsOf(s, idea).map(id => publicUser(s, s.get('users', id))),
      votes: st.votes.get('idea:' + idea.id) || 0,
      voted: !!ctx.userId && s.all('votes').some(v => v.user_id === ctx.userId && v.target_type === 'idea' && v.target_id === idea.id),
      corrections: st.corr.get(idea.id) || 0, accepted: st.accepted.get(idea.id) || 0,
      pending: st.pending.get(idea.id) || 0, comments: st.comments.get(idea.id) || 0,
    };
  }

  function visibleIdeas(ctx) {
    const me = ctx.userId ? ctx.store.get('users', ctx.userId) : null;
    return ctx.store.all('ideas').filter(i => !i.hidden || isMod(me) || i.author_id === ctx.userId);
  }

  function recomputeIdeaStatus(ctx, idea) {
    if (idea.status === 'verified') return;
    const s = ctx.store;
    const unresolved = count(s, 'corrections', c => c.idea_id === idea.id && !c.hidden &&
      (c.status === 'pending' || c.status === 'discussion' || ((c.status === 'correct' || c.status === 'partial') && !c.applied_in_version)));
    const status = unresolved > 0 || idea.lab_open ? 'improving' : 'open';
    if (status !== idea.status) s.update('ideas', idea.id, { status });
  }

  function myVote(s, uid, type, id) {
    return !!uid && s.all('votes').some(v => v.user_id === uid && v.target_type === type && v.target_id === id);
  }

  function commentView(ctx, c) {
    const s = ctx.store;
    const me = ctx.userId ? s.get('users', ctx.userId) : null;
    const hide = c.hidden && !isMod(me);
    return {
      id: c.id, parent_id: c.parent_id, correction_id: c.correction_id, created_at: c.created_at, helpful: !!c.helpful,
      hidden: !!c.hidden, body: hide ? '' : c.body, author: hide ? null : publicUser(s, s.get('users', c.author_id)),
      votes: count(s, 'votes', v => v.target_type === 'comment' && v.target_id === c.id), voted: myVote(s, ctx.userId, 'comment', c.id),
    };
  }

  function ideaDetail(ctx, idea) {
    const s = ctx.store;
    const me = ctx.userId ? s.get('users', ctx.userId) : null;
    const st = stats(s);
    const card = ideaCard(ctx, idea, st);
    const isAuthor = !!me && me.id === idea.author_id;
    const versions = where(s, 'idea_versions', v => v.idea_id === idea.id).sort((a, b) => a.version - b.version).map(v => ({
      version: v.version, title: v.title, body: v.body, change_note: v.change_note, created_at: v.created_at,
      editor: publicUser(s, s.get('users', v.editor_id)),
      credited: v.credited_user_ids.map(id => publicUser(s, s.get('users', id))),
      credited_correction_ids: v.credited_correction_ids,
    }));
    const comments = where(s, 'comments', c => c.idea_id === idea.id).sort((a, b) => a.created_at < b.created_at ? -1 : 1).map(c => commentView(ctx, c));
    const corrections = where(s, 'corrections', c => c.idea_id === idea.id).map(c => {
      const vs = where(s, 'verdicts', v => v.correction_id === c.id);
      const tally = { correct: 0, partial: 0, incorrect: 0, discussion: 0 };
      for (const v of vs) tally[v.verdict]++;
      const hide = c.hidden && !isMod(me);
      return {
        id: c.id, type: c.type, status: c.status, created_at: c.created_at, decided_at: c.decided_at, decided_via: c.decided_via,
        decision_note: c.decision_note, applied_in_version: c.applied_in_version, hidden: !!c.hidden,
        quote: hide ? '' : c.quote, explanation: hide ? '' : c.explanation, suggestion: hide ? '' : c.suggestion, evidence: hide ? '' : c.evidence,
        author: hide ? null : publicUser(s, s.get('users', c.author_id)), decided_by: publicUser(s, s.get('users', c.decided_by)),
        votes: count(s, 'votes', v => v.target_type === 'correction' && v.target_id === c.id), voted: myVote(s, ctx.userId, 'correction', c.id),
        tally, my_verdict: (vs.find(v => v.user_id === ctx.userId) || {}).verdict || null,
        is_mine: !!me && c.author_id === me.id,
      };
    }).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    const labEdits = where(s, 'lab_edits', e => e.idea_id === idea.id).sort((a, b) => a.created_at < b.created_at ? 1 : -1)
      .map(e => ({ id: e.id, note: e.note, created_at: e.created_at, editor: publicUser(s, s.get('users', e.editor_id)) }));
    const labTasks = where(s, 'lab_tasks', t => t.idea_id === idea.id).map(t => ({
      id: t.id, text: t.text, done: !!t.done, created_at: t.created_at,
      created_by: publicUser(s, s.get('users', t.created_by)), claimed_by: publicUser(s, s.get('users', t.claimed_by)),
    }));
    const lastVersionAt = versions.length ? versions[versions.length - 1].created_at : idea.created_at;
    const labContributors = [...new Set(where(s, 'lab_edits', e => e.idea_id === idea.id && e.created_at > lastVersionAt && e.editor_id !== idea.author_id).map(e => e.editor_id))]
      .map(id => publicUser(s, s.get('users', id)));
    const challenge = idea.challenge_id ? s.get('weekly_challenges', idea.challenge_id) : null;
    return Object.assign(card, {
      body: idea.body, sources: idea.sources, images: idea.images, verified_at: idea.verified_at,
      versions, corrections, comments, challenge,
      lab: { open: !!idea.lab_open, draft: idea.lab_draft || idea.body, edits: labEdits, tasks: labTasks, pending_contributors: labContributors },
      can: {
        edit: isAuthor || isMod(me), verify: isAuthor || isMod(me), moderate: isMod(me),
        review: !!me && me.reputation >= REVIEWER_MIN_REP, act: !!me,
      },
      reviewer_min_rep: REVIEWER_MIN_REP, quorum: QUORUM,
    });
  }

  // ───────────────────────── actions ─────────────────────────

  function createIdea(ctx, b) {
    const s = ctx.store, u = requireUser(ctx);
    const title = str(b.title, 160), body = str(b.body, 20000);
    if (title.length < 6) fail(400, 'Give your idea a title of at least 6 characters.');
    if (body.length < 20) fail(400, 'Describe your idea in at least 20 characters. Unfinished is fine!');
    if (!CATEGORY_SLUGS.includes(b.category)) fail(400, 'Pick a category.');
    civility(title, body);
    rateLimit(ctx, u, 'ideas', 'author_id', 5, 'ideas');
    const images = (Array.isArray(b.images) ? b.images : []).map(x => str(x, 500)).filter(x => /^https?:\/\//.test(x)).slice(0, 6);
    const challenge = b.challenge_id ? s.get('weekly_challenges', b.challenge_id) : null;
    const idea = s.insert('ideas', {
      author_id: u.id, title, body, category: b.category, kind: b.kind === 'problem' ? 'problem' : 'idea',
      difficulty: DIFFICULTIES.includes(b.difficulty) ? b.difficulty : 'intermediate', status: 'open',
      needs_help: b.needs_help ? 1 : 0, lab_open: 0, lab_draft: null, current_version: 1,
      challenge_id: challenge ? challenge.id : null, sources: str(b.sources, 2000), images, hidden: 0,
      created_at: ctx.now, updated_at: ctx.now, verified_at: null,
    });
    s.insert('idea_versions', {
      idea_id: idea.id, version: 1, title, body, change_note: 'Original idea', editor_id: u.id,
      credited_user_ids: [], credited_correction_ids: [], created_at: ctx.now,
    });
    const today = count(s, 'ideas', i => i.author_id === u.id && dayOf(i.created_at) === dayOf(ctx.now));
    if (today <= POINTS.postIdeaDailyCap) addRep(ctx, u.id, POINTS.postIdea, `Shared "${title}"`, 'quality', idea.id);
    touchStreak(ctx, u);
    checkBadges(ctx, u.id);
    return { id: idea.id };
  }

  function getIdea(ctx, id) {
    const idea = ctx.store.get('ideas', id);
    const me = ctx.userId ? ctx.store.get('users', ctx.userId) : null;
    if (!idea || (idea.hidden && !isMod(me) && idea.author_id !== ctx.userId)) fail(404, 'That idea does not exist or was removed.');
    return idea;
  }

  function addVersion(ctx, id, b) {
    const s = ctx.store, u = requireUser(ctx), idea = getIdea(ctx, id);
    if (u.id !== idea.author_id && !isMod(u)) fail(403, 'Only the author can publish a new version.');
    const title = str(b.title, 160) || idea.title, body = str(b.body, 20000);
    if (body.length < 20) fail(400, 'The improved version needs a description.');
    civility(title, body);
    const corrIds = (Array.isArray(b.credited_correction_ids) ? b.credited_correction_ids : []).map(Number);
    const credited = new Set();
    const usedCorr = [];
    for (const cid of corrIds) {
      const c = s.get('corrections', cid);
      if (!c || c.idea_id !== idea.id) fail(400, 'One of the credited corrections does not belong to this idea.');
      if (c.status !== 'correct' && c.status !== 'partial') fail(400, 'Only corrections marked Correct or Partially correct can be credited.');
      usedCorr.push(c); credited.add(c.author_id);
    }
    if (b.credit_lab) {
      const prev = where(s, 'idea_versions', v => v.idea_id === idea.id).sort((a, b2) => b2.version - a.version)[0];
      for (const e of s.all('lab_edits')) if (e.idea_id === idea.id && e.created_at > prev.created_at) credited.add(e.editor_id);
    }
    credited.delete(idea.author_id);
    const version = idea.current_version + 1;
    const note = str(b.change_note, 1000) || 'Improved version';
    s.insert('idea_versions', {
      idea_id: idea.id, version, title, body, change_note: note, editor_id: u.id,
      credited_user_ids: [...credited], credited_correction_ids: usedCorr.map(c => c.id), created_at: ctx.now,
    });
    for (const c of usedCorr) if (!c.applied_in_version) s.update('corrections', c.id, { applied_in_version: version });
    s.update('ideas', idea.id, { title, body, current_version: version, updated_at: ctx.now, lab_draft: idea.lab_open ? body : idea.lab_draft });
    for (const uid of credited) {
      addRep(ctx, uid, POINTS.credited, `Credited in v${version} of "${title}"`, 'improvement', idea.id);
      notify(ctx, uid, `${u.name} credited you in version ${version} of "${title}" 🎉`, `#/idea/${idea.id}/history`);
      checkBadges(ctx, uid);
    }
    recomputeIdeaStatus(ctx, idea);
    touchStreak(ctx, u);
    return { version };
  }

  function setIdeaStatus(ctx, id, b) {
    const s = ctx.store, u = requireUser(ctx), idea = getIdea(ctx, id);
    if (u.id !== idea.author_id && !isMod(u)) fail(403, 'Only the author or a moderator can change the status.');
    if (b.status === 'verified') {
      const blockers = where(s, 'corrections', c => c.idea_id === idea.id && !c.hidden);
      if (blockers.some(c => c.status === 'pending' || c.status === 'discussion')) fail(409, 'Resolve the open corrections before marking this idea verified.');
      if (blockers.some(c => (c.status === 'correct' || c.status === 'partial') && !c.applied_in_version)) {
        fail(409, 'Publish an improved version that includes the accepted corrections first.');
      }
      s.update('ideas', idea.id, { status: 'verified', verified_at: ctx.now, lab_open: 0, updated_at: ctx.now });
      const already = s.all('reputation_events').some(e => e.idea_id === idea.id && e.reason.startsWith('Idea verified'));
      if (!already) {
        addRep(ctx, idea.author_id, POINTS.verifiedAuthor, `Idea verified: "${idea.title}"`, 'quality', idea.id);
        for (const uid of contributorsOf(s, idea)) {
          addRep(ctx, uid, POINTS.verifiedContributor, `Idea verified with your help: "${idea.title}"`, 'improvement', idea.id);
          notify(ctx, uid, `"${idea.title}" is now Verified, with your contribution credited ✅`, `#/idea/${idea.id}`);
          checkBadges(ctx, uid);
        }
      }
      notify(ctx, idea.author_id, `A moderator marked "${idea.title}" as Verified ✅`, `#/idea/${idea.id}`);
      checkBadges(ctx, idea.author_id);
    } else {
      s.update('ideas', idea.id, { status: 'open', verified_at: null, updated_at: ctx.now });
      recomputeIdeaStatus(ctx, s.get('ideas', idea.id));
    }
    return { status: s.get('ideas', idea.id).status };
  }

  function toggleVote(ctx, type, id) {
    const s = ctx.store, u = requireUser(ctx);
    const table = { idea: 'ideas', correction: 'corrections', comment: 'comments' }[type];
    const target = s.get(table, id);
    if (!target) fail(404, 'Not found.');
    const ownerId = target.author_id;
    if (ownerId === u.id) fail(400, 'You cannot upvote your own contribution.');
    const before = count(s, 'votes', v => v.target_type === type && v.target_id === target.id);
    const mine = s.all('votes').find(v => v.user_id === u.id && v.target_type === type && v.target_id === target.id);
    if (mine) s.remove('votes', mine.id);
    else s.insert('votes', { user_id: u.id, target_type: type, target_id: target.id, created_at: ctx.now });
    const after = before + (mine ? -1 : 1);
    const unit = type === 'correction' ? POINTS.correctionUpvote : type === 'idea' ? POINTS.ideaUpvote : 0;
    const delta = unit * (Math.min(after, POINTS.upvoteCap) - Math.min(before, POINTS.upvoteCap));
    if (delta) {
      const ideaId = type === 'idea' ? target.id : target.idea_id;
      addRep(ctx, ownerId, delta, type === 'idea' ? 'Upvotes on your idea' : 'Your correction was found useful', type === 'idea' ? 'quality' : 'improvement', ideaId);
    }
    return { votes: after, voted: !mine };
  }

  function createCorrection(ctx, ideaId, b) {
    const s = ctx.store, u = requireUser(ctx), idea = getIdea(ctx, ideaId);
    if (idea.author_id === u.id) fail(400, 'You cannot challenge your own idea. Publish an improved version instead.');
    if (!CORRECTION_TYPES[b.type]) fail(400, 'Choose what kind of problem you found.');
    const explanation = str(b.explanation, 8000);
    if (explanation.length < 15) fail(400, 'Explain why it is wrong or could be better (at least 15 characters).');
    const quote = str(b.quote, 2000), suggestion = str(b.suggestion, 8000), evidence = str(b.evidence, 8000);
    civility(quote, explanation, suggestion, evidence);
    rateLimit(ctx, u, 'corrections', 'author_id', 10, 'corrections');
    const c = s.insert('corrections', {
      idea_id: idea.id, author_id: u.id, type: b.type, quote, explanation, suggestion, evidence, status: 'pending',
      decided_by: null, decided_via: null, decision_note: '', applied_in_version: null, hidden: 0, created_at: ctx.now, decided_at: null,
    });
    s.update('ideas', idea.id, { updated_at: ctx.now });
    recomputeIdeaStatus(ctx, idea);
    notify(ctx, idea.author_id, `${u.name} challenged "${idea.title}": ${CORRECTION_TYPES[b.type].label}`, `#/idea/${idea.id}/corrections`);
    touchStreak(ctx, u);
    checkBadges(ctx, u.id);
    return { id: c.id };
  }

  function finalize(ctx, c, verdict, via, decider, note) {
    const s = ctx.store, idea = s.get('ideas', c.idea_id);
    s.update('corrections', c.id, { status: verdict, decided_by: decider ? decider.id : null, decided_via: via, decision_note: note, decided_at: ctx.now });
    const type = CORRECTION_TYPES[c.type].label.toLowerCase();
    if (verdict === 'correct' || verdict === 'partial') {
      const pts = verdict === 'correct' ? POINTS.correctionCorrect : POINTS.correctionPartial;
      addRep(ctx, c.author_id, pts, `${VERDICTS[verdict]}: ${type} on "${idea.title}"`, 'improvement', idea.id);
      addRep(ctx, idea.author_id, POINTS.acceptCorrection, `Accepted a correction on "${idea.title}" (Open Mind)`, 'quality', idea.id);
      if (idea.status === 'verified') {
        s.update('ideas', idea.id, { status: 'improving', verified_at: null });
        notify(ctx, idea.author_id, `A new correction on your verified idea "${idea.title}" was accepted, so it is back to Improving.`, `#/idea/${idea.id}/corrections`);
      }
    }
    const via_txt = via === 'community' ? 'the community' : via === 'moderator' ? 'a moderator' : 'the author';
    notify(ctx, c.author_id, `Your correction on "${idea.title}" was marked ${VERDICTS[verdict]} by ${via_txt}.`, `#/idea/${idea.id}/corrections`);
    if (verdict !== 'discussion') {
      for (const v of where(s, 'verdicts', v => v.correction_id === c.id)) {
        if (v.verdict === verdict) addRep(ctx, v.user_id, POINTS.matchedVerdict, `Accurate review on "${idea.title}"`, 'improvement', idea.id);
        checkBadges(ctx, v.user_id);
      }
    }
    recomputeIdeaStatus(ctx, s.get('ideas', idea.id));
    checkBadges(ctx, c.author_id);
    checkBadges(ctx, idea.author_id);
  }

  function castVerdict(ctx, corrId, b) {
    const s = ctx.store, u = requireUser(ctx);
    const c = s.get('corrections', corrId);
    if (!c) fail(404, 'Correction not found.');
    const idea = getIdea(ctx, c.idea_id);
    const verdict = b.verdict;
    if (!VERDICTS[verdict]) fail(400, 'Unknown verdict.');
    if (c.author_id === u.id) fail(403, 'You cannot judge your own correction.');
    if (c.status !== 'pending' && c.status !== 'discussion') fail(409, 'This correction has already been decided.');
    const note = str(b.note, 2000);
    civility(note);
    touchStreak(ctx, u);
    if (u.id === idea.author_id || isMod(u)) {
      finalize(ctx, c, verdict, u.id === idea.author_id ? 'author' : 'moderator', u, note);
      return { status: verdict, final: true };
    }
    if (u.reputation < REVIEWER_MIN_REP) fail(403, `Community verdicts unlock at ${REVIEWER_MIN_REP} reputation. Upvote the correction or join the discussion meanwhile.`);
    const existing = s.all('verdicts').find(v => v.correction_id === c.id && v.user_id === u.id);
    if (existing) s.update('verdicts', existing.id, { verdict, created_at: ctx.now });
    else s.insert('verdicts', { correction_id: c.id, user_id: u.id, verdict, created_at: ctx.now });
    const same = count(s, 'verdicts', v => v.correction_id === c.id && v.verdict === verdict);
    if (same >= QUORUM) {
      finalize(ctx, c, verdict, 'community', null, `${same} reviewers agreed`);
      return { status: verdict, final: true };
    }
    return { status: c.status, final: false, votes_for: same };
  }

  function createComment(ctx, ideaId, b) {
    const s = ctx.store, u = requireUser(ctx), idea = getIdea(ctx, ideaId);
    const body = str(b.body, 5000);
    if (body.length < 2) fail(400, 'Write something first.');
    civility(body);
    rateLimit(ctx, u, 'comments', 'author_id', 30, 'comments');
    let parent = null, corrId = null;
    if (b.parent_id) {
      parent = s.get('comments', b.parent_id);
      if (!parent || parent.idea_id !== idea.id) fail(400, 'Reply target not found.');
      corrId = parent.correction_id;
    }
    if (b.correction_id) {
      const c = s.get('corrections', b.correction_id);
      if (!c || c.idea_id !== idea.id) fail(400, 'Correction not found.');
      corrId = c.id;
    }
    const cm = s.insert('comments', {
      idea_id: idea.id, correction_id: corrId, parent_id: parent ? parent.id : null, author_id: u.id, body, helpful: 0, hidden: 0, created_at: ctx.now,
    });
    const tab = corrId ? 'corrections' : 'discussion';
    if (parent) notify(ctx, parent.author_id, `${u.name} replied to you on "${idea.title}"`, `#/idea/${idea.id}/${tab}`);
    if (corrId) notify(ctx, s.get('corrections', corrId).author_id, `${u.name} discussed your correction on "${idea.title}"`, `#/idea/${idea.id}/corrections`);
    if (!parent || parent.author_id !== idea.author_id) notify(ctx, idea.author_id, `${u.name} commented on "${idea.title}"`, `#/idea/${idea.id}/${tab}`);
    touchStreak(ctx, u);
    return { id: cm.id };
  }

  function markHelpful(ctx, commentId) {
    const s = ctx.store, u = requireUser(ctx);
    const c = s.get('comments', commentId);
    if (!c) fail(404, 'Comment not found.');
    const idea = getIdea(ctx, c.idea_id);
    if (idea.author_id !== u.id && !isMod(u)) fail(403, 'Only the idea\'s author can mark explanations as helpful.');
    if (c.author_id === u.id) fail(400, 'You cannot mark your own comment helpful.');
    if (c.helpful) return { helpful: true };
    s.update('comments', c.id, { helpful: 1 });
    addRep(ctx, c.author_id, POINTS.helpfulComment, `Helpful explanation on "${idea.title}"`, 'improvement', idea.id);
    notify(ctx, c.author_id, `${u.name} marked your explanation on "${idea.title}" as helpful 🤝`, `#/idea/${idea.id}`);
    checkBadges(ctx, c.author_id);
    return { helpful: true };
  }

  function setLab(ctx, ideaId, b) {
    const s = ctx.store, u = requireUser(ctx), idea = getIdea(ctx, ideaId);
    if (idea.author_id !== u.id && !isMod(u)) fail(403, 'Only the author can open or close the Idea Lab.');
    if (b.open && idea.status === 'verified') fail(409, 'Verified ideas are closed. Reopen the idea first.');
    s.update('ideas', idea.id, { lab_open: b.open ? 1 : 0, lab_draft: idea.lab_draft || idea.body, updated_at: ctx.now });
    recomputeIdeaStatus(ctx, s.get('ideas', idea.id));
    return { open: !!b.open };
  }

  function labEdit(ctx, ideaId, b) {
    const s = ctx.store, u = requireUser(ctx), idea = getIdea(ctx, ideaId);
    if (!idea.lab_open) fail(409, 'The Idea Lab is closed for this idea.');
    const body = str(b.body, 20000);
    if (body.length < 20) fail(400, 'The draft is too short.');
    if (body === (idea.lab_draft || idea.body)) fail(400, 'Nothing changed in the draft.');
    civility(body, b.note || '');
    rateLimit(ctx, u, 'lab_edits', 'editor_id', 30, 'lab edits');
    s.insert('lab_edits', { idea_id: idea.id, editor_id: u.id, body, note: str(b.note, 300) || 'Edited the draft', created_at: ctx.now });
    s.update('ideas', idea.id, { lab_draft: body, updated_at: ctx.now });
    notify(ctx, idea.author_id, `${u.name} edited the Lab draft of "${idea.title}"`, `#/idea/${idea.id}/lab`);
    touchStreak(ctx, u);
    checkBadges(ctx, u.id);
    return { ok: true };
  }

  function labTask(ctx, ideaId, b) {
    const s = ctx.store, u = requireUser(ctx), idea = getIdea(ctx, ideaId);
    if (!idea.lab_open) fail(409, 'The Idea Lab is closed for this idea.');
    const text = str(b.text, 300);
    if (text.length < 4) fail(400, 'Describe the open question.');
    civility(text);
    const t = s.insert('lab_tasks', { idea_id: idea.id, text, created_by: u.id, claimed_by: null, done: 0, created_at: ctx.now });
    return { id: t.id };
  }

  function updateLabTask(ctx, taskId, b) {
    const s = ctx.store, u = requireUser(ctx);
    const t = s.get('lab_tasks', taskId);
    if (!t) fail(404, 'Task not found.');
    const idea = getIdea(ctx, t.idea_id);
    const patch = {
      claim: { claimed_by: u.id }, unclaim: { claimed_by: null }, done: { done: 1, claimed_by: t.claimed_by || u.id }, undo: { done: 0 },
    }[b.action];
    if (!patch) fail(400, 'Unknown action.');
    if ((b.action === 'unclaim') && t.claimed_by !== u.id && idea.author_id !== u.id) fail(403, 'Only the person working on it can unclaim it.');
    s.update('lab_tasks', t.id, patch);
    touchStreak(ctx, u);
    return { ok: true };
  }

  function report(ctx, b) {
    const s = ctx.store, u = requireUser(ctx);
    const table = { idea: 'ideas', correction: 'corrections', comment: 'comments' }[b.target_type];
    if (!table) fail(400, 'Unknown item.');
    const target = s.get(table, b.target_id);
    if (!target) fail(404, 'Not found.');
    if (!REPORT_REASONS[b.reason]) fail(400, 'Choose a reason.');
    if (s.all('reports').some(r => r.reporter_id === u.id && r.target_type === b.target_type && r.target_id === target.id && r.status === 'open')) {
      fail(409, 'You already reported this. A moderator will look at it.');
    }
    s.insert('reports', {
      reporter_id: u.id, target_type: b.target_type, target_id: target.id, reason: b.reason, details: str(b.details, 1000),
      status: 'open', resolved_by: null, created_at: ctx.now,
    });
    const open = count(s, 'reports', r => r.target_type === b.target_type && r.target_id === target.id && r.status === 'open');
    if (open >= AUTO_HIDE_REPORTS && !target.hidden) s.update(table, target.id, { hidden: 1 });
    for (const m of where(s, 'users', x => x.role === 'moderator')) notify(ctx, m.id, `New report: ${REPORT_REASONS[b.reason]}`, '#/moderation');
    return { ok: true, auto_hidden: open >= AUTO_HIDE_REPORTS };
  }

  function reportQueue(ctx) {
    const s = ctx.store, u = requireUser(ctx);
    if (!isMod(u)) fail(403, 'Moderators only.');
    return s.all('reports').slice().sort((a, b) => a.created_at < b.created_at ? 1 : -1).map(r => {
      const table = { idea: 'ideas', correction: 'corrections', comment: 'comments' }[r.target_type];
      const t = s.get(table, r.target_id) || {};
      const ideaId = r.target_type === 'idea' ? t.id : t.idea_id;
      return {
        id: r.id, reason: r.reason, reason_label: REPORT_REASONS[r.reason], details: r.details, status: r.status, created_at: r.created_at,
        target_type: r.target_type, target_id: r.target_id, idea_id: ideaId, target_hidden: !!t.hidden,
        preview: (t.title ? t.title + ': ' : '') + (t.body || t.explanation || '').slice(0, 280),
        target_author: publicUser(s, s.get('users', t.author_id)), reporter: publicUser(s, s.get('users', r.reporter_id)),
        resolved_by: publicUser(s, s.get('users', r.resolved_by)),
      };
    });
  }

  function resolveReport(ctx, id, b) {
    const s = ctx.store, u = requireUser(ctx);
    if (!isMod(u)) fail(403, 'Moderators only.');
    const r = s.get('reports', id);
    if (!r) fail(404, 'Report not found.');
    const table = { idea: 'ideas', correction: 'corrections', comment: 'comments' }[r.target_type];
    const action = b.action;
    if (!['hide', 'dismiss', 'restore'].includes(action)) fail(400, 'Unknown action.');
    const related = where(s, 'reports', x => x.target_type === r.target_type && x.target_id === r.target_id && x.status === 'open');
    if (action === 'hide') {
      s.update(table, r.target_id, { hidden: 1 });
      for (const x of related) s.update('reports', x.id, { status: 'hidden', resolved_by: u.id });
      const t = s.get(table, r.target_id);
      notify(ctx, t.author_id, 'A moderator hid one of your posts for breaking the community guidelines. Criticise ideas, not people.', '#/guidelines');
    } else {
      s.update(table, r.target_id, { hidden: 0 });
      for (const x of related) s.update('reports', x.id, { status: 'dismissed', resolved_by: u.id });
      if (action === 'restore') s.update('reports', r.id, { status: 'dismissed', resolved_by: u.id });
    }
    return { ok: true };
  }

  // ───────────────────────── listings ─────────────────────────

  function listIdeas(ctx, q) {
    const s = ctx.store;
    const st = stats(s);
    let ideas = visibleIdeas(ctx).filter(i => !i.hidden);
    const text = str(q.q, 200).toLowerCase();
    if (text) {
      const words = text.split(/\s+/).filter(Boolean);
      ideas = ideas.filter(i => {
        const a = s.get('users', i.author_id);
        const hay = (i.title + ' ' + i.body + ' ' + a.name + ' ' + i.category).toLowerCase();
        return words.every(w => hay.includes(w));
      });
    }
    if (q.category) ideas = ideas.filter(i => i.category === q.category);
    if (q.kind) ideas = ideas.filter(i => i.kind === q.kind);
    if (q.difficulty) ideas = ideas.filter(i => i.difficulty === q.difficulty);
    if (q.status === 'unsolved') ideas = ideas.filter(i => i.status !== 'verified');
    else if (q.status) ideas = ideas.filter(i => i.status === q.status);
    if (q.course) ideas = ideas.filter(i => s.get('users', i.author_id).course === q.course);
    if (q.year) ideas = ideas.filter(i => String(s.get('users', i.author_id).year) === String(q.year));
    if (q.author) ideas = ideas.filter(i => i.author_id === Number(q.author));
    if (q.challenge) ideas = ideas.filter(i => i.challenge_id === Number(q.challenge));
    if (q.lab) ideas = ideas.filter(i => i.lab_open);
    if (q.needs_review) ideas = ideas.filter(i => i.status !== 'verified' && (i.needs_help || !(st.corr.get(i.id))));
    const sorters = {
      new: (a, b) => (a.created_at < b.created_at ? 1 : -1),
      active: (a, b) => (a.updated_at < b.updated_at ? 1 : -1),
      trending: (a, b) => trendScore(s, b, st, ctx.now) - trendScore(s, a, st, ctx.now),
      discussed: (a, b) => ((st.comments.get(b.id) || 0) + (st.corr.get(b.id) || 0)) - ((st.comments.get(a.id) || 0) + (st.corr.get(a.id) || 0)),
      improved: (a, b) => ((st.accepted.get(b.id) || 0) * 2 + b.current_version) - ((st.accepted.get(a.id) || 0) * 2 + a.current_version),
      top: (a, b) => (st.votes.get('idea:' + b.id) || 0) - (st.votes.get('idea:' + a.id) || 0),
    };
    ideas.sort(sorters[q.sort] || sorters.new);
    const limit = Math.min(Number(q.limit) || 24, 100), page = Math.max(1, Number(q.page) || 1);
    return { total: ideas.length, page, ideas: ideas.slice((page - 1) * limit, page * limit).map(i => ideaCard(ctx, i, st)) };
  }

  function currentChallenge(ctx) {
    const today = dayOf(ctx.now);
    return ctx.store.all('weekly_challenges').find(c => c.starts_on <= today && today <= c.ends_on) || null;
  }

  function leaderboard(ctx, q) {
    const s = ctx.store;
    const since = q.period === 'week' ? new Date(Date.parse(ctx.now) - 7 * 864e5).toISOString()
      : q.period === 'month' ? new Date(Date.parse(ctx.now) - 30 * 864e5).toISOString() : null;
    const pts = improvementPoints(s, since);
    let users = s.all('users').filter(u => !q.course || u.course === q.course);
    const rows = users.map(u => {
      const mine = where(s, 'corrections', c => c.author_id === u.id && (!since || (c.decided_at || '') >= since));
      return {
        user: publicUser(s, u), points: pts.get(u.id) || 0,
        accepted: mine.filter(c => c.status === 'correct' || c.status === 'partial').length,
        correct: mine.filter(c => c.status === 'correct').length,
        ideas_improved: new Set(mine.filter(c => c.status === 'correct' || c.status === 'partial').map(c => c.idea_id)).size,
      };
    }).filter(r => r.points > 0).sort((a, b) => b.points - a.points || b.accepted - a.accepted);
    rows.forEach((r, i) => { r.rank = i + 1; });
    const authors = s.all('users').filter(u => !q.course || u.course === q.course).map(u => ({
      user: publicUser(s, u),
      verified: count(s, 'ideas', i => i.author_id === u.id && i.status === 'verified'),
      accepted_on_own: count(s, 'corrections', c => (s.get('ideas', c.idea_id) || {}).author_id === u.id && (c.status === 'correct' || c.status === 'partial')),
    })).filter(r => r.verified + r.accepted_on_own > 0).sort((a, b) => b.verified - a.verified || b.accepted_on_own - a.accepted_on_own).slice(0, 10);
    return { period: q.period || 'all', improvers: rows.slice(0, 50), open_minds: authors };
  }

  function recognition(ctx) {
    const s = ctx.store;
    const lb = leaderboard(ctx, { period: 'all' }).improvers.slice(0, 12).map(r => {
      const u = s.get('users', r.user.id);
      return Object.assign(r, { bio: u.bio, interests: u.interests });
    });
    const stories = where(s, 'corrections', c => c.status === 'correct' && !c.hidden && !(s.get('ideas', c.idea_id) || {}).hidden)
      .sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1)).slice(0, 8).map(c => {
        const idea = s.get('ideas', c.idea_id);
        return {
          correction_id: c.id, idea_id: idea.id, idea_title: idea.title, category: idea.category, type: c.type,
          quote: c.quote, explanation: c.explanation, suggestion: c.suggestion, decided_at: c.decided_at, applied_in_version: c.applied_in_version,
          idea_status: idea.status, corrector: publicUser(s, s.get('users', c.author_id)), author: publicUser(s, s.get('users', idea.author_id)),
        };
      });
    return { improvers: lb, stories };
  }

  function home(ctx) {
    const s = ctx.store;
    const take = (q, n = 6) => listIdeas(ctx, Object.assign({ limit: n }, q)).ideas;
    const recentlyCorrected = where(s, 'corrections', c => (c.status === 'correct' || c.status === 'partial') && !c.hidden)
      .sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1));
    const seen = new Set(), rc = [];
    const st = stats(s);
    for (const c of recentlyCorrected) {
      const idea = s.get('ideas', c.idea_id);
      if (!idea || idea.hidden || seen.has(idea.id)) continue;
      seen.add(idea.id);
      rc.push({ idea: ideaCard(ctx, idea, st), correction: { type: c.type, status: c.status, quote: c.quote.slice(0, 200), explanation: c.explanation.slice(0, 220), applied_in_version: c.applied_in_version, decided_at: c.decided_at, author: publicUser(s, s.get('users', c.author_id)) } });
      if (rc.length >= 4) break;
    }
    const week = leaderboard(ctx, { period: 'week' }).improvers.slice(0, 5);
    const all = leaderboard(ctx, { period: 'all' }).improvers.slice(0, 5);
    const ch = currentChallenge(ctx);
    return {
      stats: {
        students: s.all('users').length, ideas: count(s, 'ideas', i => !i.hidden),
        corrections_accepted: count(s, 'corrections', c => c.status === 'correct' || c.status === 'partial'),
        verified: count(s, 'ideas', i => i.status === 'verified' && !i.hidden),
      },
      challenge: ch ? Object.assign({}, ch, { entries: count(s, 'ideas', i => i.challenge_id === ch.id && !i.hidden) }) : null,
      feeds: {
        trending: take({ sort: 'trending' }), new: take({ sort: 'new' }), needs_review: take({ needs_review: 1, sort: 'new' }),
        best: take({ status: 'verified', sort: 'improved' }), unsolved: take({ kind: 'problem', status: 'unsolved', sort: 'active' }),
      },
      recently_corrected: rc, top_week: week, top_all: all,
    };
  }

  function profile(ctx, id) {
    const s = ctx.store;
    const u = s.get('users', id);
    if (!u) fail(404, 'Student not found.');
    const st = stats(s);
    const pu = publicUser(s, u);
    const myCorr = where(s, 'corrections', c => c.author_id === u.id && !c.hidden);
    const badgeRows = where(s, 'user_badges', b => b.user_id === u.id);
    const improvedIdeas = visibleIdeas(ctx).filter(i => !i.hidden && contributorsOf(s, i).includes(u.id));
    return Object.assign(pu, {
      bio: u.bio, interests: u.interests, created_at: u.created_at, best_streak: u.best_streak || 0, is_me: ctx.userId === u.id,
      badges_detail: Object.entries(BADGES).map(([key, b]) => {
        const row = badgeRows.find(r => r.badge === key);
        return Object.assign({ key, earned: !!row, awarded_at: row ? row.awarded_at : null }, b);
      }),
      counts: {
        ideas: count(s, 'ideas', i => i.author_id === u.id && !i.hidden), corrections: myCorr.length,
        accepted: myCorr.filter(c => c.status === 'correct' || c.status === 'partial').length,
        helpful: count(s, 'comments', c => c.author_id === u.id && c.helpful),
        reviews: count(s, 'verdicts', v => v.user_id === u.id), improved: improvedIdeas.length,
        improvement_points: improvementPoints(s).get(u.id) || 0,
      },
      ideas: visibleIdeas(ctx).filter(i => i.author_id === u.id && !i.hidden).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(i => ideaCard(ctx, i, st)),
      improved_ideas: improvedIdeas.map(i => ideaCard(ctx, i, st)),
      corrections: myCorr.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(c => {
        const idea = s.get('ideas', c.idea_id);
        return { id: c.id, idea_id: c.idea_id, idea_title: idea.title, type: c.type, status: c.status, explanation: c.explanation.slice(0, 200), created_at: c.created_at, applied_in_version: c.applied_in_version };
      }),
      reputation_history: where(s, 'reputation_events', e => e.user_id === u.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 40)
        .map(e => ({ points: e.points, reason: e.reason, kind: e.kind, idea_id: e.idea_id, created_at: e.created_at })),
    });
  }

  function similar(ctx, b) {
    const t = tokens(str(b.title) + ' ' + str(b.title) + ' ' + str(b.body));
    const st = stats(ctx.store);
    return visibleIdeas(ctx).filter(i => !i.hidden && i.id !== Number(b.exclude))
      .map(i => ({ i, score: jaccard(t, tokens(i.title + ' ' + i.title + ' ' + i.body)) }))
      .filter(x => x.score >= 0.12).sort((a, b2) => b2.score - a.score).slice(0, 3)
      .map(x => Object.assign(ideaCard(ctx, x.i, st), { similarity: Math.round(x.score * 100) }));
  }

  function updateMe(ctx, b) {
    const u = requireUser(ctx);
    const patch = {};
    if (b.name != null) { const n = str(b.name, 80); if (n.length < 2) fail(400, 'Name is too short.'); patch.name = n; }
    if (b.course != null) { if (!COURSES.includes(b.course)) fail(400, 'Choose a course from the list.'); patch.course = b.course; }
    if (b.year != null) { const y = Number(b.year); if (!(y >= 1 && y <= 5)) fail(400, 'Year must be 1 to 5.'); patch.year = y; }
    if (b.bio != null) { patch.bio = str(b.bio, 500); civility(patch.bio); }
    if (b.interests != null) patch.interests = (Array.isArray(b.interests) ? b.interests : String(b.interests).split(',')).map(x => str(x, 40)).filter(Boolean).slice(0, 12);
    ctx.store.update('users', u.id, patch);
    return publicUser(ctx.store, ctx.store.get('users', u.id));
  }

  function me(ctx) {
    if (!ctx.userId) return { user: null };
    const s = ctx.store, u = s.get('users', ctx.userId);
    if (!u) return { user: null };
    return {
      user: Object.assign(publicUser(s, u), { bio: u.bio, interests: u.interests, best_streak: u.best_streak || 0 }),
      unread: count(s, 'notifications', n => n.user_id === u.id && !n.read),
    };
  }

  function notifications(ctx) {
    const u = requireUser(ctx);
    return where(ctx.store, 'notifications', n => n.user_id === u.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 50);
  }
  function readNotifications(ctx) {
    const u = requireUser(ctx);
    for (const n of where(ctx.store, 'notifications', n => n.user_id === u.id && !n.read)) ctx.store.update('notifications', n.id, { read: 1 });
    return { ok: true };
  }

  function challenges(ctx) {
    const s = ctx.store;
    const cur = currentChallenge(ctx);
    return {
      current: cur ? cur.id : null,
      challenges: s.all('weekly_challenges').slice().sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1)).map(c => Object.assign({}, c, {
        entries: count(s, 'ideas', i => i.challenge_id === c.id && !i.hidden), upcoming: c.starts_on > dayOf(ctx.now),
      })),
    };
  }

  function createChallenge(ctx, b) {
    const u = requireUser(ctx);
    if (!isMod(u)) fail(403, 'Moderators only.');
    const title = str(b.title, 120), prompt = str(b.prompt, 2000);
    if (!title || !prompt || !/^\d{4}-\d{2}-\d{2}$/.test(b.starts_on || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.ends_on || '')) fail(400, 'Title, prompt and dates are required.');
    const c = ctx.store.insert('weekly_challenges', { title, prompt, category: CATEGORY_SLUGS.includes(b.category) ? b.category : null, starts_on: b.starts_on, ends_on: b.ends_on });
    return { id: c.id };
  }

  function meta() {
    return {
      categories: CATEGORIES, courses: COURSES, correction_types: CORRECTION_TYPES, verdicts: VERDICTS, idea_status: IDEA_STATUS,
      difficulties: DIFFICULTIES, report_reasons: REPORT_REASONS, levels: LEVELS, badges: BADGES, points: POINTS,
      reviewer_min_rep: REVIEWER_MIN_REP, quorum: QUORUM,
    };
  }

  // ───────────────────────── auth helpers (hashing lives in the transport) ─────────────────────────

  const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'moderator', 'mod', 'ideahub', 'dduc', 'support', 'system', 'root']);
  const normUsername = u => str(u, 40).replace(/^@/, '').toLowerCase();
  function findUserByUsername(s, username) {
    const n = normUsername(username);
    return n ? s.all('users').find(u => String(u.username).toLowerCase() === n) || null : null;
  }
  function checkUsername(s, raw) {
    const username = str(raw, 40).replace(/^@/, '');
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) return { ok: false, username, reason: 'Use 3 to 20 letters, numbers, dots or underscores.' };
    if (RESERVED_USERNAMES.has(username.toLowerCase())) return { ok: false, username, reason: 'That username is reserved. Please pick another.' };
    if (findUserByUsername(s, username)) return { ok: false, username, reason: 'That username is already taken. Please pick another.' };
    return { ok: true, username };
  }

  function validateSignup(s, b) {
    const name = str(b.name, 80);
    const un = checkUsername(s, b.username);
    if (!un.ok) fail(un.reason.includes('taken') ? 409 : 400, un.reason);
    if (name.length < 2) fail(400, 'Please enter your name.');
    if (String(b.password || '').length < 6) fail(400, 'Password must be at least 6 characters.');
    if (!COURSES.includes(b.course)) fail(400, 'Choose your course.');
    const year = Number(b.year);
    if (!(year >= 1 && year <= 5)) fail(400, 'Choose your year.');
    if (!b.pledge) fail(400, 'Please accept the community pledge.');
    civility(name, un.username, b.bio || '');
    return { name, username: un.username, course: b.course, year };
  }

  function createUser(ctx, fields, passwordHash) {
    const interests = (Array.isArray(fields.interests) ? fields.interests : String(fields.interests || '').split(','))
      .map(x => str(x, 40)).filter(Boolean).slice(0, 12);
    return ctx.store.insert('users', {
      name: fields.name, username: fields.username, email: fields.email || null, password_hash: passwordHash, course: fields.course, year: Number(fields.year),
      bio: str(fields.bio, 500), interests, role: fields.role || 'student', reputation: 0, streak: 0, best_streak: 0,
      last_active_day: null, created_at: ctx.now,
    });
  }

  // ───────────────────────── router ─────────────────────────

  const routes = [
    ['GET', /^\/api\/meta$/, () => meta()],
    ['GET', /^\/api\/username-available$/, (ctx, m, b, q) => { const r = checkUsername(ctx.store, q.u); return { available: r.ok, username: r.username, reason: r.ok ? '' : r.reason }; }],
    ['GET', /^\/api\/me$/, ctx => me(ctx)],
    ['PATCH', /^\/api\/me$/, (ctx, m, b) => updateMe(ctx, b)],
    ['GET', /^\/api\/home$/, ctx => home(ctx)],
    ['GET', /^\/api\/ideas$/, (ctx, m, b, q) => listIdeas(ctx, q)],
    ['POST', /^\/api\/ideas$/, (ctx, m, b) => createIdea(ctx, b)],
    ['POST', /^\/api\/ideas\/similar$/, (ctx, m, b) => similar(ctx, b)],
    ['GET', /^\/api\/ideas\/(\d+)$/, (ctx, m) => ideaDetail(ctx, getIdea(ctx, m[1]))],
    ['POST', /^\/api\/ideas\/(\d+)\/versions$/, (ctx, m, b) => addVersion(ctx, m[1], b)],
    ['POST', /^\/api\/ideas\/(\d+)\/status$/, (ctx, m, b) => setIdeaStatus(ctx, m[1], b)],
    ['POST', /^\/api\/ideas\/(\d+)\/vote$/, (ctx, m) => toggleVote(ctx, 'idea', m[1])],
    ['POST', /^\/api\/ideas\/(\d+)\/corrections$/, (ctx, m, b) => createCorrection(ctx, m[1], b)],
    ['POST', /^\/api\/ideas\/(\d+)\/comments$/, (ctx, m, b) => createComment(ctx, m[1], b)],
    ['POST', /^\/api\/ideas\/(\d+)\/lab$/, (ctx, m, b) => setLab(ctx, m[1], b)],
    ['POST', /^\/api\/ideas\/(\d+)\/lab\/edits$/, (ctx, m, b) => labEdit(ctx, m[1], b)],
    ['POST', /^\/api\/ideas\/(\d+)\/lab\/tasks$/, (ctx, m, b) => labTask(ctx, m[1], b)],
    ['POST', /^\/api\/lab\/tasks\/(\d+)$/, (ctx, m, b) => updateLabTask(ctx, m[1], b)],
    ['POST', /^\/api\/corrections\/(\d+)\/vote$/, (ctx, m) => toggleVote(ctx, 'correction', m[1])],
    ['POST', /^\/api\/corrections\/(\d+)\/verdict$/, (ctx, m, b) => castVerdict(ctx, m[1], b)],
    ['POST', /^\/api\/comments\/(\d+)\/vote$/, (ctx, m) => toggleVote(ctx, 'comment', m[1])],
    ['POST', /^\/api\/comments\/(\d+)\/helpful$/, (ctx, m) => markHelpful(ctx, m[1])],
    ['POST', /^\/api\/reports$/, (ctx, m, b) => report(ctx, b)],
    ['GET', /^\/api\/moderation\/reports$/, ctx => reportQueue(ctx)],
    ['POST', /^\/api\/moderation\/reports\/(\d+)$/, (ctx, m, b) => resolveReport(ctx, m[1], b)],
    ['GET', /^\/api\/users\/(\d+)$/, (ctx, m) => profile(ctx, m[1])],
    ['GET', /^\/api\/leaderboard$/, (ctx, m, b, q) => leaderboard(ctx, q)],
    ['GET', /^\/api\/recognition$/, ctx => recognition(ctx)],
    ['GET', /^\/api\/challenges$/, ctx => challenges(ctx)],
    ['POST', /^\/api\/challenges$/, (ctx, m, b) => createChallenge(ctx, b)],
    ['GET', /^\/api\/notifications$/, ctx => notifications(ctx)],
    ['POST', /^\/api\/notifications\/read$/, ctx => readNotifications(ctx)],
  ];

  /** handle(store, {method, path, query, body, userId, now}) → {status, body, mutated} */
  function handle(store, req) {
    const ctx = { store, userId: req.userId || null, now: req.now || new Date().toISOString() };
    for (const [method, re, fn] of routes) {
      if (method !== req.method) continue;
      const m = re.exec(req.path);
      if (!m) continue;
      try {
        return { status: 200, body: fn(ctx, m, req.body || {}, req.query || {}), mutated: method !== 'GET' };
      } catch (e) {
        if (e instanceof ApiError) return { status: e.status, body: { error: e.message }, mutated: method !== 'GET', failed: true };
        throw e;
      }
    }
    return { status: 404, body: { error: 'No such endpoint.' } };
  }

  function recheckBadges(store, now) {
    const ctx = { store, userId: null, now: now || new Date().toISOString() };
    for (const u of store.all('users')) checkBadges(ctx, u.id);
  }

  return {
    TABLES, JSON_COLS, recheckBadges, CATEGORIES, COURSES, BADGES, LEVELS, POINTS,
    createStore, handle, validateSignup, createUser, findUserByUsername, ApiError, levelFor, publicUser,
  };
});
