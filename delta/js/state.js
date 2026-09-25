// Shared state for the Delta display and its control page.
// Its own storage key, so the Delta and United screens never overwrite each other in one browser.
// A display opened with "#s=..." uses a snapshot from the URL instead (for another device).
window.DFIDS = window.DFIDS || {};

(function (F) {
  const STORAGE_KEY = 'dfids.state.v1';

  // What the STATUS line can read. The gate screens show one of these, nothing else.
  F.STATUSES = ['On Time', 'Delayed', 'Early', 'At Gate', 'Boarding', 'Boarding Ended', 'Departed', 'Canceled'];

  // Which pair of time columns goes with a status, read off the photos:
  //   'departs'  DEPARTS            nothing has moved
  //   'waschg'   WAS / NOW          the time moved but the status is still operational (Boarding)
  //   'settled'  SCHEDULED / ACTUAL the status is itself about time - Delayed, Early, Boarding Ended
  // Every Delayed screen seen uses SCHEDULED / ACTUAL; WAS / NOW only turns up under Boarding.
  const SETTLED = /Delayed|Early|Boarding Ended|Departed|Canceled/;
  F.timeMode = function (s) {
    const changed = !!s.flight.actual && s.flight.actual !== s.flight.sched;
    if (!changed) return 'departs';
    return SETTLED.test(s.flight.status) ? 'settled' : 'waschg';
  };

  F.COLUMNS = {
    departs: ['DEPARTS'],
    waschg: ['WAS', 'NOW'],
    settled: ['SCHEDULED', 'ACTUAL'],
  };

  function pad(n) { return String(n).padStart(2, '0'); }

  F.defaultState = function () {
    const offset = -new Date().getTimezoneOffset();
    const dep = new Date(Date.now() + offset * 60000 + 84 * 60000);
    dep.setUTCMinutes(Math.round(dep.getUTCMinutes() / 5) * 5, 0, 0);
    const sched = dep.toISOString().slice(0, 16);
    return {
      version: 1,
      flight: {
        airline: 'DL',
        number: '2597',
        originCode: 'BOS',
        destCode: 'YUL',
        destLabel: 'Montreal-Trudeau',   // shown verbatim: "Syracuse, NY", "New York-JFK", ...
        sched: sched,
        actual: '',                      // the revised time, when there is one
        status: 'On Time',
        partners: 'LA 6167',             // codeshares, shown under PARTNERS
        gate: 'A30',
        utcOffsetMin: offset,
        tzLabel: 'EDT',
        updated: '',
        lock: false,
      },
      next: {
        // the ribbon along the bottom, verbatim
        text: 'Next flight departing this gate is DL1253 to Asheville, NC',
      },
      display: {
        clock24: false,
        autoStatus: true,                // work the status out from the clock instead of holding it fixed
      },
      feed: { enabled: false, url: 'http://127.0.0.1:8788', sec: 60, airport: '', gate: '', updated: '', error: '' },
    };
  };

  // Fill in any keys missing from an older saved state.
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

  F.airportNow = function (offsetMin) {
    return new Date(Date.now() + (offsetMin || 0) * 60000);   // read with getUTC*
  };

  // "9:05 am" the way the screens write it, or "09:05"
  F.fmtTime = function (dateOrLocal, clock24) {
    let h, m;
    if (typeof dateOrLocal === 'string') {
      if (!dateOrLocal) return '';
      [h, m] = dateOrLocal.slice(11, 16).split(':').map(Number);
    } else {
      h = dateOrLocal.getUTCHours(); m = dateOrLocal.getUTCMinutes();
    }
    if (clock24) return pad(h) + ':' + pad(m);
    return ((h % 12) || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'pm' : 'am');
  };

  F.shiftLocal = function (local, minutes) {
    if (!local) return '';
    return new Date(Date.parse(local + ':00Z') + minutes * 60000).toISOString().slice(0, 16);
  };

  // ---- what the screen should say right now ----

  F.derive = function (s) {
    const f = s.flight;
    const dep = f.actual || f.sched;
    const depT = F.toEpoch(dep, f.utcOffsetMin);
    const now = Date.now();
    const delayMin = f.actual && f.sched
      ? Math.round((F.toEpoch(f.actual, f.utcOffsetMin) - F.toEpoch(f.sched, f.utcOffsetMin)) / 60000) : 0;

    let status = f.status;
    if (s.display.autoStatus && isFinite(depT)) {
      // Roughly what the real screens walk through: at the gate, boarding from -35 min, ended at -10.
      const mins = (depT - now) / 60000;
      if (mins <= -10) status = 'Departed';
      else if (mins <= 10) status = 'Boarding Ended';
      else if (mins <= 35) status = 'Boarding';
      else if (delayMin >= 5) status = 'Delayed';
      else if (delayMin <= -5) status = 'Early';
      else status = 'At Gate';
      if (/Canceled/i.test(f.status)) status = 'Canceled';
    }

    const mode = F.timeMode({ ...s, flight: { ...f, status } });
    const labels = F.COLUMNS[mode];
    const times = mode === 'departs' ? [dep] : [f.sched, f.actual || f.sched];
    return { status, mode, labels, times, delayMin, dep };
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
})(window.DFIDS);
