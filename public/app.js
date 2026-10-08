/* IdeaHub DDUC single-page app. Talks to /api (server mode) or to the in-browser engine (demo mode). */
(function () {
  'use strict';

  const DEMO = !!window.IdeaHubDemo;
  const app = document.getElementById('app');
  const state = { me: null, unread: 0, meta: null, config: {}, route: null };

  // ───────── utilities ─────────
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const yr = y => `${ordinal(Number(y))} yr`;
  const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;
  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const fmtDate = iso => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  async function api(method, path, body) {
    if (DEMO) return window.IdeaHubDemo.request(method, path, body);
    const r = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    let data;
    try { data = await r.json(); } catch { data = { error: 'The server sent an unexpected response.' }; }
    if (!r.ok) { const e = new Error(data.error || 'Request failed.'); e.status = r.status; throw e; }
    return data;
  }
  const qs = o => { const p = Object.entries(o).filter(([, v]) => v !== '' && v != null && v !== false); return p.length ? '?' + p.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&') : ''; };

  function toast(msg, err) {
    let host = $('.toast-host');
    if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; host.appendChild(t);
    setTimeout(() => t.remove(), err ? 5200 : 3200);
  }

  // Markdown + LaTeX math + code, sanitised.
  function md(src) {
    src = String(src || '');
    if (!window.marked || !window.DOMPurify) return '<p>' + esc(src).replace(/\n/g, '<br>') + '</p>';
    const math = [];
    const parts = src.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
    const prot = parts.map((p, i) => i % 2 ? p : p.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, m => { math.push(m); return `@@M${math.length - 1}@@`; })).join('');
    let html = DOMPurify.sanitize(marked.parse(prot, { breaks: true, gfm: true }));
    html = html.replace(/@@M(\d+)@@/g, (_, i) => `<span class="math">${esc(math[i])}</span>`);
    return html;
  }
  function enhance(el) {
    el = el || app;
    if (window.hljs) $$('pre code', el).forEach(c => { if (!c.dataset.hl) { c.dataset.hl = 1; try { hljs.highlightElement(c); } catch (e) { /* plain */ } } });
    if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([el]).catch(() => {});
    $$('.prose a', el).forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  }

  // ───────── small components ─────────
  const meta = () => state.meta;
  const cat = slug => (meta().categories.find(c => c.slug === slug) || { name: slug, icon: '•' });
  const avColor = id => `hsl(${(id * 67) % 360} 52% 42%)`;
  const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const av = (u, size) => u ? `<span class="av ${size || ''}" style="background:${avColor(u.id)}" aria-hidden="true">${esc(initials(u.name))}</span>` : `<span class="av ${size || ''}" style="background:var(--bad)">?</span>`;
  const badgeIcons = (u, n) => (u.badges || []).slice(0, n || 3).map(b => `<span title="${esc(meta().badges[b].name)}">${meta().badges[b].icon}</span>`).join('');
  function person(u, opts) {
    opts = opts || {};
    if (!u) return '<span class="muted">[removed]</span>';
    return `<a class="person" href="#/u/${u.id}">${av(u, opts.size || '')}<span class="meta"><b>${esc(u.name)}${u.role === 'moderator' ? ' <span class="chip tiny" style="padding:0 6px">mod</span>' : ''}</b>${opts.sub === false ? '' : `<small>${esc(u.course)} · ${yr(u.year)}${opts.rep === false ? '' : ` · <span class="num">${u.reputation}</span> rep`}</small>`}</span></a>`;
  }
  const nameLink = u => u ? `<a href="#/u/${u.id}"><b>${esc(u.name)}</b></a>` : '<span class="muted">someone</span>';
  const statusPill = s => `<span class="pill st-${s}">${esc(meta().idea_status[s])}</span>`;
  const verdictPill = s => `<span class="pill cv-${s}">${s === 'pending' ? 'Awaiting verdict' : esc(meta().verdicts[s])}</span>`;
  const typeChip = t => `<span class="chip">${meta().correction_types[t].icon} ${esc(meta().correction_types[t].label)}</span>`;

  function credit(i) {
    const c = i.contributors || [];
    const imp = c.length ? ` · <span class="imp">Improved by</span> ${c.slice(0, 2).map(u => `<b>${esc(u.name)}</b>`).join(', ')}${c.length > 2 ? ` +${c.length - 2}` : ''}` : '';
    return `<div class="credit">Idea by <b>${esc(i.author.name)}</b>${imp}</div>`;
  }
  function ideaCard(i) {
    const c = cat(i.category);
    return `<a class="idea-card" href="#/idea/${i.id}">
      <div class="row" style="--gap:6px"><span class="chip">${c.icon} ${esc(c.name)}</span>${statusPill(i.status)}${i.kind === 'problem' ? (i.status === 'verified' ? '<span class="chip">Problem, solved</span>' : '<span class="chip tag-problem">Unsolved problem</span>') : ''}${i.needs_help && i.status !== 'verified' ? '<span class="chip tag-help">Needs review</span>' : ''}${i.lab_open ? '<span class="chip">🧪 Lab</span>' : ''}</div>
      <h3>${esc(i.title)}</h3>
      <p class="excerpt">${esc(i.excerpt)}</p>
      ${credit(i)}
      <div class="foot"><span>${esc(i.author.course.replace(/^B\.Sc\. \(H\) /, 'BSc ').replace(/^B\.Sc\. /, 'BSc '))} · ${yr(i.author.year)} · ${ago(i.created_at)}</span>
        <span class="counts"><span title="Upvotes">▲ ${i.votes}</span><span title="Accepted corrections / all corrections">✎ ${i.accepted}/${i.corrections}</span><span title="Comments">💬 ${i.comments}</span>${i.version > 1 ? `<span title="Versions">v${i.version}</span>` : ''}</span></div>
    </a>`;
  }
  const cards = (list, emptyMsg) => list.length ? `<div class="cards">${list.map(ideaCard).join('')}</div>` : `<div class="empty">${emptyMsg || 'Nothing here yet.'}</div>`;
  const loginPrompt = what => `<div class="empty"><a href="#/login">Log in</a> or <a href="#/signup">join IdeaHub</a> to ${what}.</div>`;

  // ───────── modal ─────────
  function modal(html, onSubmit) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
    const form = $('form', back);
    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = $('button[type=submit]', form); btn.disabled = true;
        const errBox = $('.form-error', form);
        try { await onSubmit(new FormData(form), form); close(); } catch (err) { if (errBox) { errBox.hidden = false; errBox.textContent = err.message; } else toast(err.message, true); btn.disabled = false; }
      });
      const first = $('input:not([type=radio]):not([type=hidden]), textarea', form); if (first) setTimeout(() => first.focus(), 30);
    }
    return { close, el: back };
  }

  // ───────── header / shell ─────────
  function renderShell() {
    const r = state.route.name;
    const nav = [['home', '#/', 'Discover'], ['explore', '#/explore', 'Explore'], ['lab', '#/lab', 'Idea Lab'], ['challenges', '#/challenges', 'Challenges'], ['leaderboard', '#/leaderboard', 'Leaderboard'], ['recognition', '#/recognition', 'Recognition']];
    const me = state.me;
    $('#topbar').innerHTML = `<div class="topbar-inner">
      <a class="logo" href="#/"><span class="logo-mark" aria-hidden="true">✎</span>IdeaHub<small>DDUC</small></a>
      ${me ? '' : '<span class="grow"></span>'}<nav class="mainnav" aria-label="Main" ${me ? '' : 'hidden'}>${nav.map(([k, h, l]) => `<a href="${h}" class="${r === k ? 'on' : ''}">${l}</a>`).join('')}${me && me.role === 'moderator' ? `<a href="#/moderation" class="${r === 'moderation' ? 'on' : ''}">Moderation</a>` : ''}</nav>
      <div class="top-actions">
        ${me ? '<a class="btn primary sm hide-sm" href="#/new">+ Share an idea</a>' : ''}
        ${me ? `<a class="icon-btn" href="#/notifications" aria-label="Notifications">🔔${state.unread ? `<span class="dot">${state.unread}</span>` : ''}</a>
          <a class="me-chip" href="#/u/${me.id}" title="${esc(me.level.name)} · ${me.reputation} reputation">${av(me, 'sm')}<span class="num">${me.reputation}</span>${me.streak > 1 ? `<span class="small" title="${me.streak}-day streak">🔥${me.streak}</span>` : ''}</a><button class="btn sm ghost hide-sm" data-action="logout">Log out</button>`
          : `<a class="btn sm ghost hide-sm" href="#/login">Log in</a><a class="btn sm primary" href="${state.route.name === 'signup' ? '#/login' : '#/signup'}">${state.route.name === 'signup' ? 'Log in' : 'Create account'}</a>`}
      </div></div>`;
    $('#bottomnav').hidden = !me;
    $('#bottomnav').innerHTML = !me ? '' : [['home', '#/', '⌂', 'Home'], ['explore', '#/explore', '⌕', 'Explore'], ['new', '#/new', '+', ''], ['leaderboard', '#/leaderboard', '★', 'Leaders'], ['me', me ? `#/u/${me.id}` : '#/login', '◉', me ? 'Me' : 'Log in']]
      .map(([k, h, i, l]) => k === 'new' ? `<a href="${h}" aria-label="Share an idea"><span class="plus">+</span></a>` : `<a href="${h}" class="${r === k || (k === 'me' && r === 'profile' && me && state.route.id == me.id) ? 'on' : ''}"><span style="font-size:1.2rem">${i}</span>${l}</a>`).join('');
  }

  async function refreshMe() {
    const r = await api('GET', '/api/me');
    state.me = r.user; state.unread = r.unread || 0;
  }

  // ───────── router ─────────
  function parseRoute() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [p, q] = h.split('?');
    const query = Object.fromEntries(new URLSearchParams(q || ''));
    const seg = p.split('/').filter(Boolean);
    const R = (name, extra) => Object.assign({ name, query }, extra);
    if (!seg.length) return R('home');
    if (seg[0] === 'idea' && seg[1]) return seg[2] === 'improve' ? R('improve', { id: +seg[1] }) : R('idea', { id: +seg[1], tab: seg[2] || 'corrections' });
    if (seg[0] === 'u' && seg[1]) return R('profile', { id: +seg[1], tab: seg[2] || 'ideas' });
    return R(seg[0]);
  }

  const pages = {};
  const PUBLIC_PAGES = ['login', 'signup', 'guidelines'];
  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    state.route = parseRoute();
    if (!state.me && !PUBLIC_PAGES.includes(state.route.name)) {
      // The site opens only after signing in: remember where they were going and show the log-in page.
      state.after = location.hash || '#/';
      state.route = Object.assign(parseRoute(), { name: 'login' });
    }
    renderShell();
    const page = pages[state.route.name] || pages.notfound;
    app.setAttribute('aria-busy', 'true');
    try {
      const html = await page(state.route);
      if (seq !== renderSeq) return; // a newer navigation started while this page was loading
      if (typeof html === 'string') app.innerHTML = html;
      enhance(app);
      if (page.after) page.after(state.route);
    } catch (e) {
      if (seq !== renderSeq) return;
      app.innerHTML = `<div class="empty"><h2>Couldn't open this page</h2><p style="margin-top:8px">${esc(e.message)}</p><p style="margin-top:12px"><a href="#/">Back to Discover</a></p></div>`;
    }
    app.removeAttribute('aria-busy');
    document.title = (state.title ? state.title + ' · ' : '') + 'IdeaHub DDUC';
    state.title = '';
  }
  let lastPath = '';
  window.addEventListener('hashchange', () => {
    const path = location.hash.split('?')[0].replace(/\/(corrections|discussion|history|lab|ideas|improved|reputation)$/, '');
    if (path !== lastPath) window.scrollTo(0, 0);
    lastPath = path;
    render();
  });
  const go = h => { if (location.hash === h) render(); else location.hash = h; };

  // ───────── pages ─────────
  pages.home = async () => {
    const h = await api('GET', '/api/home');
    const tab = (state.homeTab = state.homeTab || 'trending');
    const story = h.recently_corrected.find(x => x.correction.status === 'correct' && x.correction.applied_in_version) || h.recently_corrected[0];
    const feeds = [['trending', 'Trending'], ['new', 'New'], ['needs_review', 'Needs review'], ['best', 'Best (verified)'], ['unsolved', 'Unsolved problems']];
    const ch = h.challenge;
    return `
    <section class="hero">
      <div>
        <div class="eyebrow">For students of Deen Dayal Upadhyaya College, University of Delhi</div>
        <h1 style="margin-top:10px">Share an idea. <span class="hl">Find a mistake.</span> <span class="fix">Improve it together.</span></h1>
        <p class="lede">Post the half-finished thought, the shaky calculation, the startup you are not sure about. Other students point out what's missing, and when a correction is verified, they get the credit for making it better.</p>
        <div class="row cta"><a class="btn primary" href="#/new">Share an idea</a><a class="btn" href="#/explore?status=unsolved&sort=new">Find something to improve</a></div>
        <div class="hero-stats">
          <div><b>${h.stats.ideas}</b><span>ideas shared</span></div>
          <div><b>${h.stats.corrections_accepted}</b><span>corrections accepted</span></div>
          <div><b>${h.stats.verified}</b><span>ideas verified</span></div>
          <div><b>${h.stats.students}</b><span>students</span></div>
        </div>
      </div>
      ${story ? `<a class="story-card" href="#/idea/${story.idea.id}/history" style="color:inherit;text-decoration:none" aria-label="Improvement story: ${esc(story.idea.title)}">
        <span class="tape" aria-hidden="true"></span>
        <div class="row between"><span class="eyebrow">How an idea got better</span>${statusPill(story.idea.status)}</div>
        <h3 style="margin:8px 0 6px">${esc(story.idea.title)}</h3>
        <div class="story-step"><span class="n">1</span><div class="small"><span class="muted">${esc(story.idea.author.name)} wrote</span><div class="strike">${esc(story.correction.quote || 'the original claim')}</div></div></div>
        <div class="story-step"><span class="n">2</span><div class="small"><span class="muted">${esc(story.correction.author.name)} spotted a ${esc(meta().correction_types[story.correction.type].label.toLowerCase())}</span><div>${esc(story.correction.explanation.replace(/[*$`]/g, '').slice(0, 150))}…</div></div></div>
        <div class="story-step fixed"><span class="n">✓</span><div><span class="hand">Marked ${esc(meta().verdicts[story.correction.status].toLowerCase())}${story.correction.applied_in_version ? `, fixed in v${story.correction.applied_in_version}` : ''}</span><div class="small muted">+${story.correction.status === 'correct' ? meta().points.correctionCorrect : meta().points.correctionPartial} reputation to ${esc(story.correction.author.name.split(' ')[0])}</div></div></div>
      </a>` : ''}
    </section>

    <section class="steps" aria-label="How it works">
      <div class="step"><div class="k">Step 1</div><h3>Share it unfinished</h3><p>Ideas, research questions, maths, code, startups, campus fixes. Mark it "needs review" if you know it has gaps.</p></div>
      <div class="step"><div class="k">Step 2</div><h3>Challenge the idea</h3><p>Quote the exact line, name the problem (maths, logic, facts, missing info) and suggest a better version.</p></div>
      <div class="step"><div class="k">Step 3</div><h3>Verify and credit</h3><p>The author, a moderator or three reviewers confirm it. The fixer earns reputation and is named on the improved version.</p></div>
    </section>

    ${ch ? `<section class="challenge-band"><span class="big" aria-hidden="true">🎯</span><div><div class="eyebrow">Weekly challenge · ends ${fmtDate(ch.ends_on + 'T12:00:00Z')}</div><h3 style="margin:4px 0">${esc(ch.title)}</h3><p>${esc(ch.prompt)}</p></div><a class="btn marker" href="#/challenges">${plural(ch.entries, 'entry', 'entries')} · Join</a></section>` : ''}

    <div class="layout">
      <section>
        <div class="tabs" role="tablist">${feeds.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-action="home-tab" data-tab="${k}">${l}</button>`).join('')}</div>
        ${cards(h.feeds[tab], 'No ideas in this feed yet.')}
        <div style="margin-top:14px"><a href="#/explore">Search and filter all ideas →</a></div>
      </section>
      <aside class="stack" style="--gap:18px">
        <div class="panel"><h3>Top Idea Improvers at DDUC</h3><p class="small muted" style="margin:4px 0 6px">This week, by improvement points</p>
          <div class="side-list">${(h.top_week.length ? h.top_week : h.top_all).map(r => `<div class="row" style="--gap:10px;flex-wrap:nowrap"><span class="rankno">${r.rank}</span><span class="grow">${person(r.user, { rep: false })}</span><span class="rep">+${r.points}</span></div>`).join('') || '<p class="small muted">No improvements yet this week. Be the first!</p>'}</div>
          <a class="small" href="#/leaderboard">Full leaderboard →</a></div>
        <div class="panel"><h3>Recently corrected</h3>
          <div class="side-list">${h.recently_corrected.map(rc => `<a href="#/idea/${rc.idea.id}/corrections" style="color:inherit;text-decoration:none"><div class="row" style="--gap:6px">${verdictPill(rc.correction.status)}<span class="tiny muted">${ago(rc.correction.decided_at)}</span></div><b style="display:block;margin-top:4px">${esc(rc.idea.title)}</b><span class="small muted">${esc(rc.correction.author.name)} · ${esc(meta().correction_types[rc.correction.type].short)}</span></a>`).join('') || '<p class="small muted">No corrections verified yet.</p>'}</div></div>
      </aside>
    </div>
    <section class="pledge"><span class="hand">Criticise the idea, not the person.</span><p class="muted grow">Every idea here is a draft. A wrong correction costs you nothing, and accepting one earns you points. <a href="#/guidelines">Read the community guidelines</a></p></section>`;
  };

  pages.explore = async r => {
    const q = Object.assign({ sort: 'new' }, r.query);
    const res = await api('GET', '/api/ideas' + qs(Object.assign({}, q, { limit: 48 })));
    const m = meta();
    const sel = (name, label, opts) => `<label class="field"><span class="sr">${label}</span><select class="input" id="f-${name}" name="${name}" data-filter><option value="">${label}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(q[name] || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    state.title = 'Explore';
    return `<div class="page-head"><div><h1>Explore ideas</h1><p>Search by subject, course, year or difficulty. Look for "Improving" and "Unsolved" ideas if you want to help.</p></div></div>
      <form class="searchbar" data-form="search" role="search"><input class="input" id="f-q" name="q" type="search" placeholder="Search titles, descriptions, authors…" value="${esc(q.q || '')}"><button class="btn primary" type="submit">Search</button></form>
      <div class="filters">
        ${sel('category', 'All categories', m.categories.map(c => [c.slug, c.name]))}
        ${sel('course', 'Any course', m.courses.map(c => [c, c]))}
        ${sel('year', 'Any year', [1, 2, 3, 4].map(y => [y, yr(y)]))}
        ${sel('difficulty', 'Any difficulty', m.difficulties.map(d => [d, d[0].toUpperCase() + d.slice(1)]))}
        ${sel('status', 'Any status', [['unsolved', 'Unsolved (not verified)'], ['open', 'Open for discussion'], ['improving', 'Improving'], ['verified', 'Solved / Verified']])}
        ${sel('kind', 'Ideas and problems', [['idea', 'Ideas'], ['problem', 'Unsolved problems']])}
        ${sel('sort', 'Sort', [['new', 'Newest'], ['trending', 'Trending'], ['discussed', 'Most discussed'], ['improved', 'Most improved'], ['top', 'Most upvoted'], ['active', 'Recently active']])}
      </div>
      <p class="small muted" style="margin-bottom:12px">${plural(res.total, 'idea')} found${Object.keys(r.query).length ? ` · <a href="#/explore">clear filters</a>` : ''}</p>
      ${cards(res.ideas, 'No ideas match these filters. Try removing one, or <a href="#/new">share the first idea on this topic</a>.')}`;
  };
  pages.explore.after = () => {
    $$('[data-filter]').forEach(s => s.addEventListener('change', () => {
      const q = Object.assign({}, state.route.query, { [s.name]: s.value });
      go('#/explore' + qs(q));
    }));
  };

  // ── idea page ──
  pages.idea = async r => {
    const i = await api('GET', `/api/ideas/${r.id}`);
    state.idea = i;
    state.title = i.title;
    const c = cat(i.category);
    const me = state.me;
    const vNum = Number(r.query.v) || i.version;
    const shown = i.versions.find(v => v.version === vNum) || i.versions[i.versions.length - 1];
    const tabs = [['corrections', 'Corrections', i.corrections.length], ['discussion', 'Discussion', i.comments.filter(x => !x.correction_id).length], ['history', 'History', plural(i.versions.length, 'version')], ['lab', 'Idea Lab', i.lab.open ? 'open' : '']];
    const tab = r.tab;
    const pendingN = i.corrections.filter(x => x.status === 'pending' || x.status === 'discussion').length;
    const unapplied = i.corrections.filter(x => (x.status === 'correct' || x.status === 'partial') && !x.applied_in_version).length;
    let body = '';
    if (tab === 'corrections') body = correctionsTab(i);
    else if (tab === 'discussion') body = discussionTab(i);
    else if (tab === 'history') body = historyTab(i, r.query);
    else if (tab === 'lab') body = labTab(i);
    return `<article>
      <div class="idea-head">
        <div class="row" style="--gap:6px"><a class="chip" href="#/explore?category=${i.category}">${c.icon} ${esc(c.name)}</a>${statusPill(i.status)}${i.kind === 'problem' ? (i.status === 'verified' ? '<span class="chip">Problem, solved</span>' : '<span class="chip tag-problem">Unsolved problem</span>') : ''}<span class="chip">${esc(i.difficulty)}</span><span class="chip mono">v${i.version}</span>${i.challenge ? `<a class="chip" href="#/challenges">🎯 ${esc(i.challenge.title)}</a>` : ''}${i.hidden ? '<span class="chip tag-problem">Hidden by moderator</span>' : ''}</div>
        <h1>${esc(shown.title)}</h1>
        <div class="row" style="--gap:18px">
          <div class="stack" style="--gap:4px"><span class="eyebrow">Original idea</span>${person(i.author)}</div>
          ${i.contributors.length ? `<div class="stack" style="--gap:4px"><span class="eyebrow" style="color:var(--accent)">Improved by</span><div class="row" style="--gap:12px">${i.contributors.map(u => person(u, { rep: false })).join('')}</div></div>` : ''}
        </div>
        <p class="small muted">Posted ${ago(i.created_at)}${i.version > 1 ? ` · last improved ${ago(i.versions[i.versions.length - 1].created_at)}` : ''}${i.verified_at ? ` · verified ${ago(i.verified_at)}` : ''}</p>
      </div>
      <div class="actionbar">
        <button class="btn sm vote ${i.voted ? 'on' : ''}" data-action="vote" data-type="ideas" data-id="${i.id}" ${!me || me.id === i.author.id ? 'disabled' : ''} title="${me && me.id === i.author.id ? 'You cannot upvote your own idea' : 'This idea is useful'}">▲ Useful <span class="num">${i.votes}</span></button>
        ${me && me.id !== i.author.id ? `<button class="btn sm marker" data-action="challenge">⚑ Challenge this idea</button>` : ''}
        ${!me ? `<a class="btn sm marker" href="#/login">⚑ Log in to challenge</a>` : ''}
        ${i.can.edit ? `<a class="btn sm primary" href="#/idea/${i.id}/improve">✎ Publish improved version</a>` : ''}
        ${i.can.verify && i.status !== 'verified' ? `<button class="btn sm" data-action="verify" ${pendingN || unapplied ? `title="${pendingN ? 'Resolve open corrections first' : 'Publish an improved version with the accepted corrections first'}"` : ''}>✓ Mark solved / verified</button>` : ''}
        ${i.can.verify && i.status === 'verified' ? `<button class="btn sm ghost" data-action="reopen">Reopen</button>` : ''}
        <span class="grow"></span>
        ${me && me.id !== i.author.id ? `<button class="btn sm ghost" data-action="report" data-type="idea" data-id="${i.id}">Report</button>` : ''}
      </div>
      ${i.needs_help && i.status !== 'verified' ? `<div class="help-note"><b>${esc(i.author.name.split(' ')[0])} knows this is unfinished</b> and asked for help. Point out anything missing or wrong.</div>` : ''}
      ${shown.version !== i.version ? `<div class="version-banner">You're reading <b>version ${shown.version}</b> of ${i.version}. <a href="#/idea/${i.id}/${tab}">Show the latest version</a></div>` : ''}
      <div class="prose" id="idea-body">${md(shown.body)}</div>
      ${i.images && i.images.length ? `<div class="row" style="margin-top:14px">${i.images.map(src => `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer"><img src="${esc(src)}" alt="Attached image" style="max-height:220px;border-radius:10px;border:1px solid var(--line)"></a>`).join('')}</div>` : ''}
      ${i.sources ? `<p class="small muted" style="margin-top:14px"><b>Sources / inspiration:</b> ${esc(i.sources)}</p>` : ''}
      <div class="tabs" style="margin-top:28px" role="tablist">${tabs.map(([k, l, n]) => `<a role="tab" class="${tab === k ? 'on' : ''}" href="#/idea/${i.id}/${k}">${l}${n !== '' ? `<span class="count">${n}</span>` : ''}</a>`).join('')}</div>
      <section id="tab-body">${body}</section>
    </article>`;
  };

  function verdictControls(i, c) {
    const me = state.me;
    if (c.status !== 'pending' && c.status !== 'discussion') return '';
    if (!me) return `<p class="small muted"><a href="#/login">Log in</a> to review this correction.</p>`;
    if (c.is_mine) return `<p class="small muted">Waiting for the author, a moderator or ${i.quorum} reviewers to give a verdict.</p>`;
    const final = i.can.verify;
    const tallyHtml = `<div class="tally">${Object.entries(c.tally).filter(([, n]) => n).map(([k, n]) => `<span>${esc(meta().verdicts[k])}: ${n}/${i.quorum}</span>`).join('') || '<span class="muted">No community verdicts yet</span>'}</div>`;
    if (!final && !i.can.review) return `${tallyHtml}<p class="small muted">Community verdicts unlock at ${i.reviewer_min_rep} reputation (you have ${me.reputation}). You can upvote the correction or discuss it below.</p>`;
    return `<div class="stack" style="--gap:8px">
      <div class="small"><b>${final ? (me.id === i.author.id ? 'Your verdict as the author (final)' : 'Moderator verdict (final)') : `Your community verdict (${i.quorum} matching verdicts decide)`}</b></div>
      ${final ? '' : tallyHtml}
      <div class="row" style="--gap:6px">${Object.entries(meta().verdicts).map(([k, l]) => `<button class="btn sm ${c.my_verdict === k ? 'on' : ''}" data-action="verdict" data-id="${c.id}" data-verdict="${k}" data-final="${final ? 1 : ''}">${l}</button>`).join('')}</div></div>`;
  }

  function commentHtml(i, cm, all) {
    const me = state.me;
    const kids = all.filter(x => x.parent_id === cm.id);
    return `<div class="comment" id="c${cm.id}">${av(cm.author)}<div class="bubble">
      <div class="who">${cm.author ? nameLink(cm.author) : '<span class="muted">Hidden</span>'}${cm.author ? `<span class="tiny muted">${esc(cm.author.course)}</span>` : ''}<span class="tiny muted">${ago(cm.created_at)}</span>${cm.helpful ? '<span class="helpful-tag">✓ Marked helpful by the author</span>' : ''}</div>
      ${cm.hidden && !cm.body ? '<p class="small muted">This comment was hidden by a moderator.</p>' : `<div class="prose compact">${md(cm.body)}</div>`}
      <div class="tools">
        <button class="${cm.voted ? 'on' : ''}" data-action="vote" data-type="comments" data-id="${cm.id}" ${!me || (cm.author && me.id === cm.author.id) ? 'disabled' : ''}>▲ ${cm.votes}</button>
        ${me ? `<button data-action="reply" data-id="${cm.id}">Reply</button>` : ''}
        ${i.can.verify && !cm.helpful && cm.author && me && cm.author.id !== me.id ? `<button data-action="helpful" data-id="${cm.id}">Mark helpful (+${meta().points.helpfulComment})</button>` : ''}
        ${me && cm.author && cm.author.id !== me.id ? `<button data-action="report" data-type="comment" data-id="${cm.id}">Report</button>` : ''}
      </div>
      <div class="reply-slot" data-for="${cm.id}"></div>
      ${kids.length ? `<div class="replies">${kids.map(k => commentHtml(i, k, all)).join('')}</div>` : ''}
    </div></div>`;
  }
  function commentForm(ideaId, opts) {
    opts = opts || {};
    return `<form class="stack" style="--gap:6px" data-form="comment" data-idea="${ideaId}" ${opts.correction ? `data-correction="${opts.correction}"` : ''} ${opts.parent ? `data-parent="${opts.parent}"` : ''}>
      <div class="reply-form"><label class="sr" for="cm-${opts.correction || 'idea'}-${opts.parent || 0}">Comment</label><textarea class="input" id="cm-${opts.correction || 'idea'}-${opts.parent || 0}" name="body" rows="2" placeholder="${esc(opts.placeholder || 'Add to the discussion: reasoning, a counter-example, a source…')}" required></textarea><button class="btn primary sm" type="submit">Post</button></div>
      <span class="reminder tex2jax_ignore">Criticise the idea, not the person. Markdown and $math$ work.</span></form>`;
  }

  function correctionsTab(i) {
    const me = state.me;
    const list = i.corrections;
    const accepted = list.filter(c => c.status === 'correct' || c.status === 'partial').length;
    const pending = list.filter(c => c.status === 'pending' || c.status === 'discussion').length;
    const head = `<div class="row between" style="margin-bottom:14px"><p class="muted small">${plural(list.length, 'correction')} · ${accepted} accepted · ${pending} open</p>${me && me.id !== i.author.id ? '<button class="btn sm marker" data-action="challenge">⚑ Challenge this idea</button>' : ''}</div>`;
    if (!list.length) return head + `<div class="empty">No one has challenged this idea yet. If you spot a mistake, a weak assumption or a better approach, ${me ? '<button class="linkish" data-action="challenge">be the first to challenge it</button>' : '<a href="#/login">log in and be the first</a>'}.</div>`;
    return head + `<div class="stack" style="--gap:16px">${list.map(c => {
      const thread = i.comments.filter(x => x.correction_id === c.id);
      const tops = thread.filter(x => !x.parent_id || !thread.some(t => t.id === x.parent_id));
      if (c.hidden && !c.explanation) return `<div class="corr"><div class="corr-body"><p class="muted small">This correction was hidden by a moderator.</p></div></div>`;
      return `<div class="corr ${c.status}" id="corr${c.id}">
        <div class="corr-head">${typeChip(c.type)}${verdictPill(c.status)}${c.applied_in_version ? `<span class="chip">Included in v${c.applied_in_version}</span>` : ''}<span class="grow"></span>${person(c.author, { size: 'sm' })}<span class="tiny muted">${ago(c.created_at)}</span></div>
        <div class="corr-body">
          ${c.quote ? `<div class="quote"><span class="eyebrow">Challenged text</span>${esc(c.quote)}</div>` : ''}
          <div class="corr-section"><span class="eyebrow">Why it's a problem</span><div class="prose compact">${md(c.explanation)}</div></div>
          ${c.suggestion ? `<div class="corr-section suggest"><span class="eyebrow">Suggested correction</span><div class="prose compact">${md(c.suggestion)}</div></div>` : ''}
          ${c.evidence ? `<div class="corr-section"><span class="eyebrow">Evidence / reasoning</span><div class="prose compact">${md(c.evidence)}</div></div>` : ''}
          <div class="row" style="--gap:8px"><button class="btn sm vote ${c.voted ? 'on' : ''}" data-action="vote" data-type="corrections" data-id="${c.id}" ${!me || c.is_mine ? 'disabled' : ''}>▲ Useful <span class="num">${c.votes}</span></button>${me && !c.is_mine ? `<button class="btn sm ghost" data-action="report" data-type="correction" data-id="${c.id}">Report</button>` : ''}</div>
        </div>
        <div class="verdict-box">
          ${c.status !== 'pending' ? `<div class="verdict-final"><div class="stack" style="--gap:2px"><span class="hand">${c.status === 'correct' ? `Correct! +${meta().points.correctionCorrect} to ${esc(c.author.name.split(' ')[0])}` : c.status === 'partial' ? `Partially correct, +${meta().points.correctionPartial}` : c.status === 'incorrect' ? 'Not quite, but thanks for checking' : 'Needs more discussion'}</span>
            <span class="small muted">Decided by ${c.decided_via === 'community' ? `the community (${esc(c.decision_note)})` : `${c.decided_via === 'moderator' ? 'moderator ' : ''}${c.decided_by ? esc(c.decided_by.name) : ''}${c.decided_via === 'author' ? ' (author)' : ''}`} · ${ago(c.decided_at)}</span>
            ${c.decision_note && c.decided_via !== 'community' ? `<span class="small">“${esc(c.decision_note)}”</span>` : ''}</div></div>` : ''}
          ${verdictControls(i, c)}
        </div>
        <div class="thread">
          ${tops.map(cm => commentHtml(i, cm, thread)).join('')}
          ${me ? commentForm(i.id, { correction: c.id, placeholder: 'Discuss this correction…' }) : '<span class="small muted"><a href="#/login">Log in</a> to discuss.</span>'}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function discussionTab(i) {
    const all = i.comments.filter(c => !c.correction_id);
    const tops = all.filter(c => !c.parent_id);
    return `<div class="stack" style="--gap:16px">
      ${state.me ? commentForm(i.id) : loginPrompt('join the discussion')}
      ${tops.length ? tops.map(c => commentHtml(i, c, all)).join('') : '<div class="empty">No discussion yet. Ask a question or add context.</div>'}
    </div>`;
  }

  function wordDiff(a, b) {
    const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
    const n = A.length, m = B.length;
    if (n * m > 4e6) return esc(b);
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) dp[x][y] = A[x] === B[y] ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
    let x = 0, y = 0, out = '';
    while (x < n && y < m) {
      if (A[x] === B[y]) { out += esc(A[x]); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { out += `<del>${esc(A[x])}</del>`; x++; }
      else { out += `<ins>${esc(B[y])}</ins>`; y++; }
    }
    while (x < n) out += `<del>${esc(A[x++])}</del>`;
    while (y < m) out += `<ins>${esc(B[y++])}</ins>`;
    return out.replace(/<\/del><del>/g, '').replace(/<\/ins><ins>/g, '');
  }

  function historyTab(i, q) {
    const ev = [];
    for (const v of i.versions) ev.push({ t: v.created_at, kind: 'version', v });
    for (const c of i.corrections) {
      if (c.hidden && !c.explanation) continue;
      ev.push({ t: c.created_at, kind: 'correction', c });
      if (c.decided_at) ev.push({ t: c.decided_at, kind: 'decision', c });
    }
    const disc = i.comments.filter(c => !c.correction_id);
    if (disc.length) ev.push({ t: disc[0].created_at, kind: 'discussion', n: disc.length });
    if (i.verified_at) ev.push({ t: i.verified_at, kind: 'verified' });
    ev.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const items = ev.map(e => {
      if (e.kind === 'version') return `<div class="tl-item version"><span class="tl-dot">v${e.v.version}</span><div class="tl-body">
        <div class="row" style="--gap:8px"><b>${e.v.version === 1 ? 'Original idea' : `Improved version ${e.v.version}`}</b><span class="tiny muted">${ago(e.v.created_at)} by ${esc(e.v.editor.name)}</span></div>
        <p class="small" style="margin-top:4px">${esc(e.v.change_note)}</p>
        ${e.v.credited.length ? `<p class="small" style="margin-top:4px"><span style="color:var(--accent);font-weight:700">Credited:</span> ${e.v.credited.map(nameLink).join(', ')}</p>` : ''}
        <a class="small" href="#/idea/${i.id}/history?v=${e.v.version}">Read this version</a></div></div>`;
      if (e.kind === 'correction') return `<div class="tl-item correction"><span class="tl-dot">⚑</span><div class="tl-body"><b>${esc(e.c.author ? e.c.author.name : 'Someone')}</b> challenged: ${esc(meta().correction_types[e.c.type].label.toLowerCase())}<div class="tiny muted">${ago(e.c.created_at)}</div>${e.c.quote ? `<div class="quote small" style="margin-top:6px">${esc(e.c.quote)}</div>` : ''}</div></div>`;
      if (e.kind === 'decision') return `<div class="tl-item"><span class="tl-dot">${e.c.status === 'correct' ? '✓' : e.c.status === 'partial' ? '½' : e.c.status === 'incorrect' ? '✕' : '?'}</span><div class="tl-body">${verdictPill(e.c.status)} <span class="small">${esc(e.c.author ? e.c.author.name : '')}'s correction, decided by ${e.c.decided_via === 'community' ? 'the community' : e.c.decided_via}</span><div class="tiny muted">${ago(e.c.decided_at)}</div></div></div>`;
      if (e.kind === 'discussion') return `<div class="tl-item"><span class="tl-dot">💬</span><div class="tl-body"><b>Discussion started</b> <span class="small muted">${plural(e.n, 'comment')} so far</span></div></div>`;
      return `<div class="tl-item verified"><span class="tl-dot">✓</span><div class="tl-body"><b>Solved / Verified</b><div class="tiny muted">${ago(i.verified_at)}</div><p class="small">The author ${i.contributors.length ? `and ${plural(i.contributors.length, 'contributor')} ` : ''}received verification points.</p></div></div>`;
    }).join('');
    const vs = i.versions;
    let diff = '';
    if (vs.length > 1) {
      const from = Number(q.from) || vs[vs.length - 2].version, to = Number(q.to) || vs[vs.length - 1].version;
      const A = vs.find(v => v.version === from) || vs[0], B = vs.find(v => v.version === to) || vs[vs.length - 1];
      const opt = sel => vs.map(v => `<option value="${v.version}" ${v.version === sel ? 'selected' : ''}>v${v.version}</option>`).join('');
      diff = `<div class="panel" style="margin-top:8px"><div class="row between"><h3>Compare versions</h3><div class="row" style="--gap:6px"><label class="sr" for="d-from">From</label><select class="input" style="width:auto" id="d-from" data-diff="from">${opt(A.version)}</select><span>→</span><label class="sr" for="d-to">To</label><select class="input" style="width:auto" id="d-to" data-diff="to">${opt(B.version)}</select></div></div>
        <p class="small muted" style="margin:6px 0 10px"><ins style="background:var(--accent-soft);color:var(--accent);text-decoration:none;font-weight:700">added</ins> and <del style="color:var(--pen)">removed</del> words</p>
        <div class="diff tex2jax_ignore">${A.title !== B.title ? `<b>${wordDiff(A.title, B.title)}</b>\n\n` : ''}${wordDiff(A.body, B.body)}</div></div>`;
    }
    return `<p class="muted small" style="margin-bottom:16px">Every step that changed this idea. ${esc(i.author.name)} keeps the credit for the original idea, and contributors are credited for each improvement.</p>
      <div class="timeline">${items}</div>${diff}`;
  }

  function labTab(i) {
    const me = state.me, L = i.lab;
    if (!L.open) {
      return `<div class="empty" style="text-align:left"><h3>Idea Lab</h3><p style="margin-top:6px">The Lab turns an idea into a shared working draft. Anyone can edit the draft, add open questions and claim tasks. When it's ready, the author publishes it as the next version and every Lab contributor is credited.</p>
        ${i.can.edit && i.status !== 'verified' ? `<button class="btn primary" style="margin-top:12px" data-action="lab-open">Open the Idea Lab for this idea</button>` : `<p class="small" style="margin-top:10px">${i.status === 'verified' ? 'This idea is verified, so the Lab is closed.' : 'Only the author can open the Lab.'}</p>`}
        ${L.edits.length ? `<p class="small muted" style="margin-top:10px">${plural(L.edits.length, 'past Lab edit')}.</p>` : ''}</div>`;
    }
    return `<div class="lab-grid">
      <section class="stack" style="--gap:12px">
        <div class="row between"><div><h3>Shared working draft</h3><p class="small muted">Edit together. Each save is logged with your name.</p></div>
          ${i.can.edit ? `<div class="row" style="--gap:6px"><a class="btn sm primary" href="#/idea/${i.id}/improve?from=lab">Publish draft as v${i.version + 1}</a><button class="btn sm ghost" data-action="lab-close">Close Lab</button></div>` : ''}</div>
        ${me ? `<form class="stack" style="--gap:8px" data-form="lab-edit" data-idea="${i.id}">
          <div class="tabs" style="margin:0"><button type="button" class="on" data-action="lab-view" data-view="edit">Edit</button><button type="button" data-action="lab-view" data-view="preview">Preview</button></div>
          <label class="sr" for="lab-body">Draft</label><textarea class="input code" id="lab-body" name="body" rows="14">${esc(L.draft)}</textarea>
          <div class="preview-box prose" id="lab-preview" hidden></div>
          <div class="row"><label class="sr" for="lab-note">What did you change?</label><input class="input grow" id="lab-note" name="note" placeholder="What did you change? (e.g. fixed the energy estimate)" maxlength="300"><button class="btn primary" type="submit">Save to draft</button></div>
        </form>` : `<div class="preview-box prose">${md(L.draft)}</div>${loginPrompt('edit the Lab draft')}`}
      </section>
      <aside class="stack" style="--gap:16px">
        <div class="panel"><h3>Open questions</h3>
          <div style="margin-top:6px">${L.tasks.map(t => `<div class="task ${t.done ? 'done' : ''}"><span>${t.done ? '✅' : '◻️'}</span><div class="grow"><div class="text small">${esc(t.text)}</div><div class="tiny muted">${t.claimed_by ? `${t.done ? 'Done by' : 'Taken by'} ${esc(t.claimed_by.name)}` : 'Unclaimed'}</div>
            ${me ? `<div class="row" style="--gap:10px;margin-top:4px">${!t.done && !t.claimed_by ? `<button class="linkish tiny" data-action="task" data-id="${t.id}" data-do="claim">I'll take this</button>` : ''}${!t.done && t.claimed_by && t.claimed_by.id === me.id ? `<button class="linkish tiny" data-action="task" data-id="${t.id}" data-do="unclaim">Unclaim</button>` : ''}${!t.done ? `<button class="linkish tiny" data-action="task" data-id="${t.id}" data-do="done">Mark done</button>` : `<button class="linkish tiny" data-action="task" data-id="${t.id}" data-do="undo">Reopen</button>`}</div>` : ''}</div></div>`).join('') || '<p class="small muted">No open questions yet.</p>'}</div>
          ${me ? `<form class="row" style="--gap:6px;margin-top:10px" data-form="lab-task" data-idea="${i.id}"><label class="sr" for="task-text">New question</label><input class="input grow" id="task-text" name="text" placeholder="Add an open question" required maxlength="300"><button class="btn sm" type="submit">Add</button></form>` : ''}
        </div>
        <div class="panel"><h3>Lab activity</h3>
          ${L.pending_contributors.length ? `<p class="small" style="margin:6px 0"><b>Will be credited in v${i.version + 1}:</b> ${L.pending_contributors.map(u => esc(u.name)).join(', ')}</p>` : ''}
          <div class="side-list">${L.edits.slice(0, 8).map(e => `<div class="small">${nameLink(e.editor)} · <span class="muted">${ago(e.created_at)}</span><div>${esc(e.note)}</div></div>`).join('') || '<p class="small muted">No edits yet.</p>'}</div></div>
      </aside></div>`;
  }

  pages.idea.after = r => {
    const i = state.idea;
    $$('[data-diff]').forEach(s => s.addEventListener('change', () => go(`#/idea/${i.id}/history?from=${$('#d-from').value}&to=${$('#d-to').value}`)));
  };

  // ── improve (new version) ──
  pages.improve = async r => {
    if (!state.me) return loginPrompt('publish an improved version');
    const i = await api('GET', `/api/ideas/${r.id}`);
    if (!i.can.edit) return `<div class="empty">Only the author can publish a new version. You can <a href="#/idea/${i.id}/corrections">challenge the idea</a> or help in the <a href="#/idea/${i.id}/lab">Idea Lab</a>.</div>`;
    state.idea = i;
    state.title = 'Improve: ' + i.title;
    const fromLab = r.query.from === 'lab' && i.lab.open;
    const accepted = i.corrections.filter(c => c.status === 'correct' || c.status === 'partial');
    return `<div class="page-head"><div><a class="small" href="#/idea/${i.id}">← Back to the idea</a><h1 style="margin-top:6px">Publish version ${i.version + 1}</h1><p>Update the idea with what you learned. Tick the corrections you used so their authors get credit (+${meta().points.credited} each).</p></div></div>
    <form class="split" data-form="version" data-idea="${i.id}">
      <div class="stack" style="--gap:14px">
        <label class="field"><span>Title</span><input class="input" id="v-title" name="title" value="${esc(i.title)}" maxlength="160" required></label>
        <label class="field"><span>Improved description</span><textarea class="input code" id="v-body" name="body" rows="16" required>${esc(fromLab ? i.lab.draft : i.body)}</textarea><small class="tex2jax_ignore">Markdown, \`code\`, $inline$ and $$display$$ maths are supported.</small></label>
        <label class="field"><span>What changed?</span><input class="input" id="v-note" name="change_note" placeholder="e.g. Fixed the probability using the birthday problem" maxlength="1000" required></label>
        <fieldset class="panel stack" style="--gap:8px"><legend class="eyebrow" style="padding:0 6px">Credit contributors</legend>
          ${accepted.length ? accepted.map(c => `<label class="check"><input type="checkbox" id="cc-${c.id}" name="corr" value="${c.id}" ${!c.applied_in_version ? 'checked' : ''}><span><b>${esc(c.author.name)}</b>: ${esc(meta().correction_types[c.type].label)} ${verdictPill(c.status)}${c.applied_in_version ? ` <span class="tiny muted">(already in v${c.applied_in_version})</span>` : ''}<br><span class="small muted">${esc(c.explanation.replace(/[*$`]/g, '').slice(0, 120))}…</span></span></label>`).join('') : '<p class="small muted">No accepted corrections yet.</p>'}
          ${i.lab.pending_contributors.length ? `<label class="check"><input type="checkbox" id="cc-lab" name="credit_lab" ${fromLab ? 'checked' : ''}><span>Credit Idea Lab contributors: <b>${i.lab.pending_contributors.map(u => esc(u.name)).join(', ')}</b></span></label>` : ''}
        </fieldset>
        <div class="form-error error-box" hidden></div>
        <div class="row"><button class="btn primary" type="submit">Publish version ${i.version + 1}</button><a class="btn ghost" href="#/idea/${i.id}">Cancel</a></div>
      </div>
      <div class="stack" style="--gap:8px"><span class="eyebrow">Live preview</span><div class="preview-box prose" id="v-preview">${md(fromLab ? i.lab.draft : i.body)}</div></div>
    </form>`;
  };
  pages.improve.after = () => {
    const b = $('#v-body');
    if (b) b.addEventListener('input', debounce(() => { const p = $('#v-preview'); if (!p) return; p.innerHTML = md(b.value); enhance(p); }, 350));
  };

  // ── new idea ──
  pages.new = async r => {
    state.title = 'Share an idea';
    if (!state.me) return `<div class="auth-wrap"><h1>Share an idea</h1><p class="muted" style="margin:8px 0 16px">You need an account so you get credit for your idea.</p>${loginPrompt('share an idea')}</div>`;
    const m = meta();
    const ch = await api('GET', '/api/challenges');
    const current = ch.challenges.find(c => c.id === ch.current);
    const draft = (() => { try { return JSON.parse(localStorage.getItem('ideahub-draft') || 'null'); } catch { return null; } })() || {};
    const pre = r.query.challenge ? Number(r.query.challenge) : '';
    return `<div class="page-head"><div><h1>Share an idea</h1><p>Unfinished is welcome. Say what you're unsure about and other students will help you improve it.</p></div></div>
    <form class="split" data-form="idea">
      <div class="stack" style="--gap:14px">
        <label class="field"><span>Title</span><input class="input" id="n-title" name="title" required maxlength="160" placeholder="e.g. Rooftop solar could power all of DDUC" value="${esc(draft.title || '')}"></label>
        <div class="form-grid">
          <label class="field"><span>Category</span><select class="input" id="n-category" name="category" required><option value="">Choose…</option>${m.categories.map(c => `<option value="${c.slug}" ${draft.category === c.slug ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Type</span><select class="input" id="n-kind" name="kind"><option value="idea">Idea / proposal</option><option value="problem" ${draft.kind === 'problem' ? 'selected' : ''}>Unsolved problem / question</option></select></label>
          <label class="field"><span>Difficulty</span><select class="input" id="n-difficulty" name="difficulty">${m.difficulties.map(d => `<option value="${d}" ${(draft.difficulty || 'intermediate') === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Describe your idea</span><textarea class="input code" id="n-body" name="body" rows="14" required placeholder="What's the idea? How does it work? What are you unsure about?&#10;&#10;Maths: $E = mc^2$ or $$\\sum_{k=1}^n k = \\frac{n(n+1)}{2}$$&#10;Code: wrap it in \`\`\` fences.">${esc(draft.body || '')}</textarea><small>Markdown, code blocks and LaTeX maths are supported. Your draft is saved on this device as you type.</small></label>
        <label class="field"><span>Image links <span class="muted small">(optional, one per line)</span></span><textarea class="input" id="n-images" name="images" rows="2" placeholder="https://…">${esc(draft.images || '')}</textarea></label>
        <label class="field"><span>Sources / inspiration <span class="muted small">(optional)</span></span><input class="input" id="n-sources" name="sources" maxlength="2000" placeholder="Where did this come from? Credit others' work here." value="${esc(draft.sources || '')}"></label>
        ${current ? `<label class="field"><span>Weekly challenge</span><select class="input" id="n-challenge" name="challenge_id"><option value="">Not a challenge entry</option><option value="${current.id}" ${pre === current.id ? 'selected' : ''}>🎯 ${esc(current.title)}</option></select></label>` : ''}
        <label class="check"><input type="checkbox" id="n-help" name="needs_help" ${draft.needs_help ? 'checked' : ''}><span><b>I know this is unfinished, please review it.</b><br><span class="small muted">Puts it in the "Needs review" feed.</span></span></label>
        <div id="similar"></div>
        <div class="form-error error-box" hidden></div>
        <div class="row"><button class="btn primary" type="submit">Publish idea</button><span class="small muted">You'll get +${m.points.postIdea} reputation, and much more when you accept corrections.</span></div>
      </div>
      <div class="stack" style="--gap:8px"><span class="eyebrow">Live preview</span><div class="preview-box prose" id="n-preview"><p class="muted">Start typing to see how your idea will look.</p></div>
        <div class="panel small"><b>Tips for a good idea post</b><ul style="margin:6px 0 0;padding-left:18px;color:var(--muted)"><li>State your assumptions so others can check them.</li><li>Show your working for calculations.</li><li>Say what you're least sure about.</li></ul></div></div>
    </form>`;
  };
  pages.new.after = () => {
    const f = $('form[data-form=idea]');
    if (!f) return;
    const save = debounce(() => {
      const d = Object.fromEntries(new FormData(f)); d.needs_help = !!d.needs_help;
      try { localStorage.setItem('ideahub-draft', JSON.stringify(d)); } catch (e) { /* storage unavailable */ }
    }, 400);
    const preview = debounce(() => { const p = $('#n-preview'); if (!p) return; const v = $('#n-body').value; p.innerHTML = v ? md(v) : '<p class="muted">Start typing to see how your idea will look.</p>'; enhance(p); }, 350);
    const sim = debounce(async () => {
      if (!$('#similar')) return;
      const t = $('#n-title').value, b = $('#n-body').value;
      if ((t + b).length < 25) { $('#similar').innerHTML = ''; return; }
      const list = await api('POST', '/api/ideas/similar', { title: t, body: b });
      if (!$('#similar')) return;
      $('#similar').innerHTML = list.length ? `<div class="similar"><b>Similar ideas already exist.</b> Have a look: you could challenge or build on one of them instead, and remember to credit others in Sources.<ul style="margin:6px 0 0;padding-left:18px">${list.map(s => `<li><a href="#/idea/${s.id}" target="_blank">${esc(s.title)}</a> <span class="muted">by ${esc(s.author.name)} · ${s.similarity}% similar</span></li>`).join('')}</ul></div>` : '';
    }, 700);
    f.addEventListener('input', () => { save(); preview(); sim(); });
    if ($('#n-body').value) preview();
  };

  // ── profile ──
  pages.profile = async r => {
    const p = await api('GET', `/api/users/${r.id}`);
    state.title = p.name;
    const tab = r.tab;
    const L = p.level;
    const tabs = [['ideas', 'Ideas', p.ideas.length], ['corrections', 'Corrections', p.corrections.length], ['improved', 'Ideas improved', p.improved_ideas.length], ['reputation', 'Reputation history', '']];
    let body;
    if (tab === 'corrections') body = p.corrections.length ? `<div class="stack" style="--gap:10px">${p.corrections.map(c => `<a class="panel" href="#/idea/${c.idea_id}/corrections" style="color:inherit;text-decoration:none;display:flex;flex-direction:column;gap:6px"><div class="row" style="--gap:6px">${typeChip(c.type)}${verdictPill(c.status)}${c.applied_in_version ? `<span class="chip">In v${c.applied_in_version}</span>` : ''}<span class="tiny muted">${ago(c.created_at)}</span></div><b>${esc(c.idea_title)}</b><span class="small muted">${esc(c.explanation.replace(/[*$`]/g, ''))}</span></a>`).join('')}</div>` : '<div class="empty">No corrections yet.</div>';
    else if (tab === 'improved') body = cards(p.improved_ideas, 'Not credited on any improved ideas yet.');
    else if (tab === 'reputation') body = p.reputation_history.length ? `<div class="panel">${p.reputation_history.map(e => `<div class="rep-row"><span class="pts ${e.points < 0 ? 'neg' : ''}">${e.points > 0 ? '+' : ''}${e.points}</span><span>${e.idea_id ? `<a href="#/idea/${e.idea_id}">${esc(e.reason)}</a>` : esc(e.reason)}${e.kind === 'improvement' ? ' <span class="chip tiny" style="padding:0 6px">improvement</span>' : ''}</span><span class="tiny muted">${ago(e.created_at)}</span></div>`).join('')}</div>` : '<div class="empty">No reputation yet.</div>';
    else body = cards(p.ideas, 'No ideas shared yet.');
    return `<section class="panel stack" style="--gap:18px">
      <div class="profile-head">${av(p, 'lg')}
        <div class="stack" style="--gap:6px"><h1>${esc(p.name)}${p.role === 'moderator' ? ' <span class="chip">Moderator</span>' : ''}</h1><p class="muted"><span class="handle">@${esc(p.username)}</span> · ${esc(p.course)} · ${yr(p.year)} · joined ${fmtDate(p.created_at)}</p>${p.bio ? `<p>${esc(p.bio)}</p>` : ''}<div class="row" style="--gap:6px">${p.interests.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>
        <div class="stack" style="--gap:8px;min-width:220px"><div class="row between"><span class="eyebrow">Level ${L.index} · ${esc(L.name)}</span><b class="num" style="font-size:1.4rem">${p.reputation}</b></div>
          <div class="level-bar" role="progressbar" aria-valuenow="${L.progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${L.progress}%"></i></div>
          <span class="tiny muted">${L.next ? `${L.nextAt - p.reputation} points to ${esc(L.next)}` : 'Highest level reached'}</span>
          <span class="small">🔥 ${p.streak}-day streak <span class="muted">(best ${p.best_streak})</span></span>
          ${p.is_me ? `<div class="row" style="--gap:6px"><a class="btn sm" href="#/settings">Edit profile</a><button class="btn sm ghost" data-action="logout">Log out</button></div>` : ''}</div>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${p.counts.improvement_points}</b><span>improvement points</span></div>
        <div class="stat"><b>${p.counts.accepted}</b><span>corrections accepted</span></div>
        <div class="stat"><b>${p.counts.corrections}</b><span>corrections made</span></div>
        <div class="stat"><b>${p.counts.improved}</b><span>ideas improved</span></div>
        <div class="stat"><b>${p.counts.ideas}</b><span>ideas posted</span></div>
        <div class="stat"><b>${p.counts.helpful}</b><span>helpful explanations</span></div>
      </div>
      <div><h3 style="margin-bottom:10px">Badges <span class="small muted">${p.badges_detail.filter(b => b.earned).length} of ${p.badges_detail.length}</span></h3>
        <div class="badges">${p.badges_detail.sort((a, b) => b.earned - a.earned).map(b => `<div class="badge ${b.earned ? '' : 'locked'}" title="${esc(b.desc)}"><span class="ic">${b.icon}</span><div><b>${esc(b.name)}</b><small>${b.earned ? 'Earned ' + fmtDate(b.awarded_at) : esc(b.desc)}</small></div></div>`).join('')}</div></div>
    </section>
    <div class="tabs" style="margin-top:24px">${tabs.map(([k, l, n]) => `<a class="${tab === k ? 'on' : ''}" href="#/u/${p.id}/${k}">${l}${n !== '' ? `<span class="count">${n}</span>` : ''}</a>`).join('')}</div>
    ${body}`;
  };

  // ── leaderboard ──
  pages.leaderboard = async r => {
    const period = r.query.period || 'week';
    const course = r.query.course || '';
    const lb = await api('GET', '/api/leaderboard' + qs({ period, course }));
    state.title = 'Leaderboard';
    const me = state.me;
    const rows = lb.improvers;
    const top = rows.slice(0, 3);
    const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
    return `<div class="page-head"><div><h1>Top Idea Improvers at DDUC</h1><p>Ranked by improvement points: verified corrections, credits in improved versions, helpful explanations and accurate reviews. Likes on your own posts don't count here.</p></div></div>
      <div class="row between" style="margin-bottom:16px">
        <div class="tabs" style="margin:0;border:0">${[['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([k, l]) => `<a class="${period === k ? 'on' : ''}" href="#/leaderboard${qs({ period: k, course })}">${l}</a>`).join('')}</div>
        <label class="field" style="min-width:220px"><span class="sr">Course</span><select class="input" id="lb-course" data-lb-course><option value="">All courses</option>${meta().courses.map(c => `<option ${c === course ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      </div>
      ${rows.length ? `<div class="podium">${order.map(rw => `<a class="p ${rw.rank === 1 ? 'first' : ''}" href="#/u/${rw.user.id}" style="color:inherit;text-decoration:none"><span class="medal">${['🥇', '🥈', '🥉'][rw.rank - 1]}</span>${av(rw.user, 'md')}<b>${esc(rw.user.name)}</b><span class="tiny muted">${esc(rw.user.course)}</span><span class="pts">${rw.points}</span><span class="tiny muted">${plural(rw.accepted, 'accepted correction')}</span></a>`).join('')}</div>
      <div class="panel table-wrap"><table class="lb"><thead><tr><th class="n">#</th><th>Student</th><th class="n">Points</th><th class="n">Accepted</th><th class="n">Ideas improved</th><th>Badges</th></tr></thead><tbody>
        ${rows.map(rw => `<tr class="${me && rw.user.id === me.id ? 'me-row' : ''}"><td class="n">${rw.rank}</td><td>${person(rw.user, { rep: false })}</td><td class="n"><b>${rw.points}</b></td><td class="n">${rw.accepted}</td><td class="n">${rw.ideas_improved}</td><td><span class="mini-badges">${badgeIcons(rw.user, 5)}</span></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">No improvement points ${period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'yet'}${course ? ' in this course' : ''}. <a href="#/explore?status=unsolved">Find an idea to improve</a> and you'll be first.</div>`}
      ${lb.open_minds.length ? `<div class="panel" style="margin-top:22px"><h3>Open Minds</h3><p class="small muted" style="margin:4px 0 8px">Authors who accept corrections and get their ideas verified.</p>
        <div class="side-list">${lb.open_minds.map(o => `<div class="row between">${person(o.user, { rep: false })}<span class="small muted">${plural(o.accepted_on_own, 'correction')} accepted · ${o.verified} verified</span></div>`).join('')}</div></div>` : ''}`;
  };
  pages.leaderboard.after = () => { const s = $('[data-lb-course]'); if (s) s.addEventListener('change', () => go('#/leaderboard' + qs({ period: state.route.query.period || 'week', course: s.value }))); };

  // ── recognition ──
  pages.recognition = async () => {
    const rc = await api('GET', '/api/recognition');
    state.title = 'Recognition';
    return `<div class="page-head"><div><h1>Recognition wall</h1><p>The students who made other people's ideas better. Every name here earned it by finding a real mistake or improving an idea, and having that confirmed.</p></div></div>
      ${rc.improvers.length ? `<div class="wall">${rc.improvers.map(r => `<a class="panel" href="#/u/${r.user.id}" style="color:inherit;text-decoration:none"><div class="row" style="--gap:12px;flex-wrap:nowrap">${av(r.user, 'md')}<div class="grow"><b>${esc(r.user.name)}</b><div class="tiny muted">${esc(r.user.course)} · ${yr(r.user.year)}</div></div><span class="rankno">#${r.rank}</span></div>
        <div class="row" style="--gap:14px"><span><b class="num">${r.points}</b> <span class="small muted">improvement pts</span></span><span><b class="num">${r.accepted}</b> <span class="small muted">accepted</span></span></div>
        <div class="row" style="--gap:6px">${r.user.badges.map(b => `<span class="chip" title="${esc(meta().badges[b].desc)}">${meta().badges[b].icon} ${esc(meta().badges[b].name)}</span>`).join('')}</div>
        <span class="chip" style="align-self:flex-start">Level ${r.user.level.index} · ${esc(r.user.level.name)}</span></a>`).join('')}</div>` : '<div class="empty">No one has been recognised yet.</div>'}
      <h2 style="margin:34px 0 14px">Improvement stories</h2>
      <div class="stack" style="--gap:14px">${rc.stories.map(s => `<a class="panel story" href="#/idea/${s.idea_id}/history" style="color:inherit;text-decoration:none">
        <div class="row" style="--gap:6px"><span class="chip">${cat(s.category).icon} ${esc(cat(s.category).name)}</span>${statusPill(s.idea_status)}<span class="tiny muted">${ago(s.decided_at)}</span></div>
        <h3>${esc(s.idea_title)}</h3>
        ${s.quote ? `<div class="small"><span class="muted">${esc(s.author.name)} wrote:</span> <span class="strike">${esc(s.quote)}</span></div>` : ''}
        <div class="small"><b style="color:var(--accent)">${esc(s.corrector.name)}</b> <span class="muted">(${esc(s.corrector.course)})</span> found a ${esc(meta().correction_types[s.type].label.toLowerCase())}: ${esc(s.explanation.replace(/[*$`]/g, '').slice(0, 200))}${s.explanation.length > 200 ? '…' : ''}</div>
        ${s.applied_in_version ? `<span class="hand">Fixed in version ${s.applied_in_version}</span>` : '<span class="small muted">Accepted, waiting for an updated version</span>'}
      </a>`).join('') || '<div class="empty">No stories yet.</div>'}</div>`;
  };

  // ── challenges ──
  pages.challenges = async () => {
    const ch = await api('GET', '/api/challenges');
    state.title = 'Weekly challenges';
    const cur = ch.challenges.find(c => c.id === ch.current);
    const entries = cur ? (await api('GET', '/api/ideas' + qs({ challenge: cur.id, sort: 'trending' }))).ideas : [];
    const me = state.me;
    return `<div class="page-head"><div><h1>Weekly challenges</h1><p>A new prompt every week to get people sharing, reviewing and improving outside their comfort zone.</p></div></div>
      ${cur ? `<section class="challenge-band"><span class="big" aria-hidden="true">🎯</span><div><div class="eyebrow">This week · ${fmtDate(cur.starts_on + 'T12:00:00Z')} to ${fmtDate(cur.ends_on + 'T12:00:00Z')}</div><h2 style="margin:4px 0">${esc(cur.title)}</h2><p>${esc(cur.prompt)}</p></div><a class="btn marker" href="#/new?challenge=${cur.id}">Submit an idea</a></section>
        <h3 style="margin-bottom:12px">Entries <span class="muted small">${entries.length}</span></h3>${cards(entries, 'No entries yet. Submit the first one, or challenge an idea from another subject.')}` : '<div class="empty">No challenge is running this week.</div>'}
      <h3 style="margin:30px 0 12px">All challenges</h3>
      <div class="panel side-list">${ch.challenges.map(c => `<div class="row between"><div><b>${esc(c.title)}</b><div class="small muted">${fmtDate(c.starts_on + 'T12:00:00Z')} to ${fmtDate(c.ends_on + 'T12:00:00Z')} · ${plural(c.entries, 'entry', 'entries')}</div></div>${c.id === ch.current ? '<span class="pill st-improving">Running</span>' : c.upcoming ? '<span class="pill st-open">Upcoming</span>' : '<span class="pill cv-incorrect">Finished</span>'}</div>`).join('')}</div>
      ${me && me.role === 'moderator' ? `<form class="panel stack" style="--gap:10px;margin-top:20px" data-form="challenge-new"><h3>Create a challenge (moderators)</h3>
        <label class="field"><span>Title</span><input class="input" id="c-title" name="title" required></label>
        <label class="field"><span>Prompt</span><textarea class="input" id="c-prompt" name="prompt" rows="3" required></textarea></label>
        <div class="form-grid"><label class="field"><span>Starts</span><input class="input" type="date" id="c-start" name="starts_on" required></label><label class="field"><span>Ends</span><input class="input" type="date" id="c-end" name="ends_on" required></label>
        <label class="field"><span>Category (optional)</span><select class="input" id="c-cat" name="category"><option value="">Any</option>${meta().categories.map(c => `<option value="${c.slug}">${esc(c.name)}</option>`).join('')}</select></label></div>
        <div><button class="btn primary" type="submit">Create challenge</button></div></form>` : ''}`;
  };

  // ── lab list ──
  pages.lab = async () => {
    const res = await api('GET', '/api/ideas' + qs({ lab: 1, sort: 'active' }));
    state.title = 'Idea Lab';
    return `<div class="page-head"><div><h1>Idea Lab</h1><p>Some ideas need more than comments. In the Lab, students edit a shared draft together, split up open questions and get credited when the author publishes the result.</p></div></div>
      ${cards(res.ideas, 'No Labs are open right now. Authors can open one from the "Idea Lab" tab of their idea.')}`;
  };

  // ── moderation ──
  pages.moderation = async () => {
    state.title = 'Moderation';
    if (!state.me || state.me.role !== 'moderator') return '<div class="empty">This page is for moderators.</div>';
    const list = await api('GET', '/api/moderation/reports');
    const open = list.filter(r => r.status === 'open');
    const done = list.filter(r => r.status !== 'open');
    const row = r => `<div class="panel stack" style="--gap:8px"><div class="row" style="--gap:8px"><span class="pill ${r.status === 'open' ? 'st-improving' : r.status === 'hidden' ? 'cv-incorrect' : 'st-verified'}">${r.status === 'open' ? 'Open' : r.status === 'hidden' ? 'Hidden' : 'Dismissed'}</span><span class="chip">${esc(r.reason_label)}</span><span class="chip">${esc(r.target_type)}</span>${r.target_hidden ? '<span class="chip tag-problem">Currently hidden</span>' : ''}<span class="tiny muted">${ago(r.created_at)}</span></div>
      <div class="quote small">${esc(r.preview)}</div>
      <div class="small muted">Posted by ${r.target_author ? esc(r.target_author.name) : 'unknown'} · reported by ${esc(r.reporter.name)}${r.details ? `: “${esc(r.details)}”` : ''}</div>
      <div class="row" style="--gap:6px">${r.idea_id ? `<a class="btn sm ghost" href="#/idea/${r.idea_id}/${r.target_type === 'comment' ? 'discussion' : r.target_type === 'correction' ? 'corrections' : 'corrections'}">View in context</a>` : ''}${r.status === 'open' ? `<button class="btn sm" data-action="mod" data-id="${r.id}" data-do="hide">Hide content</button><button class="btn sm ghost" data-action="mod" data-id="${r.id}" data-do="dismiss">Dismiss (keep visible)</button>` : r.target_hidden ? `<button class="btn sm ghost" data-action="mod" data-id="${r.id}" data-do="restore">Restore content</button>` : ''}</div></div>`;
    return `<div class="page-head"><div><h1>Moderation queue</h1><p>Hide bullying, harassment, plagiarism, spam and personal attacks. Content with ${3} open reports is hidden automatically until you review it.</p></div></div>
      <h3 style="margin-bottom:10px">Open <span class="muted small">${open.length}</span></h3><div class="stack">${open.map(row).join('') || '<div class="empty">Nothing to review. 🎉</div>'}</div>
      <h3 style="margin:24px 0 10px">Resolved</h3><div class="stack">${done.slice(0, 20).map(row).join('') || '<p class="small muted">No resolved reports.</p>'}</div>`;
  };

  // ── notifications ──
  pages.notifications = async () => {
    state.title = 'Notifications';
    if (!state.me) return loginPrompt('see notifications');
    const list = await api('GET', '/api/notifications');
    if (state.unread) { await api('POST', '/api/notifications/read'); state.unread = 0; renderShell(); }
    return `<div class="page-head"><h1>Notifications</h1></div><div class="panel">${list.map(n => `<a class="notif ${n.read ? 'read' : 'unread'}" href="${esc(n.link || '#/')}" style="color:inherit;text-decoration:none"><div class="grow">${esc(n.text)}<div class="tiny muted">${ago(n.created_at)}</div></div></a>`).join('') || '<p class="muted">No notifications yet.</p>'}</div>`;
  };

  // ── auth ──
  function authShell(form) {
    return `<div class="auth-layout">
      <section class="auth-intro">
        <div class="eyebrow">For students of Deen Dayal Upadhyaya College, University of Delhi</div>
        <h1>Share an idea. <span class="hl">Find a mistake.</span> <span class="fix">Improve it together.</span></h1>
        <p class="lede">Post the half-finished thought or the shaky calculation. Other students point out what's missing, and the ones who fix it get the credit.</p>
        <ul class="auth-points">
          <li><span class="tick">1</span><span><b>Share it unfinished.</b> Ideas, maths, code, startups, campus fixes.</span></li>
          <li><span class="tick">2</span><span><b>Challenge ideas, not people.</b> Quote the line, explain, suggest a fix.</span></li>
          <li><span class="tick">3</span><span><b>Get credit when it's verified.</b> Reputation, badges and your name on the improved version.</span></li>
        </ul>
      </section>
      ${form}
    </div>`;
  }
  pages.login = async () => {
    state.title = 'Log in';
    if (state.me) { setTimeout(() => go('#/'), 0); return ''; }
    return authShell(`<form class="auth-card stack" style="--gap:14px" data-form="login" autocomplete="on">
        <div><h2>Log in</h2><p class="small muted" style="margin-top:4px">Use the username and password you registered with.</p></div>
        <label class="field"><span>Username</span><input class="input" id="l-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label class="field"><span>Password</span><input class="input" type="password" id="l-pass" name="password" autocomplete="current-password" required></label>
        <label class="check small"><input type="checkbox" id="l-remember" name="remember"><span>Keep me logged in on this device</span></label>
        <div class="form-error error-box" hidden></div>
        <button class="btn primary" type="submit">Log in</button>
        <p class="small muted">New here? <a href="#/signup">Create an account</a></p>
      </form>`);
  };
  pages.signup = async () => {
    state.title = 'Create account';
    if (state.me) { setTimeout(() => go('#/'), 0); return ''; }
    const m = meta();
    return authShell(`<form class="auth-card stack" style="--gap:14px" data-form="signup" autocomplete="on">
        <div><h2>Create your account</h2><p class="small muted" style="margin-top:4px">Pick a username. You'll log in with it and your password every time.</p></div>
        <label class="field"><span>Username</span><input class="input" id="s-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_.]{3,20}" placeholder="e.g. priya_maths"><small id="s-user-msg">3 to 20 letters, numbers, dots or underscores. It must be unique.</small></label>
        <label class="field"><span>Full name</span><input class="input" id="s-name" name="name" autocomplete="name" required maxlength="80"><small>Shown on your ideas and corrections so you get credit.</small></label>
        <div class="form-grid">
          <label class="field"><span>Password</span><input class="input" type="password" id="s-pass" name="password" autocomplete="new-password" minlength="6" required><small>At least 6 characters.</small></label>
          <label class="field"><span>Confirm password</span><input class="input" type="password" id="s-pass2" name="password2" autocomplete="new-password" minlength="6" required></label>
        </div>
        <div class="form-grid"><label class="field"><span>Course</span><select class="input" id="s-course" name="course" required><option value="">Choose…</option>${m.courses.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Year</span><select class="input" id="s-year" name="year" required>${[1, 2, 3, 4].map(y => `<option value="${y}">${yr(y)}</option>`).join('')}</select></label></div>
        <label class="field"><span>Interests <span class="muted small">(optional)</span></span><input class="input" id="s-int" name="interests" placeholder="e.g. Probability, Robotics, Startups"></label>
        <label class="check"><input type="checkbox" id="s-pledge" name="pledge" required><span><b>I'll criticise ideas, not people.</b><br><span class="small muted">No bullying, harassment, plagiarism, spam or personal attacks. <a href="#/guidelines">Guidelines</a></span></span></label>
        <label class="check small"><input type="checkbox" id="s-remember" name="remember"><span>Keep me logged in on this device</span></label>
        <div class="form-error error-box" hidden></div>
        <button class="btn primary" type="submit">Create account</button>
        <p class="small muted">Already registered? <a href="#/login">Log in</a></p>
      </form>`);
  };
  pages.signup.after = () => {
    const input = $('#s-user'), msg = $('#s-user-msg');
    if (!input) return;
    const check = debounce(async () => {
      const v = input.value.trim();
      if (!v) { msg.className = ''; msg.textContent = '3 to 20 letters, numbers, dots or underscores. It must be unique.'; return; }
      const r = await api('GET', '/api/username-available' + qs({ u: v })).catch(() => null);
      if (!r || !$('#s-user-msg') || input.value.trim() !== v) return;
      msg.className = r.available ? 'ok-text' : 'bad-text';
      msg.textContent = r.available ? `@${r.username} is available` : r.reason;
    }, 350);
    input.addEventListener('input', check);
  };
  pages.settings = async () => {
    state.title = 'Edit profile';
    if (!state.me) return loginPrompt('edit your profile');
    const u = state.me, m = meta();
    return `<div class="auth-wrap stack" style="--gap:18px"><h1>Edit profile</h1>
      <form class="panel stack" style="--gap:12px" data-form="settings">
        <label class="field"><span>Name</span><input class="input" id="e-name" name="name" value="${esc(u.name)}" required></label>
        <div class="form-grid"><label class="field"><span>Course</span><select class="input" id="e-course" name="course">${m.courses.map(c => `<option ${c === u.course ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Year</span><select class="input" id="e-year" name="year">${[1, 2, 3, 4, 5].map(y => `<option value="${y}" ${y === u.year ? 'selected' : ''}>${yr(y)}</option>`).join('')}</select></label></div>
        <label class="field"><span>Bio</span><textarea class="input" id="e-bio" name="bio" rows="3" maxlength="500">${esc(u.bio)}</textarea></label>
        <label class="field"><span>Interests</span><input class="input" id="e-int" name="interests" value="${esc(u.interests.join(', '))}"><small>Comma separated.</small></label>
        <div class="form-error error-box" hidden></div>
        <div class="row"><button class="btn primary" type="submit">Save profile</button><a class="btn ghost" href="#/u/${u.id}">Cancel</a></div>
      </form></div>`;
  };

  // ── guidelines ──
  pages.guidelines = async () => {
    state.title = 'Guidelines';
    const m = meta(), P = m.points;
    const rows = [['Your correction is verified Correct', P.correctionCorrect], ['Your correction is Partially correct', P.correctionPartial], ['You are credited in an improved version', P.credited], ['An idea you helped improve gets Verified', P.verifiedContributor], ['Your own idea gets Verified', P.verifiedAuthor], ['You accept a correction on your idea', P.acceptCorrection], ['The author marks your explanation helpful', P.helpfulComment], ['Your community verdict matched the final one', P.matchedVerdict], [`Upvote on your correction (first ${P.upvoteCap})`, P.correctionUpvote], [`Upvote on your idea (first ${P.upvoteCap})`, P.ideaUpvote], [`Posting an idea (first ${P.postIdeaDailyCap} a day)`, P.postIdea], ['Your correction is marked Incorrect', 0]];
    return `<div class="page-head"><div><h1>Community guidelines</h1><p>IdeaHub exists so students can think out loud. That only works if posting an imperfect idea feels safe.</p></div></div>
      <div class="split">
        <section class="stack" style="--gap:14px">
          <div class="pledge" style="margin:0"><span class="hand">Criticise the idea, not the person.</span></div>
          <div class="panel prose compact">
            <h3>Do</h3><ul><li>Quote the exact part you're challenging.</li><li>Explain why, and show your working or a source.</li><li>Suggest a better version, not just "this is wrong".</li><li>Credit others' work in Sources. Copying someone's idea without credit is plagiarism.</li><li>Accept good corrections. It earns you points and the Open Mind badge.</li></ul>
            <h3>Don't</h3><ul><li>Insult, mock or label people ("you're dumb", "what a joke"). The site blocks messages like these and asks you to rephrase.</li><li>Bully, harass or pile on.</li><li>Post spam, ads or the same idea repeatedly.</li><li>Upvote-trade. Upvotes earn very few points on purpose.</li></ul>
            <h3>How a correction is accepted</h3><p>Nobody's correction is accepted just because they wrote it. The <b>idea's author</b> or a <b>moderator</b> gives a final verdict, or <b>${m.quorum} reviewers</b> with ${m.reviewer_min_rep}+ reputation agree. Verdicts are Correct, Partially correct, Incorrect or Needs discussion.</p>
            <h3>Reporting</h3><p>Use Report on any idea, correction or comment. Moderators review every report, and anything with 3 open reports is hidden until they do.</p>
          </div>
        </section>
        <section class="stack" style="--gap:14px">
          <div class="panel"><h3>How reputation works</h3><p class="small muted" style="margin:4px 0 8px">Most points come from improving ideas, not from being liked.</p><table class="points-table">${rows.map(([l, p]) => `<tr><td>${esc(l)}</td><td>${p ? '+' + p : '0'}</td></tr>`).join('')}</table><p class="small muted" style="margin-top:8px">You never lose points when your idea is corrected.</p></div>
          <div class="panel"><h3>Levels</h3><div class="side-list" style="margin-top:6px">${m.levels.map((l, ix) => `<div class="row between"><span>Level ${ix + 1} · <b>${esc(l.name)}</b></span><span class="num small">${l.min}+</span></div>`).join('')}</div></div>
          <div class="panel"><h3>Badges</h3><div class="badges" style="margin-top:8px">${Object.values(m.badges).map(b => `<div class="badge"><span class="ic">${b.icon}</span><div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div></div>`).join('')}</div></div>
        </section>
      </div>`;
  };

  pages.notfound = async () => '<div class="empty"><h2>Page not found</h2><p style="margin-top:8px"><a href="#/">Go to Discover</a></p></div>';

  // ───────── actions ─────────
  async function act(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); await refreshMe(); await render(); return r; } catch (e) { toast(e.message, true); if (e.status === 401) go('#/login'); }
  }

  function challengeModal() {
    const i = state.idea;
    const T = meta().correction_types;
    const sel = String(window.getSelection ? window.getSelection() : '').trim().slice(0, 500);
    modal(`<form class="stack" style="--gap:14px">
      <div><span class="eyebrow">Challenge an idea</span><h2 style="margin-top:4px">${esc(i.title)}</h2></div>
      <fieldset class="stack" style="--gap:8px;border:0;padding:0;margin:0"><legend class="field" style="margin-bottom:8px"><span>What kind of problem did you find?</span></legend>
        <div class="type-grid">${Object.entries(T).map(([k, t], ix) => `<label><input type="radio" name="type" value="${k}" ${ix === 0 ? 'checked' : ''}> ${t.icon} ${esc(t.label)}</label>`).join('')}</div></fieldset>
      <label class="field"><span>Quote the part you're challenging</span><textarea class="input" id="ch-quote" name="quote" rows="2" placeholder="Paste the exact sentence or equation (tip: select text on the page before clicking Challenge)">${esc(sel)}</textarea></label>
      <label class="field"><span>Why is it wrong or weak?</span><textarea class="input" id="ch-expl" name="explanation" rows="4" required placeholder="Explain the mistake, missing step or assumption."></textarea></label>
      <label class="field"><span>Suggested correction</span><textarea class="input" id="ch-sugg" name="suggestion" rows="3" placeholder="How should it read instead? Maths with $…$ and code with \`\`\` work."></textarea></label>
      <label class="field"><span>Evidence or reasoning <span class="muted small">(optional)</span></span><textarea class="input" id="ch-evid" name="evidence" rows="2" placeholder="A source, a calculation, a counter-example…"></textarea></label>
      <p class="reminder tex2jax_ignore">Criticise the idea, not the person. If you're wrong you lose nothing; if you're right you get +${meta().points.correctionCorrect}.</p>
      <div class="form-error error-box" hidden></div>
      <div class="row"><button class="btn marker" type="submit">Submit challenge</button><button class="btn ghost" type="button" data-close>Cancel</button></div>
    </form>`, async fd => {
      await api('POST', `/api/ideas/${i.id}/corrections`, Object.fromEntries(fd));
      toast('Challenge submitted. The author has been notified.');
      await refreshMe();
      if (state.route.tab !== 'corrections') go(`#/idea/${i.id}/corrections`); else await render();
    });
  }

  function reportModal(type, id) {
    const R = meta().report_reasons;
    modal(`<form class="stack" style="--gap:12px"><div><span class="eyebrow">Report ${esc(type)}</span><h2 style="margin-top:4px">What's wrong with it?</h2><p class="small muted" style="margin-top:4px">Reports go to student moderators. Disagreeing with an idea isn't a reason to report it; challenge it instead.</p></div>
      <div class="type-grid">${Object.entries(R).map(([k, l], ix) => `<label><input type="radio" name="reason" value="${k}" ${ix === 0 ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <label class="field"><span>Details <span class="muted small">(optional)</span></span><textarea class="input" id="rp-details" name="details" rows="2"></textarea></label>
      <div class="form-error error-box" hidden></div>
      <div class="row"><button class="btn primary" type="submit">Send report</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`,
    async fd => {
      const r = await api('POST', '/api/reports', Object.assign({ target_type: type, target_id: Number(id) }, Object.fromEntries(fd)));
      toast(r.auto_hidden ? 'Reported. It has been hidden until a moderator reviews it.' : 'Thanks. A moderator will review it.');
      await render();
    });
  }

  function verdictModal(id, verdict, final) {
    const label = meta().verdicts[verdict];
    modal(`<form class="stack" style="--gap:12px"><div><span class="eyebrow">${final ? 'Final verdict' : 'Community verdict'}</span><h2 style="margin-top:4px">Mark as “${esc(label)}”</h2></div>
      <p class="small muted">${verdict === 'correct' || verdict === 'partial' ? `The student who wrote this correction will get +${verdict === 'correct' ? meta().points.correctionCorrect : meta().points.correctionPartial} reputation and be credited as a contributor.` : verdict === 'incorrect' ? 'They lose nothing. A kind explanation helps them learn.' : 'The correction stays open so people can keep discussing it.'}</p>
      <label class="field"><span>Note to the contributor <span class="muted small">(optional)</span></span><textarea class="input" id="vd-note" name="note" rows="3" placeholder="${verdict === 'incorrect' ? 'Explain kindly why this does not hold.' : 'Thank them, or say what you will change.'}"></textarea></label>
      <div class="form-error error-box" hidden></div>
      <div class="row"><button class="btn primary" type="submit">Confirm</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`,
    async fd => {
      const r = await api('POST', `/api/corrections/${id}/verdict`, { verdict, note: fd.get('note') });
      toast(r.final ? `Marked ${label}.` : `Verdict recorded (${r.votes_for} of ${meta().quorum}).`);
      await refreshMe(); await render();
    });
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    const i = state.idea;
    if (a === 'home-tab') { state.homeTab = b.dataset.tab; return render(); }
    if (a === 'challenge') return state.me ? challengeModal() : go('#/login');
    if (a === 'report') return reportModal(b.dataset.type, b.dataset.id);
    if (a === 'vote') { b.disabled = true; return act(() => api('POST', `/api/${b.dataset.type}/${b.dataset.id}/vote`)); }
    if (a === 'verdict') return verdictModal(b.dataset.id, b.dataset.verdict, !!b.dataset.final);
    if (a === 'helpful') return act(() => api('POST', `/api/comments/${b.dataset.id}/helpful`), 'Marked helpful. They earned reputation.');
    if (a === 'verify') return act(() => api('POST', `/api/ideas/${i.id}/status`, { status: 'verified' }), 'Marked Solved / Verified. Contributors have been credited.');
    if (a === 'reopen') return act(() => api('POST', `/api/ideas/${i.id}/status`, { status: 'open' }), 'Reopened for discussion.');
    if (a === 'lab-open') return act(() => api('POST', `/api/ideas/${i.id}/lab`, { open: true }), 'Idea Lab opened. Anyone can now edit the draft.');
    if (a === 'lab-close') return act(() => api('POST', `/api/ideas/${i.id}/lab`, { open: false }), 'Idea Lab closed.');
    if (a === 'task') return act(() => api('POST', `/api/lab/tasks/${b.dataset.id}`, { action: b.dataset.do }));
    if (a === 'mod') return act(() => api('POST', `/api/moderation/reports/${b.dataset.id}`, { action: b.dataset.do }), b.dataset.do === 'hide' ? 'Content hidden.' : b.dataset.do === 'restore' ? 'Content restored.' : 'Report dismissed.');
    if (a === 'lab-view') {
      const prev = b.dataset.view === 'preview';
      $$('[data-action=lab-view]').forEach(x => x.classList.toggle('on', x === b));
      $('#lab-body').hidden = prev; const p = $('#lab-preview'); p.hidden = !prev;
      if (prev) { p.innerHTML = md($('#lab-body').value); enhance(p); }
      return;
    }
    if (a === 'reply') {
      const slot = $(`.reply-slot[data-for="${b.dataset.id}"]`);
      if (slot.innerHTML) { slot.innerHTML = ''; return; }
      slot.innerHTML = commentForm(i.id, { parent: b.dataset.id, placeholder: 'Write a reply…' });
      $('textarea', slot).focus();
      return;
    }
    if (a === 'logout') {
      await api('POST', '/api/auth/logout'); state.me = null; state.after = null; toast('Logged out.'); return go('#/login');
    }
    if (a === 'demo-reset') { window.IdeaHubDemo.reset(); state.me = null; toast('Preview data reset. Create an account to start again.'); await refreshMe(); return go('#/'); }
  });

  document.addEventListener('submit', async e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.form;
    const fd = new FormData(f);
    const data = Object.fromEntries(fd);
    const errBox = $('.form-error', f);
    const btn = $('button[type=submit]', f);
    const showErr = msg => { if (errBox) { errBox.hidden = false; errBox.textContent = msg; errBox.scrollIntoView({ block: 'nearest' }); } else toast(msg, true); };
    if (btn) btn.disabled = true;
    try {
      if (kind === 'search') { go('#/explore' + qs(Object.assign({}, state.route.query, { q: data.q }))); }
      else if (kind === 'login') {
        data.remember = !!data.remember;
        await api('POST', '/api/auth/login', data); await refreshMe(); toast('Welcome back, ' + state.me.name.split(' ')[0] + '!');
        const next = state.after && !/#\/(login|signup)/.test(state.after) ? state.after : '#/'; state.after = null; go(next);
      }
      else if (kind === 'signup') {
        if (data.password !== data.password2) throw new Error('The two passwords do not match.');
        delete data.password2;
        data.pledge = !!data.pledge; data.remember = !!data.remember; data.interests = String(data.interests || '').split(',');
        await api('POST', '/api/auth/signup', data); await refreshMe(); toast('Welcome to IdeaHub, @' + state.me.username + '! Share your first idea or improve someone else\'s.'); go('#/');
      } else if (kind === 'settings') {
        data.interests = String(data.interests || '').split(',');
        await api('PATCH', '/api/me', data); await refreshMe(); toast('Profile saved.'); go(`#/u/${state.me.id}`);
      } else if (kind === 'idea') {
        data.needs_help = !!data.needs_help; data.images = String(data.images || '').split(/\s+/).filter(Boolean);
        data.challenge_id = data.challenge_id ? Number(data.challenge_id) : null;
        const r = await api('POST', '/api/ideas', data);
        try { localStorage.removeItem('ideahub-draft'); } catch (x) { /* ignore */ }
        await refreshMe(); toast('Idea published! Others can now review it.'); go(`#/idea/${r.id}`);
      } else if (kind === 'version') {
        const body = { title: data.title, body: data.body, change_note: data.change_note, credited_correction_ids: fd.getAll('corr').map(Number), credit_lab: !!data.credit_lab };
        const r = await api('POST', `/api/ideas/${f.dataset.idea}/versions`, body);
        await refreshMe(); toast(`Version ${r.version} published. Contributors have been credited.`); go(`#/idea/${f.dataset.idea}/history`);
      } else if (kind === 'comment') {
        await act(() => api('POST', `/api/ideas/${f.dataset.idea}/comments`, { body: data.body, correction_id: f.dataset.correction ? Number(f.dataset.correction) : null, parent_id: f.dataset.parent ? Number(f.dataset.parent) : null }));
      } else if (kind === 'lab-edit') {
        await api('POST', `/api/ideas/${f.dataset.idea}/lab/edits`, data); toast('Draft saved. Thanks for building this together!'); await refreshMe(); await render();
      } else if (kind === 'lab-task') {
        await api('POST', `/api/ideas/${f.dataset.idea}/lab/tasks`, data); await render();
      } else if (kind === 'challenge-new') {
        await api('POST', '/api/challenges', data); toast('Challenge created.'); await render();
      }
    } catch (err) { showErr(err.message); if (err.status === 401 && kind !== 'login' && kind !== 'signup') go('#/login'); }
    if (btn && document.body.contains(btn)) btn.disabled = false;
  });

  // ───────── boot ─────────
  (async function boot() {
    try {
      [state.meta, state.config] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/config').catch(() => ({}))]);
      await refreshMe();
    } catch (e) {
      app.innerHTML = `<div class="empty"><h2>IdeaHub couldn't start</h2><p>${esc(e.message)}</p></div>`;
      return;
    }
    if (DEMO) {
      const bar = document.getElementById('demo-banner');
      if (bar) { bar.hidden = false; bar.innerHTML = `<div><b>Prototype preview.</b><span>Accounts and posts are saved only in this browser until the site is hosted. The sample ideas come from fictional students.</span><button class="linkish" data-action="demo-reset">Reset preview data</button></div>`; }
    }
    lastPath = location.hash.split('?')[0];
    render();
  })();
})();
