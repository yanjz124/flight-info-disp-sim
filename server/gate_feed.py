"""
Optional local feed for the gate display: follows one gate and rolls over to the next flight.

Every cycle it starts your installed Chrome off-screen (not in automation mode), reads the airport's
departures from FlightView's own page, picks the flight currently using the gate, then reads that
flight's details from united.com's flight-status page: times and delay, boarding time, amenities,
cabins, and the upgrade/standby lists. It serves the result at http://127.0.0.1:8788/state for the
display and control pages to poll.

With --ics it follows the UA flights in an iCal subscription instead of a gate: the next one once it is
within 5 hours, otherwise a random UA departure leaving one of United's hubs in the next 2 hours.

Run:   pip install playwright tzdata
       python server/gate_feed.py        (then pick a gate or your calendar on the control page)
       python server/gate_feed.py --airport EWR --gate C107
       python server/gate_feed.py --ics "webcal://p00-caldav.icloud.com/published/2/..."

The last setup is saved in server/.feed-config.json, so a restart keeps following the same thing.
       python server/gate_feed.py --airport SFO --gate F5 --airline UA --every 120 --show

Then on the control page, tick "Follow a gate with the local feed" and leave the address as
http://127.0.0.1:8788. Nothing is uploaded anywhere: the pages fetch it from your own machine.

Personal, low-frequency use only. Automated access is against united.com's terms, and this breaks
whenever either site changes. Passenger names stay on your machine.
"""
import argparse
import json
import pathlib
import random
import re
import subprocess
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE = pathlib.Path(__file__).with_name(".chrome-profile")
FV_PAGE = "https://www.flightview.com/airport/{airport}/departures"
FV_API = "https://app-api.flightview.com/api/airport/{airport}/departures"
UA_PAGE = "https://www.united.com/en/us/flightstatus/details/{num}/{date}/{frm}/{to}/{carrier}"
GONE = re.compile(r"depart|in air|en route|arriv|landed|cancel", re.I)
# Calendar mode: a random departure comes from one of United's hubs, so there is always one to pick.
UA_HUBS = {"SFO": "America/Los_Angeles", "LAX": "America/Los_Angeles", "DEN": "America/Denver",
           "ORD": "America/Chicago", "IAH": "America/Chicago", "EWR": "America/New_York", "IAD": "America/New_York"}
# Flighty's event titles: "Name: ✈ EWR→ILM • UA 3454" (zero-width spaces around the arrow).
UA_TITLE = re.compile(r"\b([A-Z]{3})\W+([A-Z]{3})\s*•\s*UA\s*(\d+)")
CAL_NEAR = timedelta(hours=5)        # show the calendar flight once it's this close, else a random one
RANDOM_WINDOW = timedelta(hours=2)   # a random departure leaves within this long
# What to follow can be set from the control page; it's kept here (gitignored: the calendar link is private).
CONFIG_FILE = pathlib.Path(__file__).with_name(".feed-config.json")
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")
SITE_ORIGINS = ["https://yanjz124.github.io"]   # pages allowed to change the setup, besides localhost

# mode: "gate" (--airport/--gate), "calendar" (the next UA flight in --ics) or "random" (calendar flight > 5 h away)
state = {"fetchedAt": None, "flight": None, "fv": None, "united": None, "error": None, "log": [], "mode": "gate", "note": ""}
lock = threading.Lock()
wake = threading.Event()        # set when the setup changes, so the next cycle starts right away


def note(msg):
    line = time.strftime("%H:%M:%S") + "  " + msg
    print(line, flush=True)
    with lock:
        state["log"] = (state["log"] + [line])[-30:]


def norm_gate(g):
    return re.sub(r"[^A-Z0-9]", "", (g or "").upper().replace("GATE", ""))


def same_gate(a, b):
    a, b = norm_gate(a), norm_gate(b)
    if not a or not b:
        return False
    return a == b or re.sub(r"^[A-Z]+", "", a) == b or re.sub(r"^[A-Z]+", "", b) == a


class Chrome:
    """A normally-launched Chrome we attach to over the DevTools port."""

    def __init__(self, args):
        self.args = args
        self.proc = self.pw = self.br = None

    def __enter__(self):
        PROFILE.mkdir(exist_ok=True)
        pos = [] if self.args.show else ["--window-position=-2400,0"]
        self.proc = subprocess.Popen([
            self.args.chrome, f"--remote-debugging-port={self.args.cdp_port}", f"--user-data-dir={PROFILE}",
            "--no-first-run", "--no-default-browser-check", "--window-size=1300,900", *pos, "about:blank",
        ])
        self.pw = sync_playwright().start()
        for _ in range(40):
            try:
                self.br = self.pw.chromium.connect_over_cdp(f"http://127.0.0.1:{self.args.cdp_port}")
                break
            except Exception:
                time.sleep(0.25)
        else:
            raise RuntimeError("could not attach to Chrome")
        ctx = self.br.contexts[0]
        return ctx.pages[0] if ctx.pages else ctx.new_page()

    def __exit__(self, *exc):
        try:
            if self.br and self.br.is_connected():
                self.br.new_browser_cdp_session().send("Browser.close")
        except Exception:
            pass
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.terminate()
        for fn in (lambda: self.br and self.br.close(), lambda: self.pw and self.pw.stop()):
            try:
                fn()
            except Exception:
                pass


def fetch_departures(page, airport):
    """FlightView's own page, then its departures feed from inside that page (same origin)."""
    page.goto(FV_PAGE.format(airport=airport), wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    return page.evaluate(
        """async (url) => {
            const r = await fetch(url, { credentials: 'include' });
            if (!r.ok) throw new Error('FlightView ' + r.status);
            return (await r.json()).map((x) => ({ al: x.airlineCode, no: x.flightNumber, date: x.flightDate,
                sch: x.scheduledTime, upd: x.updatedTime, gate: x.gate, to: x.airportCode, toName: x.airport,
                st: x.displayStatus }));
        }""",
        FV_API.format(airport=airport),
    )


def pick_flight(deps, gate, airline, grace):
    """The flight now using the gate: the earliest one that hasn't gone yet (plus a grace period)."""
    cutoff = (datetime.now() - timedelta(minutes=grace)).strftime("%Y-%m-%dT%H:%M")
    at_gate = [d for d in deps if same_gate(d["gate"], gate) and (not airline or d["al"] == airline)]
    for d in sorted(at_gate, key=lambda d: d["date"] + "T" + (d["upd"] or d["sch"])):
        t = d["date"] + "T" + (d["upd"] or d["sch"])
        if t >= cutoff and not GONE.search(d["st"] or ""):
            return d
    return None


def fetch_united(page, dep):
    """The same JSON united.com's own flight-status page loads."""
    page.goto(UA_PAGE.format(num=dep["no"], date=dep["date"], frm=dep["from"], to=dep["to"], carrier=dep["al"]),
              wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    return page.evaluate(
        """async ({num, date, frm, to, carrier}) => {
            const tok = await (await fetch('/api/auth/anonymous-token', { credentials: 'include' })).json();
            const t = (tok.data && tok.data.token && (tok.data.token.hash || tok.data.token)) || tok.token;
            const h = { 'x-authorization-api': 'bearer ' + t };
            const get = async (u) => { const r = await fetch(u, { credentials: 'include', headers: h });
                                       if (!r.ok) throw new Error(r.status + ' for ' + u.split('?')[0]); return r.json(); };
            const status = await get(`/api/flightstatus/status/${num}/${date}/${frm}/${to}?carrierCode=${carrier}&useLegDestDate=true`);
            const seg = ((status.data.flightLegs || [])[0].OperationalFlightSegments || [])[0] || {};
            const eq = seg.Equipment || {};
            let amenities = null, upgrades = null;
            try {
                amenities = await get(`/api/flightstatus/amenities/${num}/${date}/${frm}/${to}?ownerAirlineCode=${eq.OwnerAirlineCode || ''}` +
                    `&equipmentCode=${(eq.Model && eq.Model.Key) || ''}&tailNumber=${eq.TailNumber || ''}&shipNumber=${eq.PseudoTailNumber || eq.NoseNumber || ''}`);
            } catch (e) {}
            try { upgrades = await get(`/api/flightstatus/upgradeListExtended?flightNumber=${num}&flightDate=${date}&fromAirportCode=${frm}`); } catch (e) {}
            return { fetchedAt: new Date().toISOString(), carrier, from: frm, status, amenities, upgrades };
        }""",
        {"num": str(dep["no"]), "date": dep["date"], "frm": dep["from"], "to": dep["to"], "carrier": dep["al"]},
    )


def cycle(args):
    with Chrome(args) as page:
        deps = fetch_departures(page, args.airport)
        note(f"FlightView: {len(deps)} departures from {args.airport}")
        dep = pick_flight(deps, args.gate, args.airline, args.grace)
        if not dep:
            with lock:
                state.update(fetchedAt=datetime.now().isoformat(timespec="seconds"),
                             fv={"airport": args.airport, "departures": deps},
                             error=f"No upcoming {args.airline or ''} departure at gate {args.gate}.")
            note(state["error"])
            return
        dep = {**dep, "from": args.airport}
        prev = (state.get("flight") or {}).get("no")
        if prev and str(prev) != str(dep["no"]):
            note(f"Gate {args.gate} rolled over: {prev} -> {dep['no']}")
        note(f"Gate {args.gate}: {dep['al']}{dep['no']} to {dep['to']} at {dep['upd'] or dep['sch']} ({dep['st']})")
        united = fetch_united(page, dep)
        with lock:
            state.update(fetchedAt=datetime.now().isoformat(timespec="seconds"), flight=dep,
                         fv={"airport": args.airport, "departures": deps}, united=united, error=None)


# ---- calendar mode: follow the UA flights in an iCal subscription (e.g. Flighty synced to iCloud) ----

_cal = {"at": 0.0, "flights": []}


def calendar_flights(url):
    """UA flights in the calendar as [{no, frm, to, dep (aware datetime), tz}], re-read at most every 10 min."""
    if time.time() - _cal["at"] < 600:
        return _cal["flights"]
    req = urllib.request.Request(re.sub(r"^webcal://", "https://", url), headers={"User-Agent": "gate-feed"})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode("utf-8", "replace")
    text = re.sub(r"\r?\n[ \t]", "", text)                 # unfold long lines
    flights, ev = [], None
    for line in text.splitlines():
        if line == "BEGIN:VEVENT":
            ev = {}
        elif line == "END:VEVENT" and ev is not None:
            m = UA_TITLE.search(ev.get("SUMMARY", ("", {}))[0])
            start, params = ev.get("DTSTART", ("", {}))
            if m and start and ev.get("STATUS", ("", {}))[0] != "CANCELLED":
                tz = ZoneInfo(params["TZID"]) if "TZID" in params else timezone.utc
                dep = datetime.strptime(start.rstrip("Z")[:15], "%Y%m%dT%H%M%S").replace(tzinfo=tz)
                flights.append({"no": m.group(3), "frm": m.group(1), "to": m.group(2), "dep": dep, "tz": tz})
            ev = None
        elif ev is not None and ":" in line:
            key, value = line.split(":", 1)
            name, *ps = key.split(";")
            ev[name] = (value, dict(p.split("=", 1) for p in ps if "=" in p))
    flights.sort(key=lambda f: f["dep"])
    _cal.update(at=time.time(), flights=flights)
    return flights


def local_now(tz):
    return datetime.now(timezone.utc).astimezone(tz)


def find_dep(deps, al, no, date):
    return next((d for d in deps if d["al"] == al and str(d["no"]) == str(no) and d["date"] == date), None)


def dep_time(d, tz):
    """A FlightView departure's (updated) time as an aware datetime in the airport's zone."""
    return datetime.strptime(d["date"] + "T" + (d["upd"] or d["sch"])[:5], "%Y-%m-%dT%H:%M").replace(tzinfo=tz)


def pick_random(page, args):
    """A random UA departure leaving a hub within RANDOM_WINDOW."""
    for airport in random.sample(list(UA_HUBS), len(UA_HUBS)):
        tz = ZoneInfo(UA_HUBS[airport])
        now = local_now(tz)
        deps = fetch_departures(page, airport)
        ok = [d for d in deps if d["al"] == "UA" and not GONE.search(d["st"] or "")
              and now <= dep_time(d, tz) <= now + RANDOM_WINDOW]
        if ok:
            return {**random.choice(ok), "from": airport}, deps, tz
        note(f"No UA departures from {airport} in the next {RANDOM_WINDOW}; trying another hub")
    return None, None, None


def cycle_calendar(args):
    grace = timedelta(minutes=args.grace)
    now = datetime.now(timezone.utc)
    upcoming = [f for f in calendar_flights(args.ics) if f["dep"] + grace >= now]
    nxt = upcoming[0] if upcoming else None
    with Chrome(args) as page:
        if nxt and nxt["dep"] - now <= CAL_NEAR:
            # The calendar flight: FlightView adds the gate and any delay; otherwise go by the calendar alone.
            date = nxt["dep"].strftime("%Y-%m-%d")
            deps = fetch_departures(page, nxt["frm"])
            dep = find_dep(deps, "UA", nxt["no"], date) or {
                "al": "UA", "no": nxt["no"], "date": date, "sch": nxt["dep"].strftime("%H:%M"), "upd": "",
                "gate": "", "to": nxt["to"], "toName": "", "st": ""}
            dep = {**dep, "from": nxt["frm"]}
            mode, fv_airport = "calendar", nxt["frm"]
            state["pick"] = None
            msg = f"UA{nxt['no']} {nxt['frm']}-{nxt['to']} from your calendar"
        else:
            # Keep the same random flight until it leaves, so the screen doesn't jump every cycle.
            prev = state.get("pick")
            if prev and prev["mode"] == "random" and dep_time(prev["dep"], ZoneInfo(prev["tz"])) + grace >= now:
                dep, fv_airport = prev["dep"], prev["dep"]["from"]
                deps = (state.get("fv") or {}).get("departures") or []
            else:
                dep, deps, tz = pick_random(page, args)
                if not dep:
                    raise RuntimeError("No UA departures at any hub in the next two hours.")
                fv_airport = dep["from"]
                state["pick"] = {"mode": "random", "dep": dep, "tz": tz.key}
            mode = "random"
            away = f"{(nxt['dep'] - now) / timedelta(hours=1):.0f} h away" if nxt else "none upcoming"
            msg = f"random UA{dep['no']} {dep['from']}-{dep['to']} (next calendar flight {away})"
        note(f"{mode}: {dep['al']}{dep['no']} {dep['from']}-{dep['to']} at {dep['upd'] or dep['sch']} gate {dep['gate'] or '?'}")
        united = fetch_united(page, dep)
        with lock:
            state.update(fetchedAt=datetime.now().isoformat(timespec="seconds"), flight=dep, mode=mode, note=msg,
                         fv={"airport": fv_airport, "departures": deps} if deps else None, united=united, error=None)


def describe(args):
    return "your calendar's UA flights" if args.ics else f"{args.airport} gate {args.gate}"   # never the calendar link


def config_summary(args):
    mode = "calendar" if args.ics else "gate" if args.airport and args.gate else None
    return {"mode": mode, "airport": args.airport or "", "gate": args.gate or "", "airline": args.airline}


def apply_config(args, cfg, save=True, allow_file=False):
    """Switch what the feed follows: a gate, or the flights in a calendar. Raises ValueError on bad input."""
    ics = (cfg.get("ics") or "").strip()
    airport = (cfg.get("airport") or "").strip().upper()
    gate = (cfg.get("gate") or "").strip().upper()
    if ics:
        if not re.match(r"^(webcal|https%s)://" % ("|file" if allow_file else ""), ics, re.I):
            raise ValueError("The calendar link must start with webcal:// or https://")
        airport = gate = ""
    elif not (re.fullmatch(r"[A-Z]{3}", airport) and gate):
        raise ValueError("Give a 3-letter airport code and a gate, or a calendar link.")
    with lock:
        args.ics, args.airport, args.gate = ics or None, airport or None, gate or None
        if cfg.get("airline") is not None:
            args.airline = str(cfg["airline"]).strip().upper()
        state.update(flight=None, fv=None, united=None, pick=None, error=None, note="", mode="calendar" if ics else "gate")
        _cal["at"] = 0
    if save:
        CONFIG_FILE.write_text(json.dumps({"ics": ics, "airport": airport, "gate": gate, "airline": args.airline}))
    wake.set()


def loop(args):
    while True:
        wake.clear()
        started = time.time()
        if not (args.ics or (args.airport and args.gate)):
            with lock:
                state["error"] = "Not set up yet: choose a gate or your calendar on the control page."
            wake.wait()
            continue
        try:
            cycle_calendar(args) if args.ics else cycle(args)
        except Exception as e:
            with lock:
                state["error"] = str(e)
            note("Cycle failed: " + str(e)[:200])
        wake.wait(max(30, args.every - (time.time() - started)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--airport", help="origin airport, e.g. EWR")
    ap.add_argument("--gate", help="gate to follow, e.g. C107")
    ap.add_argument("--ics", help="instead of a gate, follow the UA flights in this iCal subscription (webcal:// or https://)")
    ap.add_argument("--airline", default="UA", help="airline code to follow at that gate ('' for any)")
    ap.add_argument("--every", type=int, default=120, help="seconds between refreshes (min 30)")
    ap.add_argument("--grace", type=int, default=10, help="keep showing a flight this many minutes past departure")
    ap.add_argument("--port", type=int, default=8788)
    ap.add_argument("--cdp-port", type=int, default=9333)
    ap.add_argument("--chrome", default=CHROME)
    ap.add_argument("--show", action="store_true", help="show the Chrome window")
    ap.add_argument("--allow-origin", action="append", default=list(SITE_ORIGINS),
                    help="another site allowed to change the setup from its control page (localhost always is)")
    args = ap.parse_args()

    # Setup: the command line wins (and is remembered); otherwise the last one sent from the control page.
    try:
        if args.ics or (args.airport and args.gate):
            apply_config(args, {"ics": args.ics, "airport": args.airport, "gate": args.gate}, allow_file=True)
        elif CONFIG_FILE.exists():
            apply_config(args, json.loads(CONFIG_FILE.read_text()), save=False, allow_file=True)
    except ValueError as e:
        ap.error(str(e))

    class Handler(BaseHTTPRequestHandler):
        def cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")   # lets an https page reach localhost

        def reply(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204); self.cors(); self.end_headers()

        def do_GET(self):
            if not self.path.startswith("/state"):
                return self.reply(404, {"error": "not found"})
            with lock:
                body = {**state, "config": config_summary(args)}
            self.reply(200, body)

        # POST /config {"ics": "webcal://..."} or {"airport": "EWR", "gate": "C107"}, from the control page.
        def do_POST(self):
            origin = self.headers.get("Origin", "")
            if not (LOCAL_ORIGIN.match(origin) or origin in args.allow_origin):
                return self.reply(403, {"error": "Only the gate display site or localhost can change the feed."})
            if not self.path.startswith("/config"):
                return self.reply(404, {"error": "not found"})
            try:
                cfg = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                apply_config(args, cfg if isinstance(cfg, dict) else {})
            except (ValueError, json.JSONDecodeError) as e:
                return self.reply(400, {"error": str(e)})
            note("Now following " + describe(args))
            self.reply(200, {"ok": True, "config": config_summary(args)})

        def log_message(self, *a):
            pass

    class Server(ThreadingHTTPServer):
        allow_reuse_address = False      # on Windows, reuse would let two feeds silently share the port

    try:
        srv = Server(("127.0.0.1", args.port), Handler)
    except OSError:
        raise SystemExit(f"Port {args.port} is already in use. Is another gate_feed.py running?")
    threading.Thread(target=loop, args=(args,), daemon=True).start()
    what = describe(args) if config_summary(args)["mode"] else "nothing yet (set it up on the control page)"
    print(f"Gate feed for {what} on http://127.0.0.1:{args.port}/state  (Ctrl+C to stop)")
    srv.serve_forever()


if __name__ == "__main__":
    main()
