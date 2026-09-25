// Shared state for the display and control pages.
// State lives in localStorage so any tab on the same browser stays in sync.
// A display opened with "#s=..." uses a snapshot from the URL instead (for another device).
window.FIDS = window.FIDS || {};

(function (F) {
  const STORAGE_KEY = 'fids.state.v2';

  // United boarding order. Index 0 is pre-boarding.
  F.GROUPS = ['Pre-boarding', 'Group 1', 'Group 2', 'Group 3', 'Group 4', 'Group 5', 'Group 6'];
  F.LAST_GROUP = F.GROUPS.length - 1;

  // Right-hand panel phases.
  F.PHASES = {
    auto: 'Auto (by clock)',
    promo: 'Promos',
    countdown: 'Boarding in N min',
    soon: 'Boarding soon',
    boarding: 'Boarding groups',
    final: 'Final boarding',
    closed: 'Boarding closed',
  };

  F.PILLS = { auto: 'Auto', ontime: 'On Time', delayed: 'Delayed' };

  function pad(n) { return String(n).padStart(2, '0'); }

  F.defaultState = function () {
    const offset = -new Date().getTimezoneOffset();
    const dep = new Date(Date.now() + offset * 60000 + 70 * 60000);
    dep.setUTCMinutes(Math.round(dep.getUTCMinutes() / 5) * 5, 0, 0);
    const sched = dep.toISOString().slice(0, 16);
    return {
      version: 2,
      flight: {
        airline: 'UA',
        number: '5220',
        originCode: 'SFO',
        destCode: 'SMF',
        destLabel: 'Sacramento, CA (SMF)',
        sched: sched,
        est: '',
        delayReason: '',         // e.g. "Late aircraft"; shown on the status page
        arr: F.shiftLocal(sched, 50),
        gate: 'F5',
        terminal: '3',
        aircraft: 'Embraer E175',
        apiStatus: '',
        utcOffsetMin: offset,
        updated: '',
        lock: false,
      },
      boarding: {
        phase: 'auto',
        group: 0,
        pill: 'auto',
        leadMin: 30,             // boarding time = departure - leadMin
        groupEveryMin: 4,
        closeMin: 15,            // boarding closes this long before departure
        autoNext: true,          // once it has gone, show the next departure from the same gate
        countdownMin: 45,        // show "Boarding in N minutes" inside this window
      },
      amenities: {
        wifi: '($)',             // '' hides it
        wifiProvider: '',        // "Starlink" shows under the Wi-Fi line
        power: 'Rows 1-4',       // '' hides it
        entertainment: false,
        food: '',
        beverages: true,
      },
      upgrades: {
        cabin: 'United First®',
        capacity: 12,
        booked: 'Full',
        checkedIn: 9,
        list: [
          { name: 'CHO, A.', ci: true, seat: '' },
          { name: 'DAE, R.', ci: true, seat: '' },
          { name: 'HAG, K.', ci: true, seat: '' },
          { name: 'LUM, J.', ci: true, seat: '' },
          { name: 'LUM, W.', ci: true, seat: '' },
          { name: 'SIE, F.', ci: false, seat: '' },
          { name: 'CHE, J.', ci: true, seat: '' },
          { name: 'PER, D.', ci: true, seat: '' },
          { name: 'TOR, D.', ci: true, seat: '' },
        ],
      },
      standby: {
        cabins: 'United First® = Full\nUnited Economy® = Available',
        list: [
          { name: 'MEC, A.', ci: true, seat: '23F' },
          { name: 'SUM, S.', ci: true, seat: '15C' },
          { name: 'GAR, J.', ci: true, seat: '' },
        ],
      },
      united: {                  // extra detail from the united.com bookmarklet (see js/united.js)
        updated: '',
      },
      feed: {                    // optional local server (server/gate_feed.py): follows a gate and rolls over
        enabled: false,
        url: 'http://127.0.0.1:8788',
        sec: 60,
        follow: 'gate',          // what "Send to the feed" sets up: 'gate' (airport + gate) or 'calendar'
        airport: '',
        gate: '',
        updated: '',
        error: '',
      },
      next: {
        dest: 'Bozeman, MT (BZN)',
        flight: 'UA562',
        time: F.shiftLocal(sched, 105),
        status: 'On Time',
      },
      display: {
        clock24: false,
        logoUrl: '',
        qrUrl: 'assets/qr-assistance.png',
        tabMode: 'rotate',       // 'rotate' | 'flight' | 'upgrades' | 'standbys'
        tabSec: 10,
        panelSec: 8,             // rotation speed of promos and boarding sub-views
        promoTurn: true,         // "Arrival - Cleaning - Boarding": where the aircraft has got to
        promoApp: true,
        promoWifi: true,
        promoPass: true,
        seatedSlide: false,      // "Groups 3-6 have a seat" slide during groups 1-2 (off until it matches the real screens)
        wifiMember: '$8',
        wifiNonMember: '$10',
      },
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

  F.encodeState = function (s) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(s))));
  };
  F.decodeState = function (str) {
    return JSON.parse(decodeURIComponent(escape(atob(str))));
  };

  function hashParams() {
    return new URLSearchParams(location.hash.replace(/^#/, ''));
  }

  // True when this page was opened from a snapshot link.
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
    return new Date(Date.now() + (offsetMin || 0) * 60000); // read with getUTC*
  };

  // "9:35 am" (gate-screen style) or "09:35"
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

  // "Sat. Jan 17"
  const DAYS = ['Sun.', 'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  F.fmtDate = function (d) {
    return DAYS[d.getUTCDay()] + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  };

  F.shiftLocal = function (local, minutes) {
    if (!local) return '';
    return new Date(Date.parse(local + ':00Z') + minutes * 60000).toISOString().slice(0, 16);
  };

  // ---- derived display state ----

  F.derive = function (s) {
    const f = s.flight, b = s.boarding;
    const off = f.utcOffsetMin;
    const now = Date.now();
    const depLocal = f.est || f.sched;
    const depT = F.toEpoch(depLocal, off);
    const delayMin = f.est && f.sched ? Math.round((F.toEpoch(f.est, off) - F.toEpoch(f.sched, off)) / 60000) : 0;
    const boardLocal = F.shiftLocal(depLocal, -(+b.leadMin || 0));
    const boardT = F.toEpoch(boardLocal, off);
    const api = (f.apiStatus || '').toLowerCase();
    const minsToBoard = Math.max(0, Math.ceil((boardT - now) / 60000));

    let pill = b.pill;
    if (pill === 'auto' || !F.PILLS[pill]) pill = delayMin >= 5 || api === 'delayed' ? 'delayed' : 'ontime';

    let phase = b.phase, group = Math.max(0, Math.min(F.LAST_GROUP, +b.group || 0));
    if (phase === 'auto' && isFinite(depT)) {
      const every = Math.max(1, +b.groupEveryMin || 4) * 60000;
      if (/cancel|departed|enroute|arrived|approaching/.test(api) ||
          now >= depT - (+b.closeMin || 0) * 60000) phase = 'closed';
      else if (now >= boardT) {
        const i = Math.floor((now - boardT) / every);
        if (i > F.LAST_GROUP) phase = 'final';
        else { phase = 'boarding'; group = i; }
      } else if (minsToBoard <= 5) phase = 'soon';
      else if (minsToBoard <= (+b.countdownMin || 0)) phase = 'countdown';
      else phase = 'promo';
    } else if (phase === 'auto') phase = 'promo';
    if (!F.PHASES[phase]) phase = 'closed';   // old saved "departed"/"cancelled" phases

    return { phase, group, pill, delayMin, depLocal, boardLocal, minsToBoard };
  };

  // Per-flight data that must not carry over to a different flight (amenities, lists, delay reason...).
  F.flightKey = (f) => [f.airline, String(f.number || '').replace(/\D/g, ''), (f.sched || '').slice(0, 10), f.originCode].join('|').toUpperCase();
  F.resetFlightData = function (s) {
    s.amenities = { wifi: '', wifiProvider: '', power: '', entertainment: false, food: '', beverages: false };
    s.upgrades = { cabin: s.upgrades.cabin, capacity: '', booked: '', checkedIn: '', list: [] };
    s.standby = { cabins: '', list: [] };
    s.united = { updated: '' };
    s.next = { dest: '', flight: '', time: '', status: '' };
    s.flight.delayReason = '';
    s.flight.tail = '';
  };

  // Once a flight has gone, move the screen on to the next departure from its gate: the one already named
  // in the footer, which FlightView put there. Returns true when it changed the flight, so a caller can
  // save and redraw. Amenities and the name lists belong to the flight that left, so they go with it.
  const ROLL_GRACE_MS = 10 * 60000;             // keep a departed flight up this long, as the feed does
  F.rollOver = function (s) {
    const f = s.flight, b = s.boarding, next = { ...s.next };
    if (!b.autoNext || f.lock || s.feed.enabled) return false;   // the feed rolls its own gate over
    if (!next.flight || !next.time) return false;
    const depT = F.toEpoch(f.est || f.sched, f.utcOffsetMin), nextT = F.toEpoch(next.time, f.utcOffsetMin);
    if (!isFinite(depT) || !isFinite(nextT) || nextT <= depT) return false;
    if (Date.now() < depT + ROLL_GRACE_MS) return false;
    F.resetFlightData(s);
    const m = /^([A-Za-z]{2})\s*0*(\d+)$/.exec(next.flight.trim());
    if (m) { f.airline = m[1].toUpperCase(); f.number = m[2]; }
    f.destLabel = next.dest;
    f.destCode = (next.dest.match(/\(([A-Z]{3})\)\s*$/) || [])[1] || '';
    f.sched = next.time;
    f.est = f.arr = '';
    f.apiStatus = /delay/i.test(next.status || '') ? 'Delayed' : '';
    b.phase = 'auto';                            // the new flight starts its own boarding over again
    b.group = 0;
    return true;
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
        const now = await Promise.all(files().map(tag));
        if (seen && now.join() !== seen.join()) {
          await Promise.all(files().map((u) => fetch(u, { cache: 'reload' })));   // refresh the HTTP cache first
          location.reload();
        }
        seen = now;
      } catch (e) { /* offline: try again later */ }
    }, everyMs || 3 * 60000);
  };

  // Bulk add: one name per line, optional seat at the end ("SMITH, J. 3A").
  F.parseNames = function (text) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)[\s|=]+(\d{1,2}[A-L])$/i);
      return m ? { name: m[1].trim().toUpperCase(), ci: true, seat: m[2].toUpperCase() }
               : { name: l.toUpperCase(), ci: true, seat: '' };
    });
  };

  // "United First® = Full" lines -> [{ cabin, status }]
  F.parseCabins = function (text) {
    return (text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf('=');
      return i < 0 ? { cabin: l, status: '' } : { cabin: l.slice(0, i).trim(), status: l.slice(i + 1).trim() };
    });
  };
})(window.FIDS);
