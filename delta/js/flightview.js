// Finding a Delta flight. FlightView is airline-agnostic, so the same two endpoints the United side uses
// work here: one flight number's legs on a date, and every flight on a route that day. FlightView only
// answers its own pages, so the query rides in the hash of a FlightView page and a bookmarklet answers it
// there, handing the result back to this page.
window.DFIDS = window.DFIDS || {};

(function (F) {
  // Runs on flightview.com, serialised into a javascript: bookmark. Keep it self-contained.
  function grab(target) {
    var toast = function (msg) {
      var n = document.createElement('div');
      n.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#0c1b3a;color:#fff;padding:14px 18px;border-radius:8px;font:15px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:360px';
      n.textContent = msg; document.body.appendChild(n); return n;
    };
    var send = function (key, payload, note) {
      var url = target + '#' + key + '=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
      var w = window.open(url, 'dfids-control');
      if (w) { note.textContent = 'Sent to the gate display.'; setTimeout(function () { note.remove(); }, 4000); return; }
      note.textContent = 'Data ready. ';
      var a = document.createElement('a');
      a.href = url; a.target = 'dfids-control'; a.textContent = 'Send to gate display';
      a.style.cssText = 'color:#8fc1ff;font-weight:bold';
      note.appendChild(a);
    };
    var get = function (path) {
      return fetch('https://app-api.flightview.com/api/' + path, { credentials: 'include' }).then(function (r) {
        if (!r.ok) throw new Error(r.status + ' from FlightView');
        return r.json();
      });
    };
    var leg = function (al, no, from, date) {
      return get('flight/' + al + '/' + no + '?departureDate=' + date + '&departureAirport=' + from)
        .then(function (d) { return d && d.flight ? { al: al, no: String(no), f: d.flight } : null; })
        .catch(function () { return null; });
    };
    if (location.hostname.indexOf('flightview.com') < 0) {
      alert('Open FlightView, then click this bookmark again.');
      return;
    }
    var q = null;
    try {
      var m = location.hash.match(/(?:^#|&)dq=([^&]+)/);
      if (m) q = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
    } catch (e) {}

    if (q) {
      var note = toast('Looking up ' + (q.k === 'number' ? q.al + q.no : q.from + '-' + q.to) + ' on ' + q.date + '...');
      var fail = function (e) { note.textContent = 'Lookup failed: ' + e.message; setTimeout(function () { note.remove(); }, 8000); };
      var done = function (rs) {
        rs = rs.filter(Boolean);
        if (!rs.length) return fail(new Error('FlightView has no such flight on ' + q.date + '.'));
        send('lookup', { fetchedAt: new Date().toISOString(), query: q, results: rs }, note);
      };
      if (q.k === 'number') {
        get('flight/' + q.al + '/' + q.no + '?departureDate=' + q.date)
          .then(function (d) {
            return Promise.all(((d && d.flights) || []).slice(0, 4)
              .filter(function (l) { return l.departureAirportCode; })
              .map(function (l) { return leg(q.al, q.no, l.departureAirportCode, q.date); }));
          })
          .then(done).catch(fail);
      } else {
        get('v2/route/' + q.from + '/' + q.to + '/' + q.date + '?airlineCode=' + q.al)
          .then(function (d) {
            done(((d && d.flights) || []).map(function (x) {
              return { al: x.airlineCode, no: String(x.flightNumber), from: q.from, to: q.to, date: q.date,
                       sch: x.scheduledTime || x.departureTime, upd: x.departureTime, st: x.displayStatus };
            }));
          })
          .catch(fail);
      }
      return;
    }

    // No query: an airport departures page, sent over so the next flight from a gate can be picked.
    var ap = location.pathname.match(/airport\/([A-Za-z]{3})/);
    if (!ap) { alert("Open an airport's Departures page on FlightView, then click this bookmark again."); return; }
    var code = ap[1].toUpperCase(), n2 = toast('Grabbing ' + code + ' departures...');
    get('airport/' + code + '/departures')
      .then(function (list) {
        send('fv', { airport: code, fetchedAt: new Date().toISOString(), departures: list.map(function (x) {
          return { al: x.airlineCode, no: x.flightNumber, date: x.flightDate, sch: x.scheduledTime,
                   upd: x.updatedTime, gate: x.gate, to: x.airportCode, toName: x.airport, st: x.displayStatus };
        }) }, n2);
      })
      .catch(function (e) { n2.textContent = 'Could not grab departures: ' + e.message; });
  }

  F.bookmarklet = function (target) {
    return 'javascript:' + encodeURIComponent('(' + grab.toString() + ')(' + JSON.stringify(target) + ')');
  };

  F.lookupUrl = function (q) {
    const path = q.k === 'number' ? '/flight-tracker/' + q.al + '/' + q.no
                                  : '/flight-tracker/by-route-results/' + q.from + '/' + q.to + '/' + q.date + '?airlineCode=' + q.al;
    return 'https://www.flightview.com' + path + '#dq=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(q)))));
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // FlightView writes times as "18:30, Sep 22" with no year; `iso` is the same time stamped in full.
  function when(text, iso) {
    const m = /^(\d{1,2}):(\d{2})(?:,\s*([A-Za-z]{3})\s+(\d{1,2}))?/.exec(text || '');
    if (!m) return (iso || '').slice(0, 16);
    const clock = String(+m[1]).padStart(2, '0') + ':' + m[2];
    const ref = (iso || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!m[3]) return ref + 'T' + clock;
    const month = MONTHS.indexOf(m[3]), refMonth = +ref.slice(5, 7) - 1;
    let year = +ref.slice(0, 4);
    if (refMonth === 11 && month === 0) year++;
    if (refMonth === 0 && month === 11) year--;
    return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(+m[4]).padStart(2, '0') + 'T' + clock;
  }

  F.lookupResult = function (r) {
    if (!r.f) {                                   // a route row: the route and date are the ones asked for
      const at = (t) => {
        const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
        return m ? r.date + 'T' + String(+m[1]).padStart(2, '0') + ':' + m[2] : '';
      };
      const sched = at(r.sch), upd = at(r.upd);
      return { al: r.al, no: String(r.no), from: r.from, to: r.to, toName: '', sched, actual: upd !== sched ? upd : '',
               gate: '', st: r.st || '' };
    }
    const d = r.f.departure || {}, a = r.f.arrival || {};
    const sched = when(d.scheduledTime, d.departureDateTime);
    const actual = when(d.estimatedTime || d.outGateTime || d.offGroundTime, d.departureDateTime);
    return {
      al: r.al, no: String(r.no), from: d.airportCode || '', to: a.airportCode || '',
      toName: a.airportCity || a.airport || '', sched, actual: actual && actual !== sched ? actual : '',
      gate: d.gate || '', st: r.f.flightStatus || '',
    };
  };

  F.importFromHash = function (key) {
    const m = location.hash.match(new RegExp('(?:^#|&)' + key + '=([^&]+)'));
    if (!m) return null;
    history.replaceState(null, '', location.pathname + location.search);
    return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
  };

  // Delta writes New York as "New York-JFK" / "New York-LaGuardia" and everywhere else as "City, ST".
  const SPECIAL = { JFK: 'New York-JFK', LGA: 'New York-LaGuardia', EWR: 'Newark, NJ', DCA: 'Washington-Reagan',
                    IAD: 'Washington-Dulles', YUL: 'Montreal-Trudeau', YYZ: 'Toronto-Pearson', ORD: 'Chicago-O’Hare',
                    MDW: 'Chicago-Midway', DFW: 'Dallas-Fort Worth, TX' };
  F.destLabel = function (code, cityName) {
    if (SPECIAL[code]) return SPECIAL[code];
    const us = window.FIDS && window.FIDS.AIRPORTS && window.FIDS.AIRPORTS[code];
    return us || cityName || code;
  };

  // Show a looked-up flight.
  F.useResult = function (s, r) {
    const f = s.flight;
    f.airline = r.al;
    f.number = r.no;
    f.originCode = r.from;
    f.destCode = r.to;
    f.destLabel = F.destLabel(r.to, r.toName);
    f.sched = r.sched;
    f.actual = r.actual || '';
    if (r.gate) f.gate = r.gate;
    if (r.st) f.status = /delay/i.test(r.st) ? 'Delayed' : r.st;
  };
})(window.DFIDS);
