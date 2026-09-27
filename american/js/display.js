// The American gate screen: a white header with the destination and gate, a blue field with the boarding
// line and the two times, a pale panel on the right, and a deeper band along the bottom.
(function (F) {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  let state = F.load();

  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function set(id, html) { const el = $(id); if (el.innerHTML !== html) el.innerHTML = html; }

  function panelHtml(s) {
    const p = s.panel;
    if (p.mode === 'none') return '';
    if (p.mode === 'upgrades') {
      const names = p.upgrades || [];
      const half = Math.ceil(names.length / 2);
      const rows = names.map((n, i) =>
        '<div class="up-row' + (i < (+p.cleared || 0) ? ' ok' : '') + '"><i>' + (i + 1) + '</i>' + esc(n) + '</div>');
      // two columns, filled down the left then the right, as the screens do
      const order = [];
      for (let i = 0; i < half; i++) { order.push(rows[i]); if (rows[i + half]) order.push(rows[i + half]); }
      return '<div class="up-title">Upgrades</div><div class="up-cabin">' + esc(p.upgradeCabin || '') + '</div>' +
             '<div class="up-grid">' + order.join('') + '</div>';
    }
    return '<p>Please be ready to board when your group is called.</p>' +
           '<p>Boarding ends 15 minutes before departure.</p>';
  }

  function render() {
    const s = state, f = s.flight, d = F.derive(s), c24 = s.display.clock24;
    const tz = f.tzLabel ? ' <span style="font-size:.62em">' + esc(f.tzLabel) + '</span>' : '';

    set('gate', esc(f.gate));
    set('fno', 'Flight ' + esc((f.airline || 'AA') + ' ' + f.number));
    set('dest', esc(f.destLabel));

    const pill = $('pill');
    pill.textContent = (f.status || '').toUpperCase();
    pill.className = 'pill' + (/delay/i.test(f.status) ? ' delayed' : /cancel/i.test(f.status) ? ' canceled' : '');
    // the chip sits just left of the header's wedge, and its own rake matches it
    pill.style.right = (1920 - 1530) + 'px';

    set('boards', esc(d.line) + (d.group ? '<span class="chip">' + esc(d.group) + '</span>' : ''));
    set('departs', esc(F.fmtTime(f.sched, c24)) + tz);
    set('arrivesLabel', f.arrivesChanged ? 'Now arrives' : 'Arrives');
    set('arrives', esc(F.fmtTime(f.arrives, c24)) + tz);

    const panel = $('panel');
    panel.className = 'panel' + (s.panel.mode === 'upgrades' ? ' upgrades' : '');
    panel.hidden = s.panel.mode === 'none';
    set('panel', panelHtml(s));

    set('dur', d.duration ? 'Flight duration: ' + esc(d.duration) : '');
    set('clock', esc(F.fmtTime(F.airportNow(f.utcOffsetMin), c24)));
  }

  addEventListener('resize', fit);
  fit();
  F.onChange((s) => { state = s; render(); });
  document.addEventListener('dblclick', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen().catch(() => {});
  });
  render();
  setInterval(render, 1000);
  F.watchForUpdates();
})(window.AFIDS);
