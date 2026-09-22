// Gate helpers shared by the FlightView import and the local feed. No API keys: everything the display
// needs is scraped from the pages the user opens (united.com, FlightView) or from server/gate_feed.py.
window.FIDS = window.FIDS || {};

(function (F) {
  // Gates are written differently by different sources ("C107", "107", "Gate C 107"): compare loosely.
  const normGate = (g) => String(g || '').toUpperCase().replace(/^GATE\s*/, '').replace(/[^A-Z0-9]/g, '');
  const sameGate = F.sameGate = (a, b) => {
    a = normGate(a); b = normGate(b);
    if (!a || !b) return false;
    return a === b || a.replace(/^[A-Z]+/, '') === b || b.replace(/^[A-Z]+/, '') === a;
  };

  // The next departure (same airline) from the same gate after the current flight, from a departures list.
  F.pickNext = function (s, list) {
    const f = s.flight, dep = f.est || f.sched;
    return list.find((n) => sameGate(n.gate, f.gate) && (n.est || n.sched) > dep &&
      !(n.airline === f.airline && n.number === f.number)) || null;
  };

  F.applyNext = function (s, n) {
    if (!n) return;
    s.next.dest = n.destLabel;
    s.next.flight = n.airline + n.number;
    s.next.time = n.est || n.sched;
    s.next.status = /cancel/i.test(n.apiStatus) ? 'Cancelled' : n.est ? 'Delayed' : 'On Time';
  };

})(window.FIDS);
