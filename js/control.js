(function (F) {
  const $ = (id) => document.getElementById(id);
  let state = F.load();

  // ---- generic binding: <input data-path="a.b"> <-> state.a.b ----
  function getPath(p) { return p.split('.').reduce((o, k) => o[k], state); }
  function setPath(p, v) {
    const ks = p.split('.'), last = ks.pop();
    ks.reduce((o, k) => o[k], state)[last] = v;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function fillForm() {
    document.querySelectorAll('[data-path]').forEach((el) => {
      const v = getPath(el.dataset.path);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = el.value === v;
      else if (document.activeElement !== el) el.value = v == null ? '' : v;
    });
    document.querySelectorAll('[data-feed]').forEach((el) => { el.hidden = el.dataset.feed !== state.feed.follow; });
    $('updated').textContent = state.flight.updated
      ? 'Last fetched ' + new Date(state.flight.updated).toLocaleTimeString() : '';
    renderBoarding();
    listEditors.forEach((ed) => ed.render());
    updateUnitedLink();
    updateFlightViewLink();
    renderLookup();
  }

  // Deep link to the flight's united.com details page, built from Flight details.
  function updateUnitedLink() {
    const f = state.flight, a = $('uaLink');
    const num = String(f.number || '').replace(/\D/g, ''), date = (f.sched || '').slice(0, 10);
    const from = (f.originCode || '').toUpperCase(), to = (f.destCode || '').toUpperCase();
    const ok = num && date && from.length === 3 && to.length === 3;
    a.href = ok ? 'https://www.united.com/en/us/flightstatus/details/' + num + '/' + date + '/' + from + '/' + to + '/' + (f.airline || 'UA').toUpperCase()
                : 'https://www.united.com/en/us/flightstatus';
    a.textContent = ok ? (f.airline || 'UA') + num + ' ' + from + '–' + to + ' on ' + date + ' on united.com' : 'United Flight Status';
    $('uaLinkNote').textContent = ok ? ' — this flight, ready for the bookmark.'
      : ' and find your flight: it searches by route or by flight number.';
  }

  function commit() { F.save(state); }

  document.querySelectorAll('[data-path]').forEach((el) => {
    const ev = el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
      else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
      else v = el.value;
      setPath(el.dataset.path, v);
      commit();
      if (el.dataset.path.startsWith('flight.')) updateUnitedLink();
      if (el.type === 'radio' || el.tagName === 'SELECT') fillForm();
    });
  });

  // Typing a destination code fills in the display name when we know it.
  $('destCode').addEventListener('change', () => {
    const code = state.flight.destCode.toUpperCase();
    state.flight.destCode = code;
    if (F.AIRPORTS[code]) state.flight.destLabel = F.airportLabel(code);
    commit(); fillForm();
  });

  // ---- boarding ----
  $('pillSel').innerHTML = Object.entries(F.PILLS)
    .map(([k, v]) => '<option value="' + k + '">' + (k === 'auto' ? 'Auto (delay from data)' : v) + '</option>').join('');

  function renderBoarding() {
    const d = F.derive(state), b = state.boarding;
    $('phaseBtns').innerHTML = Object.entries(F.PHASES).filter(([k]) => k !== 'boarding').map(([k, v]) =>
      '<button data-phase="' + k + '" class="' + (b.phase === k ? 'current' : '') + '">' + v +
      (k === 'auto' && b.phase === 'auto' ? ' <small>(now: ' + F.PHASES[d.phase] + ')</small>' : '') + '</button>').join('');
    $('groupBtns').innerHTML = F.GROUPS.map((g, i) => {
      const cls = d.phase === 'boarding' ? (i < d.group ? 'done' : i === d.group ? 'current' : '') : '';
      return '<button data-g="' + i + '" class="' + cls + '">' + g + '</button>';
    }).join('');
  }
  $('phaseBtns').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-phase]');
    if (!btn) return;
    state.boarding.phase = btn.dataset.phase;
    commit(); fillForm();
  });
  $('groupBtns').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-g]');
    if (btn) setGroup(+btn.dataset.g);
  });
  function setGroup(i) {
    const b = state.boarding;
    if (i > F.LAST_GROUP) { b.phase = 'final'; }
    else { b.phase = 'boarding'; b.group = Math.max(0, i); }
    commit(); fillForm();
  }
  const curGroup = () => { const d = F.derive(state); return d.phase === 'boarding' ? d.group : -1; };
  $('prevGroup').onclick = () => setGroup(curGroup() - 1);
  $('nextGroup').onclick = () => setGroup(curGroup() + 1);

  document.querySelectorAll('[data-delay]').forEach((b) => b.addEventListener('click', () => {
    const m = +b.dataset.delay;
    state.flight.est = m ? F.shiftLocal(state.flight.sched, m) : '';
    state.flight.lock = true;
    commit(); fillForm();
  }));

  // ---- upgrade / standby list editors ----
  function ListEditor(el, getList) {
    this.render = function () {
      if (el.contains(document.activeElement)) return;  // don't clobber typing
      const list = getList();
      el.innerHTML =
        '<table><thead><tr><th></th><th>Name</th><th>Checked in</th><th>Seat (= cleared)</th><th></th></tr></thead><tbody>' +
        list.map((p, i) => '<tr data-i="' + i + '"><td class="muted">' + (i + 1) + '</td>' +
          '<td><input data-f="name" value="' + esc(p.name) + '"></td>' +
          '<td><input type="checkbox" data-f="ci"' + (p.ci ? ' checked' : '') + '></td>' +
          '<td><input data-f="seat" class="tiny" value="' + esc(p.seat) + '" placeholder="--"></td>' +
          '<td class="act"><button data-a="up" title="Move up">&uarr;</button><button data-a="down" title="Move down">&darr;</button>' +
          '<button data-a="del" title="Remove">&times;</button></td></tr>').join('') +
        '</tbody></table>' +
        '<div class="row"><textarea rows="2" placeholder="Add names, one per line: SMITH, J.   (add a seat to mark cleared: SMITH, J. 3A)"></textarea>' +
        '<button data-a="add">Add</button><button data-a="clear" class="danger">Clear list</button></div>';
    };
    el.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-i]'), f = e.target.dataset.f;
      if (!tr || !f) return;
      const p = getList()[+tr.dataset.i];
      p[f] = f === 'ci' ? e.target.checked : f === 'seat' ? e.target.value.toUpperCase() : e.target.value.toUpperCase();
      commit();
    });
    el.addEventListener('focusout', () => setTimeout(() => this.render(), 0));
    el.addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      const list = getList();
      const tr = e.target.closest('tr[data-i]'), i = tr ? +tr.dataset.i : -1;
      if (a === 'up' && i > 0) list.splice(i - 1, 0, list.splice(i, 1)[0]);
      if (a === 'down' && i < list.length - 1) list.splice(i + 1, 0, list.splice(i, 1)[0]);
      if (a === 'del') list.splice(i, 1);
      if (a === 'add') { const ta = el.querySelector('textarea'); list.push(...F.parseNames(ta.value)); ta.value = ''; }
      if (a === 'clear' && confirm('Remove everyone from this list?')) list.length = 0;
      commit();
      document.activeElement.blur();
      this.render();
    });
  }
  const listEditors = [
    new ListEditor($('upgradeEd'), () => state.upgrades.list),
    new ListEditor($('standbyEd'), () => state.standby.list),
  ];

  // Next departure from this gate, from the FlightView departures the bookmark (or the feed) brought in.
  function lookupNextDeparture() {
    const el = $('nextMsg'), d = fvData();
    if (!d) {
      el.textContent = 'Open your airport\'s departures on FlightView and click the bookmark to fill this in.';
      el.className = 'msg';
      return;
    }
    const r = F.applyFlightView(state, d);
    el.textContent = r.msg;
    el.className = 'msg' + (r.ok ? '' : ' err');
    commit(); fillForm();
  }
  $('nextBtn').onclick = lookupNextDeparture;

  // ---- optional local feed (server/gate_feed.py) ----
  function feedMsg(t, err) { $('feedMsg').textContent = t; $('feedMsg').className = 'msg' + (err ? ' err' : ''); }
  async function feedOnce() {
    feedMsg('Fetching from the local feed...');
    try { feedMsg(await F.refreshFeed(state)); commit(); fillForm(); renderPicker(); }
    catch (e) { feedMsg(e.message, true); }
  }
  $('feedBtn').onclick = feedOnce;
  $('icsUrl').value = F.getIcs();
  $('feedApply').onclick = async () => {
    const f = state.feed, cal = f.follow === 'calendar';
    if (cal) F.setIcs($('icsUrl').value.trim());
    feedMsg('Sending to the feed...');
    try {
      const c = await F.configureFeed(state, cal ? { ics: F.getIcs() } : { airport: f.airport, gate: f.gate });
      if (!f.enabled) { f.enabled = true; commit(); fillForm(); }
      feedMsg('The feed now follows ' + F.describeFeed(c) + '. The first update takes about a minute.');
    } catch (e) { feedMsg(e.message, true); }
  };
  F.startFeedPolling(() => state, (m) => { feedMsg(m); commit(); fillForm(); renderPicker(); }, (m) => feedMsg(m, true));

  // Link to this airport's departures on FlightView, where the bookmark reads the gate list.
  function updateFlightViewLink() {
    const ap = (state.flight.originCode || '').toUpperCase(), a = $('fvLink');
    a.href = ap.length === 3 ? 'https://www.flightview.com/airport/' + ap + '/departures' : 'https://www.flightview.com/';
    a.textContent = ap.length === 3 ? ap + ' departures on FlightView' : 'departures on FlightView';
  }

  // ---- FlightView departure picker (comes from the bookmark on FlightView, or from the local feed) ----
  function fvData() {
    if (F.lastFlightView) return F.lastFlightView;
    try { return JSON.parse(sessionStorage.getItem('fids.fv') || 'null'); } catch (e) { return null; }
  }
  function renderPicker() {
    const d = fvData();
    $('fvPick').hidden = !d;
    if (!d) return;
    const q = $('fvFilter').value.trim().toUpperCase();
    const mine = $('fvMine').checked, air = (state.flight.airline || 'UA').toUpperCase();
    const now = F.airportNow(state.flight.utcOffsetMin).toISOString().slice(11, 16);
    const rows = d.departures
      .map((x, i) => ({ ...x, i }))
      .filter((x) => (!mine || x.al === air) && (!q || [x.al + x.no, x.gate, x.to, x.toName].join(' ').toUpperCase().includes(q)))
      .sort((a, b) => (a.upd || a.sch).localeCompare(b.upd || b.sch));
    $('fvPickTitle').textContent = d.airport + ' departures (FlightView)';
    $('fvList').innerHTML = '<table><thead><tr><th>Flight</th><th>To</th><th>Gate</th><th>Departs</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map((x) => '<tr class="' + ((x.upd || x.sch) < now ? 'past' : '') + '"><td>' + esc(x.al + x.no) + '</td><td>' + esc(x.toName || x.to) +
        ' (' + esc(x.to) + ')</td><td>' + esc(x.gate || '--') + '</td><td>' + F.fmtTime(x.date + 'T' + (x.upd || x.sch), state.display.clock24) +
        '</td><td>' + esc(x.st || '') + '</td><td><button data-fv="' + x.i + '">Use</button></td></tr>').join('') +
      '</tbody></table>';
  }
  $('fvFilter').addEventListener('input', renderPicker);
  $('fvMine').addEventListener('change', renderPicker);
  $('fvList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fv]');
    const d = fvData();
    if (!b || !d) return;
    const dep = d.departures[+b.dataset.fv];
    F.useFlightViewDeparture(state, dep, d.airport);
    commit(); fillForm(); renderPicker();
    unitedMsg('Showing ' + dep.al + dep.no + ' to ' + state.flight.destLabel + (dep.gate ? ' from gate ' + dep.gate : '') +
      '. Open the united.com link above and click the bookmark there for times, amenities and the lists.');
  });

  // ---- find a flight: fills in the route the united.com link needs (see F.lookupUrl) ----
  function lookupMsg(t, err) { $('lkMsg').textContent = t; $('lkMsg').className = 'msg' + (err ? ' err' : ''); }

  function lookupQuery() {
    const k = document.querySelector('[name=lookupBy]:checked').value;
    const q = { k: k, date: $('lkDate').value, al: ($('lkAirline').value.trim() || 'UA').toUpperCase() };
    if (k === 'number') q.no = $('lkNumber').value.replace(/\D/g, '');
    else { q.from = $('lkFrom').value.trim().toUpperCase(); q.to = $('lkTo').value.trim().toUpperCase(); }
    return q;
  }
  function lookupProblem(q) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) return 'Pick a date.';
    if (!/^[A-Z0-9]{2}$/.test(q.al)) return 'Give a 2-letter airline code.';
    if (q.k === 'number') return q.no ? '' : 'Give a flight number.';
    return /^[A-Z]{3}$/.test(q.from) && /^[A-Z]{3}$/.test(q.to) ? '' : 'Give 3-letter from and to airport codes.';
  }

  function renderLookup() {
    const d = F.lastLookup;
    $('lkList').hidden = !d || !d.results.length;
    if (!d) return;
    $('lkList').innerHTML = '<table><thead><tr><th>Flight</th><th>From</th><th>To</th><th>Departs</th><th>Gate</th>' +
      '<th>Aircraft</th><th>Status</th><th></th></tr></thead><tbody>' +
      d.results.map((r, i) => '<tr><td>' + esc(r.al + r.no) + '</td><td>' + esc(r.from) + '</td><td>' +
        esc(r.toName || r.to) + ' (' + esc(r.to) + ')</td><td>' + esc(r.sched.slice(0, 10)) + ' ' +
        F.fmtTime(r.sched, state.display.clock24) + '</td><td>' + esc(r.gate || '--') + '</td><td>' +
        esc(r.aircraft) + '</td><td>' + esc(r.st) + '</td><td><button data-lk="' + i + '">Use</button></td></tr>').join('') +
      '</tbody></table>';
  }
  $('lkList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lk]');
    if (!b || !F.lastLookup) return;
    const r = F.lastLookup.results[+b.dataset.lk];
    F.useLookupResult(state, r);
    commit(); fillForm(); renderPicker();
    lookupMsg('Showing ' + r.al + r.no + ' ' + r.from + '-' + r.to + '. The united.com link in step 2 now points at it: ' +
      'open it and click the bookmark for live times, amenities and the lists.');
  });

  $('lkBtn').onclick = async () => {
    const q = lookupQuery(), problem = lookupProblem(q);
    if (problem) return lookupMsg(problem, true);
    lookupMsg('Looking up ' + (q.k === 'number' ? q.al + q.no : q.from + '-' + q.to) + ' on ' + q.date + '...');
    try {
      const results = await F.lookupViaFeed(state, q);       // the feed answers without any clicking
      F.lastLookup = { query: q, results: results };
      renderLookup();
      lookupMsg(results.length ? 'Found ' + results.length + ' (local feed). Pick one below.'
                               : 'FlightView has no such flight on ' + q.date + '.', !results.length);
    } catch (e) {
      if (!e.offline) return lookupMsg(e.message, true);
      // No feed, so the same bookmark answers the lookup on FlightView, which is the only site it can ask.
      const url = F.lookupUrl(q), what = q.k === 'number' ? q.al + q.no : q.from + '-' + q.to;
      if (window.open(url, 'fids-lookup')) {
        return lookupMsg('FlightView is open in another tab: click the "Send to gate display" bookmark there ' +
          'and the results come back here.');
      }
      lookupMsg('Open ');                                    // popup blocked: a real click on a link always works
      const a = document.createElement('a');
      a.href = url; a.target = 'fids-lookup'; a.rel = 'noopener'; a.textContent = what + ' on FlightView';
      $('lkMsg').append(a, ' and click the "Send to gate display" bookmark there.');
    }
  };
  document.querySelectorAll('[name=lookupBy]').forEach((el) => el.addEventListener('change', showLookupFields));
  function showLookupFields() {
    const k = document.querySelector('[name=lookupBy]:checked').value;
    document.querySelectorAll('[data-lookup]').forEach((el) => { el.hidden = el.dataset.lookup !== k; });
  }
  showLookupFields();
  $('lkDate').value = F.airportNow(state.flight.utcOffsetMin).toISOString().slice(0, 10);
  $('lkAirline').value = state.flight.airline || 'UA';

  // ---- United bookmarklet ----
  function unitedMsg(t, err) { $('unitedMsg').textContent = t; $('unitedMsg').className = 'msg' + (err ? ' err' : ''); }
  const bm = $('bookmarklet');
  bm.href = F.bookmarklet(location.origin + location.pathname);
  bm.addEventListener('click', (e) => { e.preventDefault(); alert('Drag this button to your bookmarks bar, then click it while viewing a flight on united.com.'); });
  // Control tabs talk over a BroadcastChannel: a tab opened by the bookmark hands its message to an
  // already-open control tab and closes itself, so bookmark clicks don't pile up tabs.
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('fids-control') : null;
  if (bc) bc.onmessage = (e) => {
    if (e.data.type === 'ping') bc.postMessage({ type: 'pong' });
    if (e.data.type === 'msg') unitedMsg(e.data.text, e.data.err);
  };
  function otherControlTabOpen() {
    return new Promise((resolve) => {
      if (!bc) return resolve(false);
      const t = setTimeout(() => { bc.removeEventListener('message', on); resolve(false); }, 1500);   // background tabs can be slow to answer
      const on = (e) => { if (e.data.type === 'pong') { clearTimeout(t); bc.removeEventListener('message', on); resolve(true); } };
      bc.addEventListener('message', on);
      bc.postMessage({ type: 'ping' });
    });
  }
  async function handOff(fresh) {
    if (!fresh || !(await otherControlTabOpen())) return;
    bc.postMessage({ type: 'msg', text: $('unitedMsg').textContent, err: $('unitedMsg').classList.contains('err') });
    unitedMsg($('unitedMsg').textContent + ' Closing this tab...');
    setTimeout(() => window.close(), 1200);   // allowed: this tab was opened by the bookmark's window.open
  }

  // Data arrives in the URL hash from the bookmark. An already-open control tab only sees a hash change
  // (no reload), so run this on load and on every hashchange.
  function runImports(fresh) {
    let imported = false;
    try {
      if (F.importUnitedFromHash(state)) {
        imported = true;
        commit(); fillForm();
        lookupNextDeparture();
        const u = state.united;
        unitedMsg('Loaded ' + state.flight.airline + state.flight.number + ' from united.com at ' + new Date(u.updated).toLocaleTimeString() +
          (u.delayMin ? ' · delayed ' + u.delayMin + ' min' + (u.delayCause ? ' (' + u.delayCause + ')' : '') : '') +
          ' · ' + state.upgrades.list.length + ' on upgrade list, ' + state.standby.list.length + ' on standby.');
      }
      const lk = F.importLookupFromHash(state);
      if (lk) {
        imported = true;
        fillForm();
        lookupMsg(lk.results.length + ' found on FlightView. Pick one below to show it.');
      }
      const fv = F.importFlightViewFromHash(state);
      if (fv) {
        imported = true;
        try { sessionStorage.setItem('fids.fv', JSON.stringify(F.lastFlightView)); } catch (err) {}
        commit(); fillForm(); renderPicker(); unitedMsg(fv.msg, !fv.ok && !fv.picker);
      }
    } catch (e) {
      unitedMsg('Could not read the imported data: ' + e.message, true);
    }
    if (imported) handOff(fresh);
  }
  window.addEventListener('hashchange', () => runImports(false));
  runImports(true);
  renderPicker();

  // ---- top bar ----
  $('openDisplay').onclick = () => window.open('display.html', 'fids-display');
  $('copyLink').onclick = async () => {
    // The whole screen, upgrade and standby lists included, so the other device shows exactly this one.
    // It rides in the URL's fragment, which browsers never send to a server, but it is in the link itself:
    // whoever gets the link gets the names.
    const url = new URL('display.html', location.href);
    url.hash = 's=' + encodeURIComponent(F.encodeState(state));
    try { await navigator.clipboard.writeText(url.href); alert('Link copied: a snapshot of everything on the screen right now, passenger names included. Later edits here will not reach that device.'); }
    catch (e) { prompt('Copy this link:', url.href); }
  };
  $('reset').onclick = () => {
    if (!confirm('Reset everything to the demo flight?')) return;
    state = F.defaultState(); commit(); fillForm();
    F.lastLookup = null; renderLookup(); lookupMsg(''); unitedMsg('');
  };

  F.onChange((s) => { state = s; fillForm(); });   // e.g. arrow keys pressed on the display
  setInterval(renderBoarding, 5000);                 // keep the auto-phase readout current
  F.watchForUpdates();
  fillForm();
})(window.FIDS);
