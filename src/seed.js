/*
 * Demo data. Every row is created through the same API router the app uses, so reputation,
 * badges, notifications and history are exactly what real usage would produce.
 * All people below are fictional.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.IdeaHubSeed = factory(root.IdeaHubCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const PASSWORD = 'dduc1234';

  const PEOPLE = [
    { key: 'aarav', name: 'Aarav Sharma', course: 'B.Sc. (H) Computer Science', year: 3, interests: ['Algorithms', 'Machine learning', 'Open source'], bio: 'Third year CS. I like making slow things fast.' },
    { key: 'priya', name: 'Priya Verma', course: 'B.Sc. (H) Mathematics', year: 2, interests: ['Probability', 'Number theory', 'Puzzles'], bio: 'Probability nerd. Will happily check your calculations.' },
    { key: 'rohan', name: 'Rohan Mehta', course: 'B.Sc. (H) Physics', year: 3, interests: ['Renewable energy', 'Optics', 'Experiments'], bio: 'Physics with a soft spot for back-of-the-envelope estimates.' },
    { key: 'ananya', name: 'Ananya Gupta', course: 'B.Com (H)', year: 2, interests: ['Startups', 'Finance', 'Events'], bio: 'Organising things and building small businesses.' },
    { key: 'kabir', name: 'Kabir Singh', course: 'B.Sc. (H) Electronics', year: 1, interests: ['Robotics', 'IoT', 'Arduino'], bio: 'First year, building robots out of whatever I can find.' },
    { key: 'meera', name: 'Meera Iyer', course: 'B.Sc. (H) Biomedical Science', year: 2, interests: ['Environment', 'Public health'], bio: 'Interested in small changes that add up.' },
    { key: 'ishaan', name: 'Ishaan Malhotra', course: 'B.Sc. (H) Computer Science', year: 2, interests: ['Web development', 'Python', 'UI design'], bio: 'Building web things. Learning in public.' },
    { key: 'sana', name: 'Sana Khan', course: 'B.Sc. Mathematical Sciences', year: 3, interests: ['Statistics', 'Social policy', 'Surveys'], bio: 'Statistics student who wants data to be used honestly.' },
    { key: 'neha', name: 'Neha Kapoor', course: 'B.Sc. (H) Mathematics', year: 3, interests: ['Community', 'Linear algebra'], bio: 'Student moderator. Here to keep things kind and rigorous.', role: 'moderator' },
    { key: 'dev', name: 'Dev Arora', course: 'B.Com', year: 1, interests: ['Marketing'], bio: '' },
  ];

  function seed(store, opts) {
    const hash = opts.hash;
    const end = Date.parse(opts.now || new Date().toISOString());
    let clock = end - 21 * 864e5;
    const at = (hours) => { clock += hours * 3600e3; return new Date(clock).toISOString(); };
    const day = (offset) => new Date(end + offset * 864e5).toISOString().slice(0, 10);
    const U = {};

    for (const p of PEOPLE) {
      const ctx = { store, now: at(0.3) };
      const u = core.createUser(ctx, Object.assign({ username: p.key }, p), hash(PASSWORD));
      U[p.key] = u.id;
    }

    store.insert('weekly_challenges', { title: 'Fix a Campus Problem', prompt: 'Pick one everyday annoyance at DDUC (queues, noise, waste, timetables) and propose a fix. Half-baked is fine; that is what reviewers are for.', category: 'campus', starts_on: day(-10), ends_on: day(-4) });
    const current = store.insert('weekly_challenges', { title: 'Find the Flaw Week', prompt: 'Read one idea from a subject outside your own course and look for a hidden assumption, a missing step or a calculation slip. Every verified correction this week moves you up the weekly leaderboard.', category: null, starts_on: day(-3), ends_on: day(3) });
    store.insert('weekly_challenges', { title: 'Math in Everyday Life', prompt: 'Share an idea where a bit of mathematics (probability, optimisation, estimation) makes a daily decision better.', category: 'mathematics', starts_on: day(4), ends_on: day(10) });

    function act(who, method, path, body, hours) {
      const r = core.handle(store, { method, path, body, query: {}, userId: U[who], now: at(hours == null ? 2 : hours) });
      if (r.status !== 200) throw new Error(`seed ${who} ${method} ${path}: ${r.body.error}`);
      return r.body;
    }

    // 1. Birthday lucky draw: a classic probability slip, corrected and verified.
    const bday = act('ananya', 'POST', '/api/ideas', {
      title: 'Birthday-based lucky draw for the college fest',
      category: 'business', kind: 'idea', difficulty: 'beginner', needs_help: true,
      body: 'For the fest we want a fun lucky draw: in each class of **40 students**, the prize goes to the pair of students who share a birthday.\n\nSince a year has 365 days, I estimated the chance of any two students sharing a birthday as\n\n$$P \\approx \\frac{40}{365} \\approx 11\\%$$\n\nso most classes will have **no winner**, which makes the prize feel special. We would only need to buy prizes for about 1 in 9 classes.\n\nIs the budget logic right?',
      sources: 'My own idea, discussed with the fest committee.',
    }, 1);
    const bdayFix = act('priya', 'POST', `/api/ideas/${bday.id}/corrections`, {
      type: 'math', quote: 'P ≈ 40/365 ≈ 11%',
      explanation: 'This is the famous **birthday problem**. 40/365 is roughly the chance that someone shares *your* birthday, not that *any two* people share one. With 40 people there are $\\binom{40}{2} = 780$ pairs, so a match is very likely.',
      suggestion: 'Compute the complement (no two share a birthday):\n\n$$P(\\text{match}) = 1 - \\prod_{k=0}^{39} \\frac{365-k}{365} \\approx 0.891$$\n\nSo about **89%** of classes will have a winner. Budget for prizes in roughly 9 out of 10 classes, or change the rule.',
      evidence: 'Standard result; for 23 people the probability already passes 50%. You can verify with a 3-line Python simulation.',
    }, 5);
    const c1 = act('rohan', 'POST', `/api/ideas/${bday.id}/comments`, { body: 'I ran a quick simulation with 100,000 random classes of 40 and got 89.1% too. The intuition is the number of pairs grows like n².' }, 2);
    act('ananya', 'POST', `/api/comments/${c1.id}/helpful`, {}, 1);
    act('ananya', 'POST', `/api/corrections/${bdayFix.id}/verdict`, { verdict: 'correct', note: 'Thank you! This would have blown our prize budget.' }, 1);
    act('ananya', 'POST', `/api/ideas/${bday.id}/versions`, {
      title: 'Birthday lucky draw for the college fest (budget fixed)',
      body: 'Lucky draw idea for the fest, now with the correct probability.\n\nIn a class of 40, the chance that **at least two** students share a birthday is\n\n$$P = 1 - \\prod_{k=0}^{39} \\frac{365-k}{365} \\approx 89\\%$$\n\n(the birthday problem, thanks to Priya). So a shared birthday is *expected*, not rare.\n\n**New rule:** the prize goes to students who share a birthday **with the fest date** itself. The chance a given student matches is $1/365$, so in a class of 40 the chance of at least one winner is $1-(364/365)^{40} \\approx 10.4\\%$. That gives the "rare and special" feeling we originally wanted, and the budget is about 1 prize per 10 classes.',
      change_note: 'Fixed the probability with the birthday-problem formula and changed the rule so winners stay rare.',
      credited_correction_ids: [bdayFix.id],
    }, 3);
    act('priya', 'POST', `/api/ideas/${bday.id}/comments`, { body: 'The new rule is neat, and $1-(364/365)^{40}$ is right. ✔' }, 2);
    act('ananya', 'POST', `/api/ideas/${bday.id}/status`, { status: 'verified' }, 1);
    for (const v of ['rohan', 'meera', 'kabir', 'ishaan', 'sana', 'aarav']) act(v, 'POST', `/api/ideas/${bday.id}/vote`, {}, 0.5);
    for (const v of ['rohan', 'meera', 'aarav', 'sana']) act(v, 'POST', `/api/corrections/${bdayFix.id}/vote`, {}, 0.3);

    // 2. Binary search on an unsorted list: logic error + better approach, two contributors.
    const att = act('aarav', 'POST', '/api/ideas', {
      title: 'Speeding up the attendance portal with binary search',
      category: 'computer-science', kind: 'idea', difficulty: 'intermediate',
      body: 'Our attendance sheet is a list of ~3,000 roll numbers in the order students registered. Looking a student up is a linear scan, $O(n)$.\n\nIdea: use **binary search** directly on that list to get $O(\\log n)$ lookups:\n\n```python\ndef find(roll, students):\n    lo, hi = 0, len(students) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if students[mid] == roll: return mid\n        if students[mid] < roll: lo = mid + 1\n        else: hi = mid - 1\n    return -1\n```\n\nThat should make the portal around 250x faster.',
    }, 8);
    const attLogic = act('ishaan', 'POST', `/api/ideas/${att.id}/corrections`, {
      type: 'logic', quote: 'a list of ~3,000 roll numbers in the order students registered',
      explanation: 'Binary search only works on **sorted** data. Registration order is not sorted by roll number, so the search will skip over students and return -1 for people who are actually present.',
      suggestion: 'Sort once ($O(n \\log n)$) and keep the list sorted on insert, or sort a copy each time the sheet changes.',
      evidence: 'Try `find(9, [9, 1, 5, 3])`: it returns -1 even though 9 is the very first item.',
    }, 4);
    const attBetter = act('kabir', 'POST', `/api/ideas/${att.id}/corrections`, {
      type: 'better', quote: 'make the portal around 250x faster',
      explanation: 'For exact lookups by roll number a hash map (Python `dict`) gives average $O(1)$ and does not need sorting at all. Also, with only 3,000 rows the scan is not the real bottleneck; it is probably the page load.',
      suggestion: 'Build `index = {roll: i for i, roll in enumerate(students)}` once, then `index.get(roll, -1)`.',
    }, 3);
    act('aarav', 'POST', `/api/corrections/${attLogic.id}/verdict`, { verdict: 'correct', note: 'Oops, completely right. Registration order is not sorted.' }, 2);
    act('aarav', 'POST', `/api/corrections/${attBetter.id}/verdict`, { verdict: 'partial', note: 'The dict is a great idea. I still think the scan matters on the old lab PCs, so partially.' }, 1);
    const attC = act('sana', 'POST', `/api/ideas/${att.id}/comments`, { body: 'Could someone explain why a dict is O(1) on average but not always? I never understood the "average" part.' }, 2);
    const attR = act('ishaan', 'POST', `/api/ideas/${att.id}/comments`, { parent_id: attC.id, body: 'A dict hashes each key into a bucket. Usually every bucket has one item, so lookup is one step. If many keys land in the same bucket (collisions) you have to check several, which is the worst case. Python resizes the table to keep collisions rare.' }, 1);
    act('aarav', 'POST', `/api/comments/${attR.id}/helpful`, {}, 0.5);
    act('aarav', 'POST', `/api/ideas/${att.id}/versions`, {
      title: 'Faster attendance lookups: index by roll number',
      body: 'Our attendance sheet is ~3,000 roll numbers in registration order (**not sorted**, so plain binary search would be wrong).\n\nImproved approach: build an index once, then look up in average $O(1)$:\n\n```python\nindex = {roll: i for i, roll in enumerate(students)}\n\ndef find(roll):\n    return index.get(roll, -1)\n```\n\nRebuild the index whenever the sheet changes. If we ever need range queries ("all roll numbers between X and Y"), keep a sorted copy and use `bisect` instead.',
      change_note: 'Replaced binary search on unsorted data with a dict index; noted when sorting + bisect is the right tool.',
      credited_correction_ids: [attLogic.id, attBetter.id],
    }, 2);
    act('aarav', 'POST', `/api/ideas/${att.id}/status`, { status: 'verified' }, 1);
    for (const v of ['priya', 'ishaan', 'kabir', 'sana']) act(v, 'POST', `/api/ideas/${att.id}/vote`, {}, 0.3);
    for (const v of ['priya', 'aarav', 'sana', 'rohan', 'meera']) act(v, 'POST', `/api/corrections/${attLogic.id}/vote`, {}, 0.2);

    // 3. Sampling bias in a breakfast survey: one accepted, one politely marked incorrect.
    const bf = act('sana', 'POST', '/api/ideas', {
      title: '80% of DDUC students skip breakfast, so the canteen should open at 8 am',
      category: 'social', kind: 'idea', difficulty: 'beginner',
      body: 'I asked 15 friends from my morning section whether they eat breakfast before class. **12 of 15 (80%)** said no.\n\nSo about 80% of DDUC students skip breakfast. If the canteen opened at 8 am instead of 9:30, it could serve them and improve attendance in first lectures.',
    }, 10);
    const bfBias = act('priya', 'POST', `/api/ideas/${bf.id}/corrections`, {
      type: 'logic', quote: 'So about 80% of DDUC students skip breakfast.',
      explanation: 'The sample is 15 friends from one morning section, which is small and not random (friends share habits; a morning section is exactly the group most likely to skip breakfast). The result cannot be generalised to all of DDUC.',
      suggestion: 'Run a short anonymous form across several courses and years, aim for 100+ responses, and report the percentage with a margin of error (≈ ±10% at n=100).',
      evidence: 'For a proportion near 0.8 with n=15, the 95% margin of error is about $1.96\\sqrt{0.8\\cdot0.2/15}\\approx \\pm 20\\%$, and that ignores the selection bias.',
    }, 6);
    const bfWrong = act('dev', 'POST', `/api/ideas/${bf.id}/corrections`, {
      type: 'fact', quote: 'canteen opened at 8 am instead of 9:30',
      explanation: 'I think the canteen already opens at 8 am, so this change is not needed.',
    }, 2);
    act('sana', 'POST', `/api/corrections/${bfBias.id}/verdict`, { verdict: 'correct', note: 'Fair. I will run a proper survey.' }, 2);
    act('sana', 'POST', `/api/corrections/${bfWrong.id}/verdict`, { verdict: 'incorrect', note: 'Thanks for checking! I asked the canteen manager: it opens at 9:30 on weekdays. Still useful to verify.' }, 1);
    act('sana', 'POST', `/api/ideas/${bf.id}/versions`, {
      title: 'Should the canteen open at 8 am? A proper survey first',
      body: 'My first post claimed 80% of DDUC students skip breakfast, based on 15 friends from one morning section. That sample was small and biased (thanks Priya).\n\n**Plan:**\n1. Anonymous Google Form shared in every course group, target 150+ responses.\n2. Questions: first lecture time, breakfast yes/no, would you buy breakfast at 8 am, price you would pay.\n3. Report the share with a 95% margin of error.\n4. Share results with the canteen committee only if the demand is real.\n\nCurrent canteen opening time (checked): 9:30 am on weekdays.',
      change_note: 'Replaced the overgeneralised claim with a survey plan and margin of error.',
      credited_correction_ids: [bfBias.id],
    }, 3);
    for (const v of ['ananya', 'meera', 'priya']) act(v, 'POST', `/api/ideas/${bf.id}/vote`, {}, 0.3);

    // 4. Solar rooftop: correct calc via moderator, open discussion, Idea Lab in progress.
    const solar = act('rohan', 'POST', '/api/ideas', {
      title: 'Rooftop solar could power all of DDUC',
      category: 'environment', kind: 'idea', difficulty: 'intermediate', needs_help: true,
      body: 'Rough estimate for putting solar panels on our roofs.\n\n- Usable roof area: about **2,000 m²**\n- Sunlight: **1,000 W/m²**\n- Panel efficiency: **20%**\n\nPower: $2000 \\times 1000 \\times 0.2 = 400\\,\\text{kW}$\n\nEnergy per day: $400\\,\\text{kW} \\times 24\\,\\text{h} = 9{,}600\\,\\text{kWh}$\n\nThe college probably uses less than that, so solar could cover **everything** and we could even sell the surplus.',
      sources: 'Irradiance figure from a physics textbook (standard test conditions).',
    }, 12);
    const solarMath = act('meera', 'POST', `/api/ideas/${solar.id}/corrections`, {
      type: 'math', quote: '400 kW × 24 h = 9,600 kWh',
      explanation: '1,000 W/m² is peak sunlight at noon on a clear day. The sun is not up for 24 hours and is weaker in the morning and evening. The usual way to handle this is "peak sun hours", which is about **5 hours/day** in Delhi on average.',
      suggestion: '$400\\,\\text{kW} \\times 5\\,\\text{h} \\approx 2{,}000\\,\\text{kWh/day}$, and after inverter and dust losses (~15%) roughly **1,700 kWh/day**.',
      evidence: 'MNRE and NREL solar maps put Delhi at about 4.5 to 5.5 kWh/m²/day of solar irradiation.',
    }, 4);
    const solarMissing = act('kabir', 'POST', `/api/ideas/${solar.id}/corrections`, {
      type: 'missing', quote: 'Usable roof area: about 2,000 m²',
      explanation: 'Panels cannot cover the whole roof: you need spacing so rows do not shade each other, walkways for cleaning, and there are water tanks on our roofs. Also we do not know the college\'s actual consumption.',
      suggestion: 'Use ~60% of roof area as panel area, and get the real monthly electricity bill before concluding anything.',
    }, 2);
    act('neha', 'POST', `/api/corrections/${solarMath.id}/verdict`, { verdict: 'correct', note: 'Moderator check: peak sun hours is the standard method. Well explained.' }, 3);
    act('rohan', 'POST', `/api/corrections/${solarMissing.id}/verdict`, { verdict: 'discussion', note: 'Agree on spacing, but how much? Let us work it out in the Lab.' }, 1);
    act('sana', 'POST', `/api/ideas/${solar.id}/comments`, { correction_id: solarMissing.id, body: 'A rule of thumb I have seen is 10 m² of roof per kW for flat rooftops, which already includes spacing.' }, 2);
    act('rohan', 'POST', `/api/ideas/${solar.id}/lab`, { open: true }, 1);
    act('rohan', 'POST', `/api/ideas/${solar.id}/lab/tasks`, { text: 'Get the college\'s monthly electricity bill (units consumed)' }, 0.5);
    act('rohan', 'POST', `/api/ideas/${solar.id}/lab/tasks`, { text: 'Measure the actual free roof area (without tanks and stairs)' }, 0.2);
    act('kabir', 'POST', `/api/ideas/${solar.id}/lab/tasks`, { text: 'Find the cost per kW of rooftop solar in Delhi and subsidy rules' }, 1);
    const tasks = store.all('lab_tasks').filter(t => t.idea_id === solar.id);
    act('kabir', 'POST', `/api/lab/tasks/${tasks[1].id}`, { action: 'claim' }, 0.5);
    act('ananya', 'POST', `/api/lab/tasks/${tasks[2].id}`, { action: 'done' }, 3);
    act('kabir', 'POST', `/api/ideas/${solar.id}/lab/edits`, {
      note: 'Applied peak sun hours and roof spacing',
      body: '## Working draft\n\n**Assumptions**\n- Roof area 2,000 m², of which ~60% usable for panels → 1,200 m² (spacing, tanks, walkways).\n- Rule of thumb: 10 m² per kW on flat roofs → **~200 kW** system.\n- Delhi: ~5 peak sun hours/day.\n\n**Energy:** $200 \\times 5 \\approx 1{,}000\\,\\text{kWh/day}$ before losses, ~850 kWh/day after.\n\n**Open:** what does DDUC actually consume per day? (see tasks)',
    }, 2);
    act('ananya', 'POST', `/api/ideas/${solar.id}/lab/edits`, {
      note: 'Added cost and subsidy estimate',
      body: '## Working draft\n\n**Assumptions**\n- Roof area 2,000 m², of which ~60% usable for panels → 1,200 m² (spacing, tanks, walkways).\n- Rule of thumb: 10 m² per kW on flat roofs → **~200 kW** system.\n- Delhi: ~5 peak sun hours/day.\n\n**Energy:** $200 \\times 5 \\approx 1{,}000\\,\\text{kWh/day}$ before losses, ~850 kWh/day after.\n\n**Cost (rough):** ₹45,000 to ₹55,000 per kW for commercial rooftop → ₹90 lakh to ₹1.1 crore for 200 kW. Institutions can use the RESCO model (a company installs, college pays per unit) so there is no upfront cost.\n\n**Open:** what does DDUC actually consume per day? (see tasks)',
    }, 4);
    for (const v of ['meera', 'kabir', 'ananya', 'priya', 'aarav']) act(v, 'POST', `/api/ideas/${solar.id}/vote`, {}, 0.2);
    for (const v of ['rohan', 'kabir', 'priya']) act(v, 'POST', `/api/corrections/${solarMath.id}/vote`, {}, 0.2);

    // 5. Palindrome one-liner: accepted, not yet applied.
    const pal = act('ishaan', 'POST', '/api/ideas', {
      title: 'One-line palindrome checker that works for whole sentences',
      category: 'programming', kind: 'idea', difficulty: 'beginner',
      body: 'Python makes this easy:\n\n```python\ndef is_palindrome(s):\n    return s == s[::-1]\n```\n\nWorks for words like `"level"` and for sentences like `"A man, a plan, a canal: Panama"`.',
    }, 9);
    const palFix = act('aarav', 'POST', `/api/ideas/${pal.id}/corrections`, {
      type: 'missing', quote: 'and for sentences like "A man, a plan, a canal: Panama"',
      explanation: 'For that sentence `s[::-1]` is `"amanaP :lanac a ,nalp a ,nam A"`, which is not equal to `s`, because of capital letters, spaces and punctuation. The one-liner only works for already-clean lowercase words.',
      suggestion: '```python\ndef is_palindrome(s):\n    t = [c.lower() for c in s if c.isalnum()]\n    return t == t[::-1]\n```',
    }, 3);
    act('ishaan', 'POST', `/api/corrections/${palFix.id}/verdict`, { verdict: 'correct', note: 'Ah, I only tested with "level". Will update.' }, 2);
    act('priya', 'POST', `/api/corrections/${palFix.id}/vote`, {}, 0.5);

    // 6. One IR sensor robot: an unsolved problem with a pending alternative + community verdicts in progress.
    const robot = act('kabir', 'POST', '/api/ideas', {
      title: 'Can a line-following robot work with only ONE IR sensor?',
      category: 'robotics', kind: 'problem', difficulty: 'intermediate', needs_help: true, challenge_id: current.id,
      body: 'Our club has a tiny budget. Most line followers use 2 to 5 IR sensors. I want to build one with **a single IR sensor** on an Arduino.\n\nMy plan: if the sensor sees black, go straight; if it sees white, turn right until it sees black again.\n\nProblem: on left-hand curves the robot loses the line completely. **How do I fix this without adding sensors?**',
    }, 7);
    const robotAlt = act('ishaan', 'POST', `/api/ideas/${robot.id}/corrections`, {
      type: 'alternative', quote: 'if it sees white, turn right until it sees black again',
      explanation: 'With one sensor you cannot tell which side of the line you left from. A known trick is **edge following**: follow the *edge* of the line instead of its centre. Steer slightly left while on black and slightly right while on white, so the robot zig-zags along the left edge. It then handles curves in both directions.',
      suggestion: '```cpp\nif (onBlack) { left(SLOW); right(FAST); }\nelse        { left(FAST); right(SLOW); }\n```\nTune SLOW/FAST on your track. A PID on the analog reading works even better.',
    }, 5);
    act('aarav', 'POST', `/api/corrections/${robotAlt.id}/verdict`, { verdict: 'correct' }, 1);
    act('priya', 'POST', `/api/corrections/${robotAlt.id}/verdict`, { verdict: 'correct' }, 1);
    act('rohan', 'POST', `/api/corrections/${robotAlt.id}/vote`, {}, 0.5);
    act('meera', 'POST', `/api/ideas/${robot.id}/comments`, { correction_id: robotAlt.id, body: 'Does edge following still work on sharp 90° turns?' }, 1);

    // 7. Steel tumblers: partial correction with discussion.
    const cups = act('meera', 'POST', '/api/ideas', {
      title: 'Replace plastic cups in the canteen with steel tumblers',
      category: 'environment', kind: 'idea', difficulty: 'beginner', challenge_id: store.all('weekly_challenges')[0].id,
      body: 'The canteen uses around **600 plastic cups a day**. Steel tumblers cost about ₹60 each and last years.\n\nBuying 300 tumblers (₹18,000) would pay for itself quickly and remove ~1.5 lakh plastic cups a year from waste.',
    }, 6);
    const cupsMissing = act('ananya', 'POST', `/api/ideas/${cups.id}/corrections`, {
      type: 'missing', quote: 'would pay for itself quickly',
      explanation: 'The payback calculation leaves out washing: water, detergent and someone\'s time. Also tumblers go missing; canteens often lose 10 to 20% a year.',
      suggestion: 'Add running costs: e.g. 2 hours of washing a day at ₹100/hour = ₹200/day, plus 15% replacement. Then compare with the cup cost (≈ ₹1 × 600 = ₹600/day). It still pays back in about 1 to 2 months, so the idea holds.',
    }, 4);
    act('meera', 'POST', `/api/corrections/${cupsMissing.id}/verdict`, { verdict: 'partial', note: 'Agree on washing. I think loss will be lower if there is a small deposit.' }, 2);
    const cupC = act('dev', 'POST', `/api/ideas/${cups.id}/comments`, { body: 'Buy cheap notes and assignments at my Insta page, DM for prices!!' }, 3);
    act('meera', 'POST', '/api/reports', { target_type: 'comment', target_id: cupC.id, reason: 'spam', details: 'Advertising, not related to the idea.' }, 0.5);
    act('rohan', 'POST', '/api/reports', { target_type: 'comment', target_id: cupC.id, reason: 'spam' }, 0.5);
    act('sana', 'POST', `/api/ideas/${cups.id}/comments`, { body: 'A ₹20 deposit system works in the IIT canteens I have read about. Could be worth adding.' }, 2);

    // 8 to 12. Fresh ideas waiting for reviewers.
    act('ananya', 'POST', '/api/ideas', {
      title: 'Peer-to-peer textbook exchange for DU students', category: 'startups', kind: 'idea', difficulty: 'beginner', needs_help: true, challenge_id: current.id,
      body: 'Every semester seniors throw away or sell textbooks to raddiwalas for almost nothing, while juniors buy the same books new.\n\nIdea: a simple exchange where seniors list books by **paper code**, juniors reserve them, and the handover happens at the college gate on fixed days.\n\nRevenue: ₹10 listing fee. With 2,000 students and 5 books each, that is ₹1 lakh per semester.\n\nI have not checked if this assumption is realistic. Please poke holes!',
    }, 14);
    act('priya', 'POST', '/api/ideas', {
      title: 'Why is 1² + 2² + … + n² = n(n+1)(2n+1)/6? Looking for a visual proof',
      category: 'mathematics', kind: 'problem', difficulty: 'intermediate',
      body: 'I can prove\n\n$$\\sum_{k=1}^{n} k^2 = \\frac{n(n+1)(2n+1)}{6}$$\n\nby induction, but it feels like magic. Is there a **picture** that makes the 6 in the denominator obvious? I tried stacking cubes into a pyramid but could not get three pyramids to form a box.',
    }, 10);
    act('rohan', 'POST', '/api/ideas', {
      title: 'Measuring g with a phone accelerometer and a hostel-room pendulum',
      category: 'physics', kind: 'idea', difficulty: 'beginner', challenge_id: current.id,
      body: 'Tie a phone to a string (≈1 m), let it swing with small angle, record acceleration with the free *phyphox* app, and read the period $T$ from the peaks.\n\nThen\n\n$$g = \\frac{4\\pi^2 L}{T^2}$$\n\nI expect to get within 1% of 9.81 m/s² if I measure L to the centre of the phone.',
    }, 8);
    act('aarav', 'POST', '/api/ideas', {
      title: 'Use a Bloom filter to flag duplicate idea submissions',
      category: 'computer-science', kind: 'idea', difficulty: 'advanced', needs_help: true,
      body: 'This platform could flag duplicate posts. Idea: hash every 3-word shingle of every idea into a **Bloom filter**. When a new idea arrives, if more than 70% of its shingles are "probably present", warn that it might be a duplicate.\n\nBloom filters never give false negatives, so we would never miss a duplicate.',
    }, 6);
    act('meera', 'POST', '/api/ideas', {
      title: 'A daily "quiet hour" in the library',
      category: 'campus', kind: 'idea', difficulty: 'beginner',
      body: 'The library gets noisy before exams. A fixed quiet hour (say 2 to 3 pm) with phones on silent and no group discussion could help people who need to focus, while the rest of the day stays flexible for group study.',
    }, 5);

    // A little more discussion and votes so the feeds feel alive.
    act('kabir', 'POST', `/api/ideas/${bday.id}/comments`, { body: 'Saving this for the probability unit, great example.' }, 2);
    act('kabir', 'POST', `/api/ideas/${pal.id}/vote`, {}, 0.5);
    act('sana', 'POST', `/api/ideas/${robot.id}/vote`, {}, 0.1);
    for (const v of ['rohan', 'priya', 'ishaan']) act(v, 'POST', `/api/ideas/${robot.id}/vote`, {}, 0.3);

    // Keep streaks believable: a few people were active on consecutive days.
    for (const k of ['priya', 'aarav', 'ishaan']) store.update('users', U[k], { streak: k === 'priya' ? 8 : 4, best_streak: k === 'priya' ? 9 : 5, last_active_day: day(0) });
    // Re-check badges that depend on streaks or global rank.
    core.recheckBadges(store, new Date(end).toISOString());
    return { users: U, password: PASSWORD };
  }

  return { seed, PEOPLE, PASSWORD };
});
