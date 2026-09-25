(function (F) {
  const $ = (id) => document.getElementById(id);
  let state = F.load();

  function getPath(p) { return p.split('.').reduce((o, k) => o[k], state); }
  function setPath(p, v) {
    const ks = p.split('.'), last = ks.pop();
    ks.reduce((o, k) => o[k], state)[last] = v;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function commit() { F.save(state); }

  function fillForm() {
    document.querySelectorAll('[data-path]').forEach((el) => {
      const v = getPath(el.dataset.path);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el) el.value = v == null ? '' : v;
    });
    renderStatus();
    renderLookup();
    updateFvLink();
  }

  document.querySelectorAll('[data-path]').forEach((el) => {
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      setPath(el.dataset.path, v);
      commit();
      if (el.type === 'checkbox') fillForm(); else renderStatus();
    });
  });

  // ---- status ----
  function renderStatus() {
    const d = F.derive(state), auto = state.display.autoStatus;
    $('statusBtns').innerHTML = F.STATUSES.map((s) =>
      '<button data-st="' + esc(s) + '" class="' + (!auto && state.flight.status === s ? 'current' : '') + '"' +
      (auto ? ' disabled' : '') + '>' + esc(s) + '</button>').join('');
    $('statusNow').textContent = auto
      ? 'The screen reads "' + d.status + '" right now, with ' + d.labels.join(' / ') + '.'
      : 'Held at "' + state.flight.status + '", with ' + d.labels.join(' / ') + '.';
  }
  $('statusBtns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b || state.display.autoStatus) return;
    state.flight.status = b.dataset.st;
    commit(); fillForm();
  });

  // ---- find a flight ----
  function lookupMsg(t, err) { $('lkMsg').textContent = t; $('lkMsg').className = 'msg' + (err ? ' err' : ''); }
  function lookupQuery() {
    const k = document.querySelector('[name=lookupBy]:checked').value;
    const q = { k, date: $('lkDate').value, al: ($('lkAirline').value.trim() || 'DL').toUpperCase() };
    if (k === 'number') q.no = $('lkNumber').value.replace(/\D/g, '');
    else { q.from = $('lkFrom').value.trim().toUpperCase(); q.to = $('lkTo').value.trim().toUpperCase(); }
    return q;
  }
  function lookupProblem(q) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) return 'Pick a date.';
    if (q.k === 'number') return q.no ? '' : 'Give a flight number.';
    return /^[A-Z]{3}$/.test(q.from) && /^[A-Z]{3}$/.test(q.to) ? '' : 'Give 3-letter from and to codes.';
  }
  function renderLookup() {
    const d = F.lastLookup;
    $('lkList').hidden = !d || !d.results.length;
    if (!d) return;
    $('lkList').innerHTML = '<table><thead><tr><th>Flight</th><th>From</th><th>To</th><th>Departs</th><th>Gate</th><th>Status</th><th></th></tr></thead><tbody>' +
      d.results.map((r, i) => '<tr><td>' + esc(r.al + r.no) + '</td><td>' + esc(r.from) + '</td><td>' + esc(r.to) +
        '</td><td>' + esc(r.sched.slice(0, 10)) + ' ' + F.fmtTime(r.sched, state.display.clock24) +
        '</td><td>' + esc(r.gate || '--') + '</td><td>' + esc(r.st) +
        '</td><td><button data-lk="' + i + '">Use</button></td></tr>').join('') + '</tbody></table>';
  }
  $('lkList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lk]');
    if (!b || !F.lastLookup) return;
    const r = F.lastLookup.results[+b.dataset.lk];
    F.useResult(state, r);
    commit(); fillForm();
    lookupMsg('Showing ' + r.al + r.no + ' to ' + state.flight.destLabel + '.');
  });
  $('lkBtn').onclick = () => {
    const q = lookupQuery(), bad = lookupProblem(q);
    if (bad) return lookupMsg(bad, true);
    const url = F.lookupUrl(q), what = q.k === 'number' ? q.al + q.no : q.from + '-' + q.to;
    if (window.open(url, 'dfids-lookup')) {
      return lookupMsg('FlightView is open in another tab: click the bookmark there and the results come back here.');
    }
    lookupMsg('Open ');
    const a = document.createElement('a');
    a.href = url; a.target = 'dfids-lookup'; a.rel = 'noopener'; a.textContent = what + ' on FlightView';
    $('lkMsg').append(a, ' and click the bookmark there.');
  };
  function showLookupFields() {
    const k = document.querySelector('[name=lookupBy]:checked').value;
    document.querySelectorAll('[data-lookup]').forEach((el) => { el.hidden = el.dataset.lookup !== k; });
  }
  document.querySelectorAll('[name=lookupBy]').forEach((el) => el.addEventListener('change', showLookupFields));

  function updateFvLink() {
    const ap = (state.flight.originCode || '').toUpperCase(), a = $('fvLink');
    a.href = ap.length === 3 ? 'https://www.flightview.com/airport/' + ap + '/departures' : 'https://www.flightview.com/';
    a.textContent = ap.length === 3 ? ap + ' departures on FlightView' : 'departures on FlightView';
  }

  // ---- the ribbon, from the departures board ----
  function fvData() {
    if (F.lastFv) return F.lastFv;
    try { return JSON.parse(sessionStorage.getItem('dfids.fv') || 'null'); } catch (e) { return null; }
  }
  $('nextFromLookup').onclick = () => {
    const d = fvData(), f = state.flight;
    const el = $('nextMsg');
    if (!d) { el.textContent = 'Open the airport’s departures on FlightView and click the bookmark first.'; return; }
    if (d.airport !== (f.originCode || '').toUpperCase()) {
      el.textContent = 'Those departures are from ' + d.airport + ', but this flight leaves ' + f.originCode + '.'; return;
    }
    const gate = (f.gate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!gate) { el.textContent = 'Set the gate first, so there is something to match.'; return; }
    const dep = f.actual || f.sched;
    const next = d.departures
      .map((x) => ({ ...x, t: x.date + 'T' + (x.upd || x.sch) }))
      .filter((x) => (x.gate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === gate && x.t > dep && String(x.no) !== String(f.number))
      .sort((a, b) => a.t.localeCompare(b.t))[0];
    if (!next) { el.textContent = 'No later departure from gate ' + f.gate + ' on the board.'; return; }
    state.next.text = 'Next flight departing this gate is ' + next.al + next.no + ' to ' + F.destLabel(next.to, next.toName);
    commit(); fillForm();
    el.textContent = 'Set from ' + next.al + next.no + '.';
  };

  // ---- bookmarklet + imports ----
  const bm = $('bookmarklet');
  bm.href = F.bookmarklet(location.origin + location.pathname);
  bm.addEventListener('click', (e) => { e.preventDefault(); alert('Drag this to your bookmarks bar, then click it on FlightView.'); });

  function runImports() {
    try {
      const lk = F.importFromHash('lookup');
      if (lk) {
        F.lastLookup = { query: lk.query, results: (lk.results || []).map(F.lookupResult) };
        fillForm();
        lookupMsg(F.lastLookup.results.length + ' found. Pick one below.');
      }
      const fv = F.importFromHash('fv');
      if (fv) {
        F.lastFv = fv;
        try { sessionStorage.setItem('dfids.fv', JSON.stringify(fv)); } catch (err) {}
        $('nextMsg').textContent = 'Loaded ' + fv.departures.length + ' departures from ' + fv.airport + '.';
      }
    } catch (e) {
      lookupMsg('Could not read the imported data: ' + e.message, true);
    }
  }
  addEventListener('hashchange', runImports);

  // ---- top bar ----
  $('openDisplay').onclick = () => window.open('display.html', 'dfids-display');
  $('copyLink').onclick = async () => {
    const url = new URL('display.html', location.href);
    url.hash = 's=' + encodeURIComponent(F.encodeState(state));
    try { await navigator.clipboard.writeText(url.href); alert('Link copied: a snapshot of the screen as it is now.'); }
    catch (e) { prompt('Copy this link:', url.href); }
  };
  $('reset').onclick = () => {
    if (!confirm('Reset to the demo flight?')) return;
    state = F.defaultState(); F.lastLookup = null;
    commit(); fillForm(); lookupMsg('');
  };

  F.onChange((s) => { state = s; fillForm(); });
  $('lkDate').value = F.airportNow(state.flight.utcOffsetMin).toISOString().slice(0, 10);
  $('lkAirline').value = state.flight.airline || 'DL';
  showLookupFields();
  runImports();
  fillForm();
  setInterval(renderStatus, 5000);
  F.watchForUpdates();
})(window.DFIDS);
