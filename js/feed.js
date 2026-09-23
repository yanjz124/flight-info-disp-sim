// Optional local feed (server/gate_feed.py): follows one gate, rolls over to the next flight after
// departure, and serves United + FlightView data on localhost. Pages poll it; nothing is uploaded.
window.FIDS = window.FIDS || {};

(function (F) {
  const LOCK = 'fids.lastFeed';

  F.fetchFeed = async function (s) {
    const url = (s.feed.url || '').replace(/\/$/, '') + '/state';
    let res;
    try {
      res = await fetch(url, { cache: 'no-store' });
    } catch (e) {
      throw new Error('Feed not reachable at ' + s.feed.url + '. Is gate_feed.py running?');
    }
    if (!res.ok) throw new Error(res.status + ' from the feed');
    return res.json();
  };

  // Apply one feed reading. Returns a short status message.
  F.applyFeed = function (s, d) {
    if (!d || (!d.united && !d.fv)) throw new Error(d && d.error ? d.error : 'The feed is getting its first update for ' + F.describeFeed(d && d.config) + ' (about a minute)...');
    let msg = '';
    // Following a gate makes this that gate's screen, so it shows the gate that was set straight away --
    // a flight that turns up there brings its own gate, in FlightView's spelling, and wins below.
    if (d.config && d.config.mode === 'gate' && d.config.gate) {
      s.flight.gate = d.config.gate;
      if (d.config.airport) s.flight.originCode = d.config.airport;
    }
    if (d.flight && d.fv) {
      // The server picked which flight is at the gate; follow it even before United's data lands.
      F.useFlightViewDeparture(s, d.flight, d.fv.airport);
    }
    if (d.united) F.applyUnited(s, d.united);
    if (d.fv) {
      const r = F.applyFlightView(s, d.fv);
      msg = (r && r.ok ? ' · ' + r.msg : '');
    }
    s.feed = { ...s.feed, updated: d.fetchedAt || new Date().toISOString(), error: d.error || '' };
    // The feed found nothing to follow. Whatever is on screen is the flight from before, so say that rather
    // than report it as an update: otherwise a gate with no departures looks exactly like a gate with one.
    if (!d.flight) throw new Error(d.error || 'The feed has no flight to follow yet.');
    return (s.flight.airline + s.flight.number) + ' at gate ' + (s.flight.gate || '?') +
      ' from the local feed' + (d.note ? ': ' + d.note : '') + (d.error ? ' (' + d.error + ')' : '') + msg;
  };

  // The calendar link is private (names, booking codes), so it stays out of the shared state and snapshots.
  const ICS_KEY = 'fids.ics';
  F.getIcs = function () { try { return localStorage.getItem(ICS_KEY) || ''; } catch (e) { return ''; } };
  F.setIcs = function (v) { try { v ? localStorage.setItem(ICS_KEY, v) : localStorage.removeItem(ICS_KEY); } catch (e) {} };

  // Tell the feed what to follow: { ics } or { airport, gate }. Returns the feed's new setup.
  F.configureFeed = async function (s, cfg) {
    let res;
    try {
      res = await fetch((s.feed.url || '').replace(/\/$/, '') + '/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
      });
    } catch (e) {
      throw new Error('Feed not reachable at ' + s.feed.url + '. Start it with: python server/gate_feed.py');
    }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || res.status + ' from the feed');
    return d.config;
  };
  F.describeFeed = (c) => !c || !c.mode ? 'nothing yet' : c.mode === 'calendar' ? "your calendar's UA flights" : c.airport + ' gate ' + c.gate;

  // Ask the feed to find a flight (see F.lookupUrl): it runs on this computer, so it can call FlightView
  // directly and answer without a browser tab. Returns the same results the bookmark would hand over.
  F.lookupViaFeed = async function (s, q) {
    const url = (s.feed.url || '').replace(/\/$/, '') + '/lookup?' + new URLSearchParams(q);
    let res;
    try {
      res = await fetch(url, { cache: 'no-store' });
    } catch (e) {
      const err = new Error('Feed not reachable at ' + s.feed.url);
      err.offline = true;                                    // the caller asks FlightView in a tab instead
      throw err;
    }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || res.status + ' from the feed');
    return (d.results || []).map(F.lookupResult);
  };

  F.refreshFeed = async function (s) {
    return F.applyFeed(s, await F.fetchFeed(s));
  };

  // One page per interval does the fetching; the others follow through shared storage.
  F.claimFeed = function (ms) {
    try {
      const last = +localStorage.getItem(LOCK) || 0;
      if (Date.now() - last < ms) return false;
      localStorage.setItem(LOCK, String(Date.now()));
    } catch (e) {}
    return true;
  };

  // Poll loop shared by the display and control pages.
  F.startFeedPolling = function (getState, onUpdate, onError) {
    const tick = async () => {
      const s = getState();
      if (!s.feed.enabled || !s.feed.url) return;
      const every = Math.max(15, +s.feed.sec || 60) * 1000;
      if (!F.isSnapshot() && !F.claimFeed(every)) return;
      if (F.isSnapshot()) {
        if (Date.now() - (tick.last || 0) < every) return;
        tick.last = Date.now();
      }
      try {
        onUpdate(await F.refreshFeed(s));
      } catch (e) {
        onError(e.message);
      }
    };
    setInterval(tick, 10000);
    tick();
  };
})(window.FIDS);
