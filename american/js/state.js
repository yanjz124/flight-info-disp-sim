// Shared state for the American display and its control page. Its own storage key, so the three airlines
// never overwrite each other in one browser. "#s=..." loads a snapshot from the URL instead.
window.AFIDS = window.AFIDS || {};

(function (F) {
  const STORAGE_KEY = 'afids.state.v1';

  F.STATUSES = ['On Time', 'Delayed', 'Canceled'];
  // The right-hand panel is one of these; the notice is what the screens show by default.
  F.PANELS = { notice: 'Boarding notice', upgrades: 'Upgrade list', none: 'Nothing (full width)' };

  function pad(n) { return String(n).padStart(2, '0'); }

  F.defaultState = function () {
    const offset = -new Date().getTimezoneOffset();
    const dep = new Date(Date.now() + offset * 60000 + 52 * 60000);
    dep.setUTCMinutes(Math.round(dep.getUTCMinutes() / 5) * 5, 0, 0);
    const sched = dep.toISOString().slice(0, 16);
    return {
      version: 1,
      flight: {
        airline: 'AA',
        number: '585',
        originCode: 'MIA',
        destCode: 'BGI',
        destLabel: 'Bridgetown, Barbados',   // shown verbatim, as "Miami, FL" or "New York - LaGuardia"
        sched: sched,                         // Departs
        arrives: F.shiftLocal(sched, 284),    // Arrives
        arrivesChanged: false,                // shows "Now arrives" instead of "Arrives"
        boardsAt: F.shiftLocal(sched, -45),
        status: 'On Time',
        group: 'First Class',                 // the chip shown once boarding starts
        gate: '12',
        utcOffsetMin: offset,
        tzLabel: '',                          // some screens append EDT to the times
        lock: false,
      },
      panel: {
        mode: 'notice',
        upgradeCabin: 'First',
        // surname + initial, as the screens show them publicly
        upgrades: ['WHI, B', 'ZIM, P', 'IHC, S', 'CHR, S', 'FIN, M', 'CAS, G', 'KEY, M', 'LEA, M', 'WAL, W', 'HAG, T'],
        cleared: 2,                           // how many at the top of the list have cleared
      },
      display: {
        clock24: false,
        autoBoarding: true,                   // work the boarding line out from the clock
      },
    };
  };

  function merge(base, saved) {
    if (!saved || typeof saved !== 'object' || Array.isArray(base)) return saved === undefined ? base : saved;
    const out = { ...base };
    for (const k of Object.keys(saved)) {
      out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
        ? merge(base[k], saved[k]) : saved[k];
    }
    return out;
  }

  F.encodeState = function (s) { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); };
  F.decodeState = function (str) { return JSON.parse(decodeURIComponent(escape(atob(str)))); };
  function hashParams() { return new URLSearchParams(location.hash.replace(/^#/, '')); }
  F.isSnapshot = function () { return hashParams().has('s'); };

  F.load = function () {
    const def = F.defaultState();
    try {
      const h = hashParams();
      if (h.has('s')) return merge(def, F.decodeState(h.get('s')));
    } catch (e) { console.warn('Bad snapshot in URL', e); }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return merge(def, JSON.parse(raw));
    } catch (e) { console.warn('Could not read saved state', e); }
    return def;
  };
  F.save = function (s) {
    if (F.isSnapshot()) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { console.warn(e); }
  };
  F.onChange = function (cb) {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue) cb(merge(F.defaultState(), JSON.parse(e.newValue)));
    });
  };

  // ---- time helpers (flight times are airport-local wall clock + utcOffsetMin) ----
  F.toEpoch = function (local, offsetMin) {
    if (!local) return NaN;
    return Date.parse(local + ':00Z') - (offsetMin || 0) * 60000;
  };
  F.airportNow = function (offsetMin) { return new Date(Date.now() + (offsetMin || 0) * 60000); };

  // "6:15 AM" - American writes the meridiem in caps, unlike United and Delta
  F.fmtTime = function (dateOrLocal, clock24) {
    let h, m;
    if (typeof dateOrLocal === 'string') {
      if (!dateOrLocal) return '';
      [h, m] = dateOrLocal.slice(11, 16).split(':').map(Number);
    } else {
      h = dateOrLocal.getUTCHours(); m = dateOrLocal.getUTCMinutes();
    }
    if (clock24) return pad(h) + ':' + pad(m);
    return ((h % 12) || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM');
  };

  F.shiftLocal = function (local, minutes) {
    if (!local) return '';
    return new Date(Date.parse(local + ':00Z') + minutes * 60000).toISOString().slice(0, 16);
  };

  // "4h 44m", from the two times
  F.duration = function (s) {
    const f = s.flight;
    const a = F.toEpoch(f.sched, f.utcOffsetMin), b = F.toEpoch(f.arrives, f.utcOffsetMin);
    if (!isFinite(a) || !isFinite(b) || b <= a) return '';
    const mins = Math.round((b - a) / 60000);
    return Math.floor(mins / 60) + 'h ' + pad(mins % 60) + 'm';
  };

  // ---- the boarding line, which is the biggest thing on the screen ----
  // Seen on real screens: "Boards at 6:15 AM", "Boards in 9 minutes", "Boarding shortly",
  // and "Boarding" with the group beside it in a chip.
  F.derive = function (s) {
    const f = s.flight;
    const now = Date.now();
    const boardT = F.toEpoch(f.boardsAt, f.utcOffsetMin);
    const depT = F.toEpoch(f.sched, f.utcOffsetMin);
    const mins = Math.round((boardT - now) / 60000);

    let line = '', group = '';
    if (/Cancel/i.test(f.status)) {
      line = 'Flight canceled';
    } else if (!s.display.autoBoarding) {
      line = f.boardsAt ? 'Boards at ' + F.fmtTime(f.boardsAt, s.display.clock24) : '';
      group = f.group;
    } else if (!isFinite(boardT)) {
      line = '';
    } else if (now >= depT) {
      line = 'Departed';
    } else if (mins <= 0) {
      line = 'Boarding';
      group = f.group;
    } else if (mins <= 1) {
      line = 'Boarding shortly';
    } else if (mins <= 30) {
      line = 'Boards in ' + mins + ' minute' + (mins === 1 ? '' : 's');
    } else {
      line = 'Boards at ' + F.fmtTime(f.boardsAt, s.display.clock24);
    }
    return { line, group, minsToBoard: mins, duration: F.duration(s) };
  };

  // Reload a long-running page when the site is updated (GitHub Pages caches files for ~10 min).
  F.watchForUpdates = function (everyMs) {
    const files = () => [location.pathname,
      ...[...document.scripts].map((x) => x.src).filter(Boolean),
      ...[...document.querySelectorAll('link[rel=stylesheet]')].map((x) => x.href).filter((h) => h.startsWith(location.origin))];
    const tag = async (u) => {
      const r = await fetch(u, { method: 'HEAD', cache: 'no-store' });
      return r.headers.get('etag') || r.headers.get('last-modified') || '';
    };
    let seen = null;
    setInterval(async () => {
      try {
        const tags = (await Promise.all(files().map(tag))).join('|');
        if (seen === null) seen = tags;
        else if (tags !== seen) location.reload();
      } catch (e) { /* offline: try again next time */ }
    }, everyMs || 10 * 60000);
  };
})(window.AFIDS);
