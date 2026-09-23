// United live data, no install needed: a bookmarklet runs inside the user's own united.com Flight Status
// tab, calls the same JSON endpoints that page uses (status, amenities, upgrade/standby lists), and opens
// the control page with the data in the URL hash. Nothing is sent anywhere else.
window.FIDS = window.FIDS || {};

(function (F) {
  // Runs on united.com (serialised into a javascript: bookmark). Keep it self-contained.
  function grabUnited(target) {
    var toast = function (msg) {
      var n = document.createElement('div');
      n.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#0c2340;color:#fff;padding:14px 18px;border-radius:8px;font:15px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:360px';
      n.textContent = msg; document.body.appendChild(n); return n;
    };
    var send = function (key, payload, note) {
      var url = target + '#' + key + '=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
      var w = window.open(url, 'fids-control');
      if (w) { note.textContent = 'Sent to the gate display.'; setTimeout(function () { note.remove(); }, 4000); return; }
      note.textContent = 'Data ready. ';                       // popup blocked: a real click on a link is always allowed
      var a = document.createElement('a');
      a.href = url; a.target = 'fids-control'; a.textContent = 'Send to gate display';
      a.style.cssText = 'color:#8fc1ff;font-weight:bold';
      a.onclick = function () { setTimeout(function () { note.remove(); }, 500); };
      note.appendChild(a);
    };

    var fvGet = function (path) {
      return fetch('https://app-api.flightview.com/api/' + path, { credentials: 'include' }).then(function (r) {
        if (!r.ok) throw new Error(r.status + ' from FlightView');
        return r.json();
      });
    };
    var mapDeps = function (list) {
      return list.map(function (x) {
        return { al: x.airlineCode, no: x.flightNumber, date: x.flightDate, sch: x.scheduledTime, upd: x.updatedTime,
                 gate: x.gate, to: x.airportCode, toName: x.airport, st: x.displayStatus };
      });
    };
    // One leg of one flight on one date: route, times, gate, terminal, aircraft. null if there is no such leg.
    var fvLeg = function (al, no, from, date) {
      return fvGet('flight/' + al + '/' + no + '?departureDate=' + date + '&departureAirport=' + from)
        .then(function (d) { return d && d.flight ? { al: al, no: String(no), f: d.flight } : null; })
        .catch(function () { return null; });
    };
    // A lookup the control page left in this page's hash: answer that instead of reading the page.
    var q = null;
    try {
      var qm = location.hash.match(/(?:^#|&)fidsq=([^&]+)/);
      if (qm) q = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(qm[1])))));
    } catch (e) {}

    if (location.hostname.indexOf('flightview.com') >= 0) {
      if (q) {
        var qNote = toast('Looking up ' + (q.k === 'number' ? q.al + q.no : q.from + '-' + q.to) + ' on ' + q.date + '...');
        var failed = function (e) {
          qNote.textContent = 'Lookup failed: ' + e.message;
          setTimeout(function () { qNote.remove(); }, 8000);
        };
        var found = function (results) {
          results = results.filter(Boolean);
          if (!results.length) return failed(new Error('FlightView has no such flight on ' + q.date + '.'));
          send('lookup', { fetchedAt: new Date().toISOString(), query: q, results: results }, qNote);
        };
        if (q.k === 'number') {
          fvGet('flight/' + q.al + '/' + q.no + '?departureDate=' + q.date)
            .then(function (d) {
              return Promise.all(((d && d.flights) || []).slice(0, 4)
                .filter(function (l) { return l.departureAirportCode; })
                .map(function (l) { return fvLeg(q.al, q.no, l.departureAirportCode, q.date); }));
            })
            .then(function (rs) { found(rs); })
            .catch(failed);
        } else {
          // Every flight on the route that day. The route and the date are the ones that were asked for,
          // so these rows need no second call: they already have all the united.com URL needs.
          fvGet('v2/route/' + q.from + '/' + q.to + '/' + q.date + '?airlineCode=' + q.al)
            .then(function (d) {
              found(((d && d.flights) || []).map(function (x) {
                return { al: x.airlineCode, no: String(x.flightNumber), from: q.from, to: q.to, date: q.date,
                         sch: x.scheduledTime || x.departureTime, upd: x.departureTime, st: x.displayStatus };
              }));
            })
            .catch(failed);
        }
        return;
      }

      // Airport departures page: send every departure with its gate (used for "Next departure").
      var ap = location.pathname.match(/airport\/([A-Za-z]{3})/);
      if (!ap) { alert("Open an airport's Departures page on FlightView, then click this bookmark again."); return; }
      var code = ap[1].toUpperCase(), fvNote = toast('Grabbing ' + code + ' departures for the gate display...');
      fvGet('airport/' + code + '/departures')
        .then(function (list) { send('fv', { airport: code, fetchedAt: new Date().toISOString(), departures: mapDeps(list) }, fvNote); })
        .catch(function (e) { fvNote.textContent = 'Could not grab departures: ' + e.message; });
      return;
    }

    var m = location.pathname.match(/flightstatus\/details\/(\d+)\/(\d{4}-\d{2}-\d{2})\/([A-Za-z]{3})\/([A-Za-z]{3})(?:\/([A-Za-z0-9]{2}))?/);
    if (location.hostname.indexOf('united.com') < 0 || !m) {
      alert("Open a flight on united.com Flight Status (the flight details page), or an airport's departures on FlightView, then click this bookmark again.");
      return;
    }
    var num = m[1], date = m[2], from = m[3].toUpperCase(), to = m[4].toUpperCase(), carrier = (m[5] || 'UA').toUpperCase();
    var note = toast('Grabbing ' + carrier + num + ' for the gate display...');
    (async function () {
      try {
        var tok = await (await fetch('/api/auth/anonymous-token', { credentials: 'include' })).json();
        var t = (tok.data && tok.data.token && (tok.data.token.hash || tok.data.token)) || tok.token;
        var h = { 'x-authorization-api': 'bearer ' + t };
        var get = async function (u) {
          var r = await fetch(u, { credentials: 'include', headers: h });
          if (!r.ok) throw new Error(r.status + ' for ' + u.split('?')[0]);
          return r.json();
        };
        var status = await get('/api/flightstatus/status/' + num + '/' + date + '/' + from + '/' + to + '?carrierCode=' + carrier + '&useLegDestDate=true');
        var seg = ((status.data.flightLegs || [])[0].OperationalFlightSegments || [])[0] || {};
        var eq = seg.Equipment || {};
        var amenities = null, upgrades = null;
        try {
          amenities = await get('/api/flightstatus/amenities/' + num + '/' + date + '/' + from + '/' + to + '?ownerAirlineCode=' + (eq.OwnerAirlineCode || '') +
            '&equipmentCode=' + ((eq.Model && eq.Model.Key) || '') + '&tailNumber=' + (eq.TailNumber || '') + '&shipNumber=' + (eq.PseudoTailNumber || eq.NoseNumber || ''));
        } catch (e) {}
        try { upgrades = await get('/api/flightstatus/upgradeListExtended?flightNumber=' + num + '&flightDate=' + date + '&fromAirportCode=' + from); } catch (e) {}
        send('united', { fetchedAt: new Date().toISOString(), carrier: carrier, from: from, status: status, amenities: amenities, upgrades: upgrades }, note);
      } catch (e) {
        note.textContent = 'Could not grab flight data: ' + e.message;
        setTimeout(function () { note.remove(); }, 8000);
      }
    })();
  }

  // javascript: URL for the bookmark; `target` is this site's control page.
  F.bookmarklet = function (target) {
    return 'javascript:' + encodeURIComponent('(' + grabUnited.toString() + ')(' + JSON.stringify(target) + ')');
  };

  const fromHash = (key) => {
    const m = location.hash.match(new RegExp('(?:^#|&)' + key + '=([^&]+)'));
    if (!m) return null;
    history.replaceState(null, '', location.pathname + location.search);  // keep data out of the address bar
    return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
  };

  // Control page: apply data handed over in "#united=...". Returns the decoded payload, or null.
  F.importUnitedFromHash = function (s) {
    const data = fromHash('united');
    if (data) F.applyUnited(s, data);
    return data;
  };

  // Pick a FlightView departure as the flight to show (then the United bookmark fills in the rest).
  F.useFlightViewDeparture = function (s, dep, airport) {
    const f = s.flight;
    const incoming = { airline: dep.al, number: String(dep.no), sched: dep.date + 'T' + dep.sch, originCode: airport };
    if (F.flightKey(incoming) !== F.flightKey(f)) F.resetFlightData(s);
    f.airline = dep.al;
    f.number = String(dep.no);
    f.originCode = airport;
    f.destCode = dep.to;
    f.destLabel = F.airportLabel(dep.to, dep.toName);
    f.sched = dep.date + 'T' + dep.sch;
    f.est = dep.upd && dep.upd !== dep.sch ? dep.date + 'T' + dep.upd : '';
    f.gate = dep.gate || '';
    f.apiStatus = /delay/i.test(dep.st) ? 'Delayed' : dep.st || '';
    f.lock = false;
  };

  // Control page: "#fv=..." from FlightView. Sets the next departure from this gate; returns { msg, ok }, or null.
  F.importFlightViewFromHash = function (s) {
    const d = fromHash('fv');
    if (!d) return null;
    return F.applyFlightView(s, d);
  };

  // Departures from FlightView: set "next departure from this gate" (and keep them for the picker).
  F.applyFlightView = function (s, d) {
    F.lastFlightView = d;
    const f = s.flight;
    if (d.airport !== (f.originCode || '').toUpperCase()) {
      return { ok: false, picker: true, msg: 'Loaded ' + d.departures.length + ' departures from ' + d.airport +
        '. This flight leaves from ' + (f.originCode || '?') + ', so pick one below to switch.' };
    }
    const deps = d.departures.map((x) => ({ ...x, t: x.date + 'T' + (x.upd || x.sch) }));
    const self = deps.find((x) => x.al === f.airline && String(x.no) === String(f.number));
    if (!f.gate && self && self.gate) f.gate = self.gate;       // FlightView knows our gate too
    if (!f.gate) return { ok: false, msg: 'This flight has no gate yet, so there is no next departure from its gate.' };
    const dep = f.est || f.sched;
    const next = deps.filter((x) => x.al === f.airline && F.sameGate(x.gate, f.gate) && x.t > dep && String(x.no) !== String(f.number))
      .sort((a, b) => a.t.localeCompare(b.t))[0];
    if (!next) return { ok: false, picker: true, msg: 'FlightView lists no later ' + f.airline + ' departure from gate ' + f.gate + ' today.' };
    s.next = { dest: F.airportLabel(next.to, next.toName), flight: next.al + next.no, time: next.t,
               status: /delay/i.test(next.st) ? 'Delayed' : 'On Time' };
    return { ok: true, picker: true, msg: 'Next departure from gate ' + f.gate + ': ' + next.al + next.no + ' to ' + s.next.dest + ' at ' + F.fmtTime(next.t) + ' (FlightView).' };
  };

  // ---- finding a flight when only the date and the flight number, or the date and the route, are known ----
  // united.com's details URL needs number, date, origin and destination, so the missing half is looked up on
  // FlightView first. The page itself can't call FlightView (it only allows its own origin), so the query
  // rides in the hash of a FlightView page and the same bookmark answers it there; the local feed, being on
  // this computer, can answer it directly instead.

  // Where to click the bookmark for a lookup.
  F.lookupUrl = function (q) {
    const path = q.k === 'number' ? '/flight-tracker/' + q.al + '/' + q.no
                                  : '/flight-tracker/by-route-results/' + q.from + '/' + q.to + '/' + q.date + '?airlineCode=' + q.al;
    return 'https://www.flightview.com' + path + '#fidsq=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(q)))));
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // FlightView writes times as "18:30, Sep 22", with no year; `iso` is the same time as a full timestamp,
  // which is the actual departure once a flight has gone, so only its date is trusted here.
  function fvWhen(text, iso) {
    const m = /^(\d{1,2}):(\d{2})(?:,\s*([A-Za-z]{3})\s+(\d{1,2}))?/.exec(text || '');
    if (!m) return (iso || '').slice(0, 16);
    const clock = String(+m[1]).padStart(2, '0') + ':' + m[2];
    const ref = (iso || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!m[3]) return ref + 'T' + clock;
    const month = MONTHS.indexOf(m[3]), refMonth = +ref.slice(5, 7) - 1;
    let year = +ref.slice(0, 4);
    if (refMonth === 11 && month === 0) year++;              // a leg that runs past New Year
    if (refMonth === 0 && month === 11) year--;
    return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(+m[4]).padStart(2, '0') + 'T' + clock;
  }

  // One FlightView result -> the fields the control page shows and the united.com link needs. A route search
  // already answers in the route and on the date that were asked for; a flight number needs its legs read.
  F.lookupResult = function (r) {
    if (!r.f) {
      const at = (t) => {                                    // "6:00, Sep 24" on the date that was asked for
        const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
        return m ? r.date + 'T' + String(+m[1]).padStart(2, '0') + ':' + m[2] : '';
      };
      const sched = at(r.sch), est = at(r.upd);
      return { al: r.al, no: String(r.no), from: r.from, fromName: '', to: r.to, toName: '',
               sched: sched, est: est && est !== sched ? est : '', arr: '',
               gate: '', terminal: '', aircraft: '', st: r.st || '' };
    }
    const d = r.f.departure || {}, a = r.f.arrival || {};
    const sched = fvWhen(d.scheduledTime, d.departureDateTime);
    const est = fvWhen(d.estimatedTime || d.outGateTime || d.offGroundTime, d.departureDateTime);
    return {
      al: r.al, no: String(r.no),
      from: d.airportCode || '', fromName: d.airportCity || d.airport || '',
      to: a.airportCode || '', toName: a.airportCity || a.airport || '',
      sched: sched, est: est && est !== sched ? est : '',
      arr: fvWhen(a.estimatedTime || a.scheduledTime, a.arrivalDateTime),
      gate: d.gate || '', terminal: d.terminal || '',
      aircraft: (r.f.aircraft && r.f.aircraft.name) || '', st: r.f.flightStatus || '',
    };
  };

  // Control page: "#lookup=..." from the bookmark. Keeps the results for the picker; returns them, or null.
  F.importLookupFromHash = function (s) {
    const d = fromHash('lookup');
    if (!d) return null;
    F.lastLookup = { query: d.query, fetchedAt: d.fetchedAt, results: (d.results || []).map(F.lookupResult) };
    return F.lastLookup;
  };

  // Show a looked-up flight: enough to build the united.com link, which then fills in everything else.
  F.useLookupResult = function (s, r) {
    const f = s.flight;
    const incoming = { airline: r.al, number: r.no, sched: r.sched, originCode: r.from };
    if (F.flightKey(incoming) !== F.flightKey(f)) F.resetFlightData(s);
    f.airline = r.al;
    f.number = r.no;
    f.originCode = r.from;
    f.destCode = r.to;
    f.destLabel = F.airportLabel(r.to, r.toName);
    f.sched = r.sched;
    f.est = r.est;
    f.arr = r.arr;
    if (r.gate) f.gate = r.gate;
    if (r.terminal) f.terminal = r.terminal;
    if (r.aircraft) f.aircraft = r.aircraft;
    f.apiStatus = r.st;
    f.lock = false;
  };

  const hhmm = (t) => (t || '').slice(0, 16);                          // "2026-09-22T10:59:00" -> local wall clock
  const minsBetween = (a, b) => Math.round((Date.parse(a + ':00Z') - Date.parse(b + ':00Z')) / 60000);
  const name = (p) => (p.lastName + ', ' + p.firstName + '.').toUpperCase();

  function pickSegment(status, from) {
    const legs = (status && status.data && status.data.flightLegs) || [];
    for (const leg of legs) {
      for (const seg of leg.OperationalFlightSegments || []) {
        if (!from || (seg.DepartureAirport && (seg.DepartureAirport.IATACode || seg.DepartureAirport) === from)) return seg;
      }
    }
    return legs[0] && legs[0].OperationalFlightSegments && legs[0].OperationalFlightSegments[0];
  }
  const code = (a) => (a && (a.IATACode || a.Code)) || (typeof a === 'string' ? a : '');
  // "Halifax, NS, CA (YHZ)" -> "Halifax, NS (YHZ)"; known codes use our gate-screen names.
  const label = (a) => {
    const c = code(a);
    if (F.AIRPORTS[c]) return F.airportLabel(c);
    const n = (a && a.Name) || '';
    return n.replace(/,\s*[A-Z]{2,3}\s*(\([A-Z]{3}\))$/, ' $1') || c;
  };

  F.applyUnited = function (s, d) {
    const f = s.flight, x = { updated: d.fetchedAt || new Date().toISOString() };
    const seg = pickSegment(d.status, d.from || f.originCode);
    if (seg) {
      const incoming = { airline: d.carrier || f.airline, number: seg.FlightNumber, sched: hhmm(seg.DepartureDateTime), originCode: code(seg.DepartureAirport) };
      if (F.flightKey(incoming) !== F.flightKey(f)) F.resetFlightData(s);
    }
    if (d.carrier) f.airline = d.carrier;

    // ---- times, gate, status ----
    if (seg) {
      const sched = hhmm(seg.DepartureDateTime);
      const delay = +seg.EstimatedDepartureDelayMinutes || 0;
      const statuses = seg.FlightStatuses || [];
      const byType = (t) => (statuses.find((st) => st.StatusType === t) || {}).Description || '';
      const leg = byType('LegStatus'), dep = byType('DepartureStatus');
      const all = statuses.map((st) => st.Description).join(' ');

      if (seg.FlightNumber) f.number = String(seg.FlightNumber);
      if (code(seg.DepartureAirport)) f.originCode = code(seg.DepartureAirport);
      f.sched = sched;
      f.est = delay > 0 ? hhmm(seg.EstimatedDepartureTime) : '';
      f.arr = hhmm(seg.EstimatedArrivalTime) || hhmm(seg.ArrivalDateTime);
      if (seg.DepartureGate) f.gate = seg.DepartureGate;
      if (seg.DepartureTerminal) f.terminal = seg.DepartureTerminal;
      if (seg.DepartureUTCDateTime) f.utcOffsetMin = minsBetween(sched, hhmm(seg.DepartureUTCDateTime));
      const dest = code(seg.ArrivalAirport);
      if (dest) { f.destCode = dest; f.destLabel = label(seg.ArrivalAirport); }
      x.originLabel = label(seg.DepartureAirport);
      const eq = seg.Equipment || {};
      if (eq.Model && eq.Model.Description) f.aircraft = eq.Model.Description;
      if (eq.TailNumber) f.tail = eq.TailNumber;
      // United's own boarding time sets how early boarding starts.
      if (seg.BoardTime) {
        const lead = minsBetween(sched, sched.slice(0, 11) + seg.BoardTime.slice(0, 5));
        if (lead > 0 && lead < 120) s.boarding.leadMin = lead;
      }
      f.apiStatus = /cancel/i.test(all) ? 'Canceled'
        : /^(departed|in flight|arrived|landed)/i.test(leg) ? 'Departed'
        : dep || leg;
      x.delayMin = delay;
      x.reason = (statuses.find((st) => st.StatusType === 'FlightStatus') || {}).Description || '';
      x.arrSched = hhmm(seg.ArrivalDateTime);
      x.arrGate = seg.ArrivalGate || '';
      x.arrTerminal = seg.ArrivalTerminal || '';
      x.baggage = seg.BaggageClaim || '';
      x.arrDelayMin = +seg.EstimatedArrivalDelayMinutes || 0;
      x.international = /true/i.test(seg.IsInternational);
      x.delayCause = ((seg.ReasonStatuses || []).find((r) => r.IsDelayEffective) || {}).CustomerFacingDescription || '';
      const sched0 = (((d.status.data.flightLegs || [])[0] || {}).ScheduledFlightSegments || [])[0] || {};
      // Save the reason: "Late aircraft", else the detail in "Estimated Departure 51 Minutes Late (Awaiting aircraft)".
      const detail = (x.reason.match(/\(([^)]+)\)/) || [])[1] || '';
      f.delayReason = delay > 0 ? (x.delayCause || detail) : '';
      x.codeshares = (sched0.MarketedFlightSegment || []).map((m) => m.MarketingAirlineCode + m.FlightNumber);
      x.arrStatus = byType('ArrivalStatus');
      x.depStatus = dep;
      x.operator = (seg.OperatingAirline && (seg.OperatingAirline.Name || seg.OperatingAirline.IATACode)) || '';
      const ib = seg.InboundFlightSegment;
      if (ib && ib.FlightNumber) {
        x.inbound = { flight: (ib.CarrierCode || '') + ib.FlightNumber, from: ib.DepartureAirport, fromName: ib.DepartureAirportName,
                      dep: hhmm(ib.DepartureDate), arr: hhmm(ib.ArrivalDate) };
      }
      const wx = (d.status.data.currentWeather || []).find((w) => w.AirportCode === f.destCode);
      if (wx) x.weather = { tempF: wx.Temperature && wx.Temperature.Farenheit, tempC: wx.Temperature && wx.Temperature.Celsius, cond: wx.WeatherCondition };
    }

    // ---- amenities ----
    const am = Array.isArray(d.amenities) ? d.amenities[0] : null;
    let cabinNames = [];
    if (am) {
      const list = am.Amenities || [];
      const val = (n) => list.filter((a) => a.Name === n).map((a) => [].concat(a.Value || []).join(' ')).join(' ');
      const ent = val('Entertainment');
      const power = val('InseatPower');
      const rows = power.match(/rows?\s+(\d+)\s+(?:through|to|-)\s+(\d+)/i);
      const econMeal = list.filter((a) => a.Name === 'Meal').pop();
      s.amenities = {
        wifi: /yes/i.test(val('Wifi')) ? (/wi-?fi[^.]*free/i.test(ent) && !/purchase/i.test(ent) ? '(Free)' : '($)') : '',
        power: rows ? 'Rows ' + rows[1] + '-' + rows[2] : /every|all/i.test(power) ? 'All rows' : power ? 'Available' : '',
        entertainment: /yes/i.test(val('AVOD')) || /yes/i.test(val('Streaming')) || /entertainment is offered/i.test(ent),
        food: (() => {
          const txt = econMeal ? econMeal.Description + ' ' + [].concat(econMeal.Value || []).join(' ') : '';
          if (!txt || /not offered|no meal/i.test(txt)) return '';     // "Meals are not offered for this flight"
          return /purchase/i.test(txt) ? '($)' : '(Free)';
        })(),
        beverages: list.some((a) => a.Name === 'Beverages'),
      };
      cabinNames = list.filter((a) => a.Name === 'Seating' && a.Cabin).map((a) => a.Cabin);
      const eqd = am.Equipment || {};
      // Widebodies often have no Seating entries, but the capacity line always names the cabins, front to back:
      // "64 United Polaris® business, 35 United Premium Plus®, 123 United Economy®"
      const capLine = (eqd.Cabins && eqd.Cabins[0] && eqd.Cabins[0].Description) || '';
      if (!cabinNames.length && capLine) cabinNames = capLine.split(',').map((c) => c.replace(/^\s*\d+\s*/, '').trim()).filter(Boolean);
      x.aircraftInfo = {
        model: eqd.Model && eqd.Model.Description, cabins: eqd.Cabins && eqd.Cabins[0] && eqd.Cabins[0].Description,
        cruise: eqd.CruiseSpeed, wingspan: eqd.Wingspan,
      };
      x.amenityText = list.filter((a) => a.Value).map((a) => ({ name: a.Name, cabin: a.Cabin || (a.Type && a.Type.Description) || '', text: [].concat(a.Value).join(' ') }));
    }

    // ---- per-cabin details in the status response: always present, names every cabin front to back ----
    const eqs = (seg && seg.Equipment) || {};
    const lca = eqs.ListOfCabinsAmenities || [];
    if (lca.length) {
      cabinNames = lca.map((c) => c.CabinHeader).filter(Boolean);        // "United Polaris® business", ...
      const val = (c, n) => ((c.Amenities || []).find((a) => a.Name === n) || {}).Value || '';
      const offered = (v) => !!v && !/not offered|not available/i.test(v);
      const econ = lca[lca.length - 1];
      const a = s.amenities;
      if (!am) {                                                          // amenities call failed: fill in from here
        a.power = offered(val(econ, 'InseatPower')) ? 'All rows'
          : lca.some((c) => offered(val(c, 'InseatPower'))) ? (lca[0].CabinHeader || 'Front cabin') : '';
        a.entertainment = lca.some((c) => /entertainment/i.test(val(c, 'Entertainment')));
        a.beverages = true;
      }
      // Seatback / personal-device entertainment is listed per cabin even when AVOD and Streaming say "No".
      a.entertainment = a.entertainment || lca.some((c) => offered(val(c, 'Entertainment')));
      // United's overall text sometimes says "all rows" while the cabins say economy has none: trust the cabins.
      if (!offered(val(econ, 'InseatPower'))) {
        const withPower = lca.find((c) => offered(val(c, 'InseatPower')));
        a.power = !withPower ? '' : /^rows/i.test(a.power) ? a.power : withPower.CabinHeader.replace(/[®℠]/g, '');
      }
      const wifi = lca.map((c) => val(c, 'WiFi')).filter(offered);
      a.wifi = wifi.length ? (wifi.some((w) => /free/i.test(w)) ? '(Free)' : '($)') : '';
      x.wifiText = val(econ, 'WiFi') || val(lca[0], 'WiFi');             // "Internet by Starlink, free for MileagePlus® members"
      x.cabinAmenities = lca.map((c) => ({
        cabin: c.CabinHeader,
        items: (c.Amenities || []).filter((i) => i.Name !== 'Aircraft specs').map((i) => ({ name: i.Name, text: i.Value })),
      }));
    }
    x.wifiProvider = (eqs.Amenities && eqs.Amenities.WifiPrvdr) || '';   // "Starlink", "Panasonic", ...
    s.amenities.wifiProvider = x.wifiProvider;

    // ---- upgrade / standby lists with capacity ----
    const up = d.upgrades;
    if (up && up.pbts) {
      const order = ['Front', 'Middle', 'Rear'];
      const pbts = order.map((c) => up.pbts.find((p) => p.cabin === c)).filter(Boolean);
      const cabinName = (c) => {
        const i = pbts.findIndex((p) => p.cabin === c);
        if (cabinNames[i]) return cabinNames[i];
        // United's data often leaves widebody cabins unnamed: use United's branding rules.
        const threeCabin = pbts.some((p) => p.cabin === 'Middle');
        const front = x.international ? (threeCabin ? 'United Polaris® business' : 'United Business®') : 'United First®';
        return { Front: front, Middle: 'United Premium Plus℠', Rear: 'United Economy®' }[c];
      };
      const front = up.pbts.find((p) => p.cabin === 'Front') || {};
      const ciFront = (up.checkInSummaries || []).find((c) => c.cabin === 'Front') || {};
      const full = (p) => p.booked >= (p.authorized || p.capacity);
      const people = (sec) => [
        ...((sec && sec.cleared) || []).map((p) => ({ name: name(p), ci: !!p.isCheckedIn, seat: p.seatNumber || '--' })),
        ...((sec && sec.standby) || []).map((p) => ({ name: name(p), ci: !!p.isCheckedIn, seat: '' })),
      ];
      s.upgrades = {
        cabin: cabinName('Front'),
        capacity: front.capacity != null ? front.capacity : '',
        booked: front.booked != null ? (full(front) ? 'Full' : front.booked) : '',
        checkedIn: ciFront.total != null ? ciFront.total : '',
        list: people(up.front),
      };
      s.standby = {
        cabins: pbts.map((p) => cabinName(p.cabin) + ' = ' + (full(p) ? 'Full' : 'Available')).join('\n'),
        list: [...people(up.middle), ...people(up.rear)],
      };
    }

    s.united = { ...s.united, ...x, error: '' };
  };
})(window.FIDS);
