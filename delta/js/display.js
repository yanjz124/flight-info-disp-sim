// The Delta gate screen. One column of type on a dark blue field: no tabs, no amenities, no boarding
// zone, no gate number - the real screens carry none of those, so neither does this.
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

  function render() {
    const s = state, f = s.flight, d = F.derive(s), c24 = s.display.clock24;
    const now = F.airportNow(f.utcOffsetMin);

    set('clock', esc(F.fmtTime(now, c24)));
    set('tz', esc(f.tzLabel || ''));

    set('fno', esc((f.airline || 'DL') + ' ' + f.number));
    set('dest', esc(f.destLabel));
    set('status', esc(d.status));

    // The partner column is always there, even with nothing under it - and it reads PARTNER, singular,
    // when it is empty. Two or three columns in all, depending on whether the time moved.
    const labels = d.labels.concat([f.partners ? 'PARTNERS' : 'PARTNER']);
    const values = d.times.map((t) => F.fmtTime(t, c24)).concat([f.partners || '']);
    const cls = labels.length === 3 ? 'three' : 'two';
    $('tLabels').className = 't-labels ' + cls;
    $('tValues').className = 't-values ' + cls;
    set('tLabels', labels.map((l) => '<span>' + esc(l) + '</span>').join(''));
    set('tValues', values.map((v, i) =>
      '<span class="' + (i === values.length - 1 ? 'partner' : '') + '">' + esc(v) + '</span>').join(''));

    set('ribbon', esc(s.next.text || ''));
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
})(window.DFIDS);
