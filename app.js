(function () {
  'use strict';

  const PLAYERS = [
    { name: 'Christo', color: '#8bac0f', email: 'christo.rtc@example.com' },
    { name: 'Jasmine', color: '#ffd84a', email: 'jasmine.rtc@example.com' },
    { name: 'Alphie', color: '#6ec6ff', email: 'alphie.rtc@example.com' },
    { name: 'Soumya', color: '#ff8fa3', email: 'soumya.rtc@example.com' },
    { name: 'Jaison', color: '#c79bff', email: 'jaison.rtc@example.com' }
  ];
  const { START, LAST, GOAL, CAP, addDays, todayIST, score } = window.RTCScoring;
  const app = document.getElementById('app');
  const toastRoot = document.getElementById('toast-root');
  let db = null;
  let authUser = null;
  let profile = null;
  let S = { logs: {} };
  let editing = null;
  let soundOn = true;
  let refreshTimer = null;
  let deferredInstallPrompt = null;
  let lastLeader = null;
  let busy = false;

  const pad = n => String(n).padStart(2, '0');
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-IN');
  const playerMeta = name => PLAYERS.find(p => p.name === name) || { name, color: '#cadc9f' };
  const isAdmin = () => !!(profile && profile.is_admin);
  const appConfigured = () => {
    const c = window.RTC_CONFIG || {};
    return !!(c.SUPABASE_URL && c.SUPABASE_PUBLISHABLE_KEY &&
      !c.SUPABASE_URL.includes('PASTE_') && !c.SUPABASE_PUBLISHABLE_KEY.includes('PASTE_'));
  };
  const endTime = () => Date.parse('2026-12-25T00:00:00+05:30');
  const challengeOver = () => Date.now() >= endTime();

  function toast(message, isError) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    if (isError) { el.style.background = '#ff8fa3'; el.style.color = '#0f380f'; }
    toastRoot.appendChild(el);
    window.setTimeout(() => el.remove(), 2700);
  }

  function beep(win) {
    if (!soundOn) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      (win ? [523, 659, 784, 1047] : [440]).forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square'; osc.frequency.value = f; gain.gain.value = .045;
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * .12); osc.stop(ctx.currentTime + i * .12 + .1);
      });
      window.setTimeout(() => ctx.close().catch(() => {}), 900);
    } catch (_) { /* audio is an optional enhancement */ }
  }

  function clampDateForForm() {
    const t = todayIST();
    if (t < START) return START;
    if (t > LAST) return LAST;
    return t;
  }
  function nonAdminMinDate() {
    const earliest = addDays(todayIST(), -7);
    return earliest < START ? START : earliest;
  }
  function canManageDate(name, day) {
    if (!profile) return false;
    if (isAdmin()) return day >= START && day <= LAST;
    const t = todayIST();
    return name === profile.player_name && t <= LAST && day >= nonAdminMinDate() && day <= t && day >= START && day <= LAST;
  }
  function canNonAdminLog() {
    const t = todayIST();
    return t >= START && t <= LAST;
  }

  function makeLogsObject(rows) {
    const next = { logs: {} };
    for (const row of rows || []) {
      if (!next.logs[row.player_name]) next.logs[row.player_name] = {};
      next.logs[row.player_name][row.day] = Number(row.steps);
    }
    return next;
  }

  async function fetchLogs(silent) {
    if (!db || !profile) return;
    const { data, error } = await db.from('logs').select('player_name,day,steps').order('day', { ascending: false });
    if (error) {
      if (!silent) toast('Could not load logs. Check your connection.', true);
      console.error('Load logs failed:', error.message);
      return;
    }
    const before = getLeaderboard(S)[0];
    S = makeLogsObject(data);
    const after = getLeaderboard(S)[0];
    if (before && after && before.name !== after.name && after.pts > 0 && lastLeader !== null) {
      toast('LEAD CHANGE! ' + after.name + ' IS IN FRONT!');
      beep(true);
    }
    if (after) lastLeader = after.name;
    if (!silent || !document.querySelector('input:focus, select:focus')) renderDashboard();
  }

  function getLeaderboard(source) {
    return PLAYERS.map(p => ({ ...score(p.name, source.logs, todayIST()), color: p.color }))
      .sort((a, b) => b.pts - a.pts || b.steps - a.steps);
  }

  async function startSession(user) {
    authUser = user;
    const { data, error } = await db.from('profiles').select('player_name,is_admin').eq('id', user.id).single();
    if (error || !data) {
      console.error('Profile missing:', error && error.message);
      await db.auth.signOut();
      renderLogin('This account is not linked to a player. Ask Jaison to check the setup SQL.');
      return;
    }
    profile = data;
    editing = null;
    lastLeader = null;
    await fetchLogs(true);
    renderDashboard();
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('input:focus, select:focus')) fetchLogs(true);
    }, 12000);
    toast('PLAYER 1 READY · ' + profile.player_name);
  }

  function renderLogin(message) {
    profile = null; authUser = null; editing = null;
    if (refreshTimer) { window.clearInterval(refreshTimer); refreshTimer = null; }
    if (!appConfigured()) {
      app.innerHTML = `<div class="login-wrap"><div class="login-logo">🎮</div><h1>Road to Christmas</h1><div class="sub">Cartridge setup needed</div><div class="box"><h2>Almost ready</h2><p>The app files are in place, but the Supabase connection has not been filled in yet.</p><p>Open <strong>config.js</strong> in the project files and paste the Project URL and Publishable Key from Supabase. Do not use a secret or service-role key.</p></div></div>`;
      return;
    }
    app.innerHTML = `<div class="login-wrap">
      <div class="login-logo">🎮</div><h1>Road to Christmas</h1><div class="sub">FAMILY STEP CHALLENGE · 10K A DAY</div>
      <div class="box"><h2>▶ Insert player PIN</h2>
        <form id="login-form" autocomplete="on">
          <label class="label" for="login-player">Player</label>
          <select id="login-player" name="username" autocomplete="username">${PLAYERS.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}</select>
          <label class="label" for="login-pin">6-digit PIN</label>
          <input id="login-pin" name="password" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="current-password" placeholder="••••••" required>
          <button id="login-button" type="submit">Press Start</button>
        </form>
        <div id="login-error" class="login-error" role="alert">${message ? esc(message) : ''}</div>
      </div>
      <p class="note center">Only the five family accounts can sign in. Ask Jaison if you need your PIN reset.</p>
    </div>`;
    document.getElementById('login-form').addEventListener('submit', handleLogin);
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (busy) return;
    const name = document.getElementById('login-player').value;
    const pin = document.getElementById('login-pin').value;
    if (!/^\d{6}$/.test(pin)) {
      document.getElementById('login-error').textContent = 'Enter your 6-digit PIN.';
      return;
    }
    busy = true;
    const button = document.getElementById('login-button');
    button.disabled = true; button.textContent = 'Checking PIN…';
    const person = PLAYERS.find(p => p.name === name);
    const { data, error } = await db.auth.signInWithPassword({ email: person.email, password: pin });
    busy = false;
    if (error || !data.user) {
      document.getElementById('login-error').textContent = 'PIN not recognised. Check the selected name and try again.';
      button.disabled = false; button.textContent = 'Press Start';
      return;
    }
    await startSession(data.user);
  }

  function countdownHtml() {
    const ms = endTime() - Date.now();
    const over = ms <= 0;
    const safe = Math.max(0, ms);
    const d = Math.floor(safe / 86400000);
    const h = Math.floor((safe % 86400000) / 3600000);
    const m = Math.floor((safe % 3600000) / 60000);
    return `<div class="box"><h2>${over ? '⏰ Challenge over' : '⏰ Time to Dec 25'}</h2><div class="cd"><div><b>${d}</b>days</div><div><b>${h}</b>hrs</div><div><b>${m}</b>min</div></div></div>`;
  }

  function trackHtml(leaderboard) {
    const leader = leaderboard[0] && leaderboard[0].pts > 0 ? leaderboard[0].name : null;
    const totalTarget = 57 * GOAL;
    const sprites = leaderboard.slice().sort((a, b) => PLAYERS.findIndex(p => p.name === a.name) - PLAYERS.findIndex(p => p.name === b.name)).map((r, i) => {
      const progress = Math.min(1, r.steps / totalTarget);
      const leftPercent = progress * 100;
      return `<div class="lane" style="top:${30 + i * 42}px"></div><div class="sp ${r.name === leader ? 'lead' : ''}" aria-label="${esc(r.name)}" style="top:${18 + i * 42}px;left:calc(${leftPercent}% + 4px - ${progress * 110}px);background:${r.color}">${esc(r.name[0])}</div>`;
    }).join('');
    return `<div class="track" aria-label="Family race track">${sprites}<div class="santa">🎅<br>🎁<small>₹2000 Amazon voucher</small></div></div>`;
  }

  function leaderboardHtml(leaderboard) {
    const rows = leaderboard.map((r, i) => `<tr class="${i === 0 && r.pts > 0 ? 'first' : ''}"><td class="rank">${i + 1}</td><td><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</td><td class="n">${r.pts.toFixed(1)}</td><td class="n">${(r.steps / 1000).toFixed(1)}k</td><td class="n">${r.streak}🔥</td></tr>`).join('');
    return `<div class="box"><h2>🏆 High scores</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th class="n">Pts</th><th class="n">Steps</th><th class="n">Streak</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">Ties break on total steps. Updates automatically while this page is open.</p></div>`;
  }

  function logRowsHtml() {
    const all = [];
    PLAYERS.forEach(p => Object.entries(S.logs[p.name] || {}).forEach(([day, steps]) => all.push({ day, name: p.name, steps: Number(steps) })));
    all.sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));
    if (!all.length) return '<div class="muted">No steps logged yet. Be the first!</div>';
    return all.slice(0, 40).map(row => {
      const manageable = canManageDate(row.name, row.day);
      const own = row.name === profile.player_name;
      const canEdit = isAdmin() || (own && manageable);
      const canDelete = canEdit;
      const actions = `${canEdit ? `<button class="mini secondary" data-action="edit" data-name="${esc(row.name)}" data-day="${row.day}">Edit</button>` : ''}${canDelete ? `<button class="mini danger" data-action="delete" data-name="${esc(row.name)}" data-day="${row.day}">✕</button>` : ''}`;
      return `<div class="log-item"><div class="log-info"><span style="color:${playerMeta(row.name).color}">${esc(row.name)}</span><br>${row.day} · ${fmt(row.steps)} steps ${row.steps >= GOAL ? '<span class="goal-mark">★</span>' : ''}</div><div class="log-actions">${actions || '<span class="status">Locked</span>'}</div></div>`;
    }).join('');
  }

  function historyHtml() {
    const days = [];
    let day = todayIST() > LAST ? LAST : todayIST();
    for (let i = 0; i < 7 && day >= START; i++, day = addDays(day, -1)) days.push(day);
    const header = PLAYERS.map(p => `<th style="color:${p.color}">${esc(p.name[0])}</th>`).join('');
    const rows = days.map(d => `<tr><td>${d.slice(5)}</td>${PLAYERS.map(p => {
      const value = S.logs[p.name] && S.logs[p.name][d];
      return `<td>${value === undefined ? '–' : (Number(value) / 1000).toFixed(1) + (Number(value) >= GOAL ? '★' : '')}</td>`;
    }).join('')}</tr>`).join('');
    return `<details><summary>Daily history · last 7 days</summary><div class="table-wrap"><table class="history"><thead><tr><th>Day</th>${header}</tr></thead><tbody>${rows}</tbody></table></div><p class="note">Numbers are in thousands of steps. ★ means 10,000 or more.</p></details>`;
  }

  function logFormHtml() {
    const t = todayIST();
    const mayLog = isAdmin() || canNonAdminLog();
    if (!mayLog) {
      return `<div class="box center"><h2>🔒 Logging closed</h2><p>${t < START ? 'The challenge opens on Oct 29, 2026.' : 'Player logging closed at midnight on Dec 25 IST. The final board is here!'}</p>${isAdmin() ? '' : '<p class="note">Jaison can still correct entries if needed.</p>'}</div>`;
    }
    const admin = isAdmin();
    const minDay = admin ? START : nonAdminMinDate();
    const maxDay = admin ? LAST : (t < LAST ? t : LAST);
    const dateVal = editing ? editing.day : clampDateForForm();
    const stepsVal = editing ? editing.steps : '';
    const personVal = editing ? editing.name : profile.player_name;
    const playerSelect = admin ? `<label class="label" for="log-player">Player</label><select id="log-player">${PLAYERS.map(p => `<option value="${esc(p.name)}" ${personVal === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : `<div class="player-tag">Player: ${esc(profile.player_name)}</div>`;
    const rangeNote = admin ? 'Admin mode: you can correct any date in the challenge.' : 'You can log or correct your own entries for today or the previous 7 days.';
    return `<div class="box" id="log-box"><h2>▶ ${editing ? 'Edit steps' : 'Log steps'}</h2><form id="log-form">
      ${playerSelect}
      <label class="label" for="log-day">Challenge day</label><input id="log-day" type="date" min="${minDay}" max="${maxDay}" value="${dateVal}" required>
      <label class="label" for="log-steps">Total steps</label><input id="log-steps" type="number" inputmode="numeric" min="0" max="100000" step="1" placeholder="e.g. 10482" value="${stepsVal}" required>
      <button id="save-log" type="submit">${editing ? 'Save changes' : 'Press start'}</button>
      ${editing ? '<button id="cancel-edit" class="secondary" type="button">Cancel edit</button>' : ''}
    </form><p class="note">${rangeNote} Re-entering the same date overwrites the previous number.</p></div>`;
  }

  function santaMessage(leaderboard) {
    const leader = leaderboard[0] && leaderboard[0].pts > 0 ? leaderboard[0] : null;
    if (challengeOver()) return `<div class="box santa-box">${leader ? '🎅 Ho ho ho! Winner: ' + esc(leader.name) + '! 🎁<br><br><span class="small">₹2000 AMAZON GIFT VOUCHER</span>' : '🎅 No winner logged. Santa will have to save the gift!'} </div>`;
    return `<div class="box santa-box">🎅 Santa waits with a ₹2000 Amazon voucher.<br><br>Top points at midnight on Dec 25 IST wins it!</div>`;
  }

  function renderDashboard() {
    if (!profile) return renderLogin();
    const leaderboard = getLeaderboard(S);
    const formHtml = logFormHtml();
    const configButtons = `<div class="top-actions"><span class="player-tag">▶ ${esc(profile.player_name)}${isAdmin() ? ' · ADMIN' : ''}</span><div style="display:flex;gap:7px"><button id="sound-toggle" class="mini secondary" type="button">${soundOn ? '🔊 Sound' : '🔇 Sound'}</button><button id="logout" class="mini secondary" type="button">Log out</button></div></div>`;
    app.innerHTML = `${configButtons}<h1>Road to Christmas</h1><div class="sub">Family step challenge · 10k a day</div>
      ${countdownHtml()}${trackHtml(leaderboard)}${santaMessage(leaderboard)}${leaderboardHtml(leaderboard)}
      ${formHtml}
      <div class="box"><h2>📜 Recent logs</h2><div class="log-list">${logRowsHtml()}</div>
      ${historyHtml()}
      <details><summary>How points work</summary><p>1 point per 1,000 steps, capped at 20,000 steps per day. +5 for reaching 10,000. Consecutive 10k days add +1 per day after the first, up to +5 extra.</p><p>Missed day? Surplus steps above 10,000 on a later day can pay down a deficit up to 7 days back, oldest missed day first. Fully covered days earn +2. A day under 10,000 breaks the streak.</p><p>Unlogged past days count as zero. Today only counts once logged.</p></details></div>
      <div class="box box-tight center"><p class="note">Install on your phone: use your browser menu → <strong>Add to Home Screen</strong> or <strong>Install app</strong>.</p>${deferredInstallPrompt ? '<button id="install-app" type="button">Install app</button>' : ''}</div>
      <div class="footer">GAME ON · OCT 29 — DEC 24, 2026 · IST</div>`;

    document.getElementById('sound-toggle').addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('rtc-sound', soundOn ? 'on' : 'off'); } catch (_) {} renderDashboard(); beep(false); });
    document.getElementById('logout').addEventListener('click', async () => {
      await db.auth.signOut(); profile = null; authUser = null; S = { logs: {} }; renderLogin(); toast('Logged out');
    });
    const form = document.getElementById('log-form');
    if (form) form.addEventListener('submit', handleLogSubmit);
    const cancel = document.getElementById('cancel-edit');
    if (cancel) cancel.addEventListener('click', () => { editing = null; renderDashboard(); });
    document.querySelectorAll('[data-action="edit"]').forEach(button => button.addEventListener('click', () => {
      editing = { name: button.dataset.name, day: button.dataset.day, steps: Number((S.logs[button.dataset.name] || {})[button.dataset.day]) };
      renderDashboard();
      document.getElementById('log-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('log-steps')?.focus({ preventScroll: true });
    }));
    document.querySelectorAll('[data-action="delete"]').forEach(button => {
      button.addEventListener('click', async () => {
        const key = button.dataset.name + '|' + button.dataset.day;
        if (button.dataset.confirm !== 'yes') {
          document.querySelectorAll('[data-action="delete"]').forEach(b => { if (b !== button) { b.dataset.confirm = 'no'; b.textContent = '✕'; } });
          button.dataset.confirm = 'yes'; button.textContent = 'SURE?';
          return;
        }
        if (busy) return;
        busy = true; button.disabled = true;
        const { error } = await db.from('logs').delete().eq('player_name', button.dataset.name).eq('day', button.dataset.day);
        busy = false;
        if (error) { toast('Could not delete entry. ' + error.message, true); return; }
        if (editing && key === editing.name + '|' + editing.day) editing = null;
        await fetchLogs(true); renderDashboard(); toast('Entry deleted');
      });
    });
    const install = document.getElementById('install-app');
    if (install) install.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      renderDashboard();
    });
  }

  async function handleLogSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const day = document.getElementById('log-day').value;
    const rawSteps = document.getElementById('log-steps').value;
    const steps = Number(rawSteps);
    const name = isAdmin() ? document.getElementById('log-player').value : profile.player_name;
    if (!day || !Number.isInteger(steps) || steps < 0 || steps > 100000) {
      toast('Enter a whole number between 0 and 100,000.', true); return;
    }
    if (day < START || day > LAST) { toast('Choose a day inside the challenge window.', true); return; }
    if (!isAdmin() && !canManageDate(name, day)) { toast('You can only edit your own entries for today or the last 7 days.', true); return; }
    busy = true;
    const saveButton = document.getElementById('save-log');
    saveButton.disabled = true; saveButton.textContent = 'Saving…';
    const { error } = await db.from('logs').upsert({ player_name: name, day, steps }, { onConflict: 'player_name,day' });
    busy = false;
    if (error) {
      toast(error.message.includes('row-level security') ? 'That edit is outside your permissions.' : 'Could not save entry. Check connection and try again.', true);
      console.error('Save log failed:', error.message);
      saveButton.disabled = false; saveButton.textContent = editing ? 'Save changes' : 'Press start';
      return;
    }
    editing = null;
    await fetchLogs(true);
    renderDashboard();
    toast(steps >= GOAL ? 'LEVEL UP! ' + name + ' HIT 10K' : 'Logged ' + fmt(steps) + ' steps for ' + name);
    beep(steps >= GOAL);
  }

  async function init() {
    try {
      soundOn = localStorage.getItem('rtc-sound') !== 'off';
    } catch (_) { soundOn = true; }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.info('PWA offline cache not registered:', err)));
    }
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault(); deferredInstallPrompt = event;
      if (profile) renderDashboard();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && profile && !document.querySelector('input:focus,select:focus')) fetchLogs(true);
    });
    if (!appConfigured()) { renderLogin(); return; }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      app.innerHTML = '<div class="box error-panel">Could not load the Supabase browser library. Check the internet connection and reload.</div>'; return;
    }
    db = window.supabase.createClient(window.RTC_CONFIG.SUPABASE_URL, window.RTC_CONFIG.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && profile) {
        profile = null; authUser = null; S = { logs: {} };
        if (refreshTimer) { window.clearInterval(refreshTimer); refreshTimer = null; }
        renderLogin();
      }
    });
    const { data, error } = await db.auth.getSession();
    if (error) console.error('Session restore failed:', error.message);
    if (data && data.session) await startSession(data.session.user);
    else renderLogin();
  }

  init();
})();
