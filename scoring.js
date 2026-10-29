/* The scoring rules below are intentionally kept aligned with the original prototype. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RTCScoring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const START = '2026-10-29';
  const LAST = '2026-12-24';
  const GOAL = 10000;
  const CAP = 20000;

  const pad = n => String(n).padStart(2, '0');
  const dateString = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (s, n) => {
    const [y, m, d] = s.split('-').map(Number);
    return dateString(new Date(y, m - 1, d + n));
  };
  function todayIST() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }

  function score(name, logs, todayOverride) {
    const L = (logs && logs[name]) || {};
    const t = todayOverride || todayIST();
    const last = t < LAST ? t : LAST;
    const days = [];
    for (let d = START; d <= last; d = addDays(d, 1)) {
      if (d === t && L[d] === undefined) continue;
      days.push(d);
    }
    const st = days.map(d => L[d] || 0);
    const def = st.map(s => Math.max(0, GOAL - s));
    const cov = st.map(() => false);
    let pts = 0, streak = 0, steps = 0, hits = 0, made = 0;
    days.forEach((d, i) => {
      const s = st[i];
      steps += s;
      pts += Math.min(s, CAP) / 1000;
      if (s >= GOAL) {
        hits++;
        streak++;
        pts += 5 + Math.min(streak - 1, 5);
      } else streak = 0;
      if (s > GOAL) {
        let sur = s - GOAL;
        for (let j = Math.max(0, i - 7); j < i && sur > 0; j++) {
          if (st[j] < GOAL && !cov[j]) {
            const pay = Math.min(sur, def[j]);
            def[j] -= pay;
            sur -= pay;
            if (def[j] <= 0) {
              cov[j] = true;
              pts += 2;
              made++;
            }
          }
        }
      }
    });
    return { name, pts: Math.round(pts * 10) / 10, steps, hits, streak, made };
  }

  return { START, LAST, GOAL, CAP, addDays, todayIST, score };
});
