# Gate Information Display Simulator

> **Amateur hobby project.** This is a fan-made imitation of United Airlines gate screens, built from a few photos. It is not nearly as accurate as the real thing: layouts, colors, fonts, wording and boarding logic are all approximations. It is not affiliated with, endorsed by, or connected to United Airlines or Star Alliance, and it must not be used for real airport operations or travel decisions. Always check the airline's official app or website for real flight information.

A static web app that looks like an airline boarding gate screen. It can pull live flight data (times, gate, aircraft, status) and lets you set the rest by hand: boarding groups, status, upgrade and standby lists, amenities, and promos.

It has no backend, so it runs on GitHub Pages.

One airline per folder, because the screens have almost nothing in common:

- `index.html`: the landing page, which just picks an airline.
- `united/`: the United control page, with `united/display.html` (1920x1080, scaled to fit; double-click or `F` for
  fullscreen, `←` / `→` change the boarding group) and `united/status.html`.
- `delta/`: the Delta control page and `delta/display.html`.
- The control pages are styled with [Primer](https://primer.style), GitHub's design system, loaded from a CDN.
  `css/app.css` adds only what Primer has no component for: the field grid, the display preview, the boarding
  group pad, the name-list editors and the airline picker. Everything else lives inside its airline's folder.

Links made before the move still work: `display.html`, `status.html` and `control.html` at the root redirect into
`united/`, carrying any snapshot hash across, and a bookmarklet dragged when the control page was at the root is
forwarded too.

## Running it

**Locally:** serve the folder over HTTP (so localStorage and fetch behave), for example:

```sh
python -m http.server 8000
# open http://localhost:8000/
```

**GitHub Pages:** push the repo, then go to Settings → Pages → Deploy from branch → `main` / root.
Then open `https://<user>.github.io/<repo>/` and pick an airline.

## Where the data comes from

No API keys and no accounts: everything is read from pages you open yourself, or by the optional local feed.

| What | Source |
|---|---|
| Which flight, its gate and times | FlightView's airport departures (via the bookmark, or the feed) |
| Finding a flight from a date and a flight number, or a date and a route | FlightView's flight and route pages |
| Delay and reason, boarding time, terminal, aircraft, inbound flight, weather | united.com flight status (via the bookmark, or the feed) |
| Amenities, cabin names, Wi-Fi provider | united.com flight status |
| Upgrade and standby lists with capacity | united.com flight status |
| Next departure from the gate | FlightView's airport departures |
| Boarding groups and progress | set by hand, or advanced by the clock |

Anything can still be typed in by hand in **Flight details** on the control page; tick **Freeze details** to stop an update
from overwriting your edits.

Ten minutes after a flight leaves, the screen moves on to the next departure from its gate: the one already in the footer,
which FlightView put there. The amenities and the name lists belong to the flight that left, so they go with it, and
boarding starts over. Turn it off under **Boarding**, or tick **Freeze details**. With the local feed running the feed does
the rolling over instead, from the live departure board.

## United live data (one-click bookmark)

The control page has a **Send to gate display** button. Drag it to your bookmarks bar once. After that the whole routine is:
go to [united.com Flight Status](https://www.united.com/en/us/flightstatus), find your flight there (it searches by route or
by flight number), and click the bookmark. That's it.

It runs inside your own united.com tab, calls the same JSON endpoints that page uses, and opens the control page with the
data. That covers nearly everything on the screen: live times and delay reason, gate, terminal, United's boarding time,
aircraft and tail, inbound flight, weather, amenities, and the upgrade/standby lists with capacity, booked and checked-in
counts. Click it again to refresh. Nothing to install, and it works from the GitHub Pages site.

The data only moves between your own browser tabs, and upgrade/standby names (surname + initial, as United shows them
publicly) stay in your browser's storage and are never committed. "Copy link for another device" is the one exception: it
puts the whole screen in the link, names included, so that the other device shows exactly what this one does. The snapshot
rides in the URL fragment, which browsers never send to a server, but anyone you give the link to can read it.
**Finding a flight:** open your airport's departures on FlightView and click the bookmark. The control
page then lists every departure (flight number, destination, gate, time) as a picker, with a filter box. Pick one and it
becomes the current flight, with the united.com link built for it; click the bookmark there for everything else.

**Finding a flight without leaving the control page** (optional; searching on united.com is usually quicker): **Find a
flight** takes a date and a flight number and lists the legs that flight flies that day, or a date, an origin and a
destination and lists every flight on that route that day. Pick one and it becomes the current flight, with the
united.com link built for it.

FlightView only answers its own pages, so the lookup runs where that is true: the control page opens FlightView with the
question in the URL and the same bookmark answers it there. The local feed, running on your own machine, answers without
a tab at all — if it's reachable, **Look up** uses it.

**Next departure from the gate:** United's data doesn't include it, so the control page links to the airport's
departures on [FlightView](https://www.flightview.com/). Click the same bookmark there: it reads FlightView's departures
(with gates) and picks the next flight from your gate, then **Use FlightView's departures** under Next departure re-picks it
without another click.

A tab opened by the bookmark hands its update to an already-open control page and closes itself.

## Optional: follow a gate automatically (local feed)

`server/gate_feed.py` keeps one gate up to date without any clicking, and rolls over to the next flight once one departs.
Each cycle it starts your Chrome off-screen, reads the airport's departures from FlightView's page, picks the flight
currently using the gate, then reads that flight's details from united.com, and serves the result on localhost.

```sh
pip install playwright tzdata airportsdata
python server/gate_feed.py        # --every 120 --show; or set it up here: --airport EWR --gate C107
```

Then set it up under **Local feed** on the control page and click **Send to the feed**:

- **Follow a gate:** airport code and gate.
- **Follow my calendar's UA flights:** paste an iCal subscription link (for example Flighty synced to an iCloud
  calendar). The feed shows the next UA flight in it once it's within 5 hours, with its gate and live data. Until then it
  shows a random UA departure leaving one of United's hubs in the next 2 hours, and keeps it until it departs.

The feed remembers the last setup in `server/.feed-config.json` (gitignored), so a restart keeps going. The calendar
link is private: it's kept only in that file and this browser, never in shared links, and only flight numbers and
routes reach the pages. Only this site and `localhost` pages can change the setup (`--allow-origin` adds another).

**Send to the feed** also ticks **Show the feed on the display**. The display and status pages poll it, so a screen left
running follows along on its own. Same caveats as the bookmark: personal use, breaks when either site changes.
Passenger names never leave your machine.

## Delta

`delta/` is a second, separate screen: Delta's gate TV, which looks nothing like United's. One column of type on a
dark blue field, and that is all it carries — no tabs, no amenities, no boarding zone, no gate number, no upgrade or
standby list. Because of that the missing delta.com data source costs nothing: FlightView covers Delta for every field
on the screen, so **Find a flight** and the departures bookmark work exactly as they do on the United page.

It was built by measuring photographs rather than by eye. A straight-on shot whose lit area came out 1036x586 — 16:9
to within a pixel — set every row position and type size; the widget is Delta's own vector, rotated 57 degrees so its
long edge lies flat along the top edge; the field and ribbon colours were sampled from the same photograph.

The time columns follow the status, which is how the real screens behave and was checked against ten photographed
screens: `DEPARTS` when nothing has moved, `SCHEDULED / ACTUAL` when the status is itself about time (Delayed, Early,
Boarding Ended), and `WAS / NOW` when the time moved but boarding is under way. The partner column is always present,
reading `PARTNER` when empty and `PARTNERS` when filled.

Delta's logos are trademarks of their owners, used here only for this non-commercial fan project. The typeface is
Whitney, which is a paid licence, so this substitutes Source Sans 3.

## Wallpaper Engine

`wallpaper/` is a web wallpaper: copy the folder into Wallpaper Engine's `myprojects` directory (or open it from the
editor) and it shows the display full-screen behind your desktop. Its **Display link** setting takes any URL:

- the plain display URL (`.../display.html`), which stays live if the local feed is running;
- or a snapshot link from **Copy link for another device**, which pins one flight's settings.

Wallpaper Engine has its own browser storage, so the control page can't push changes into it directly; use the feed or a
new snapshot link.

## Flight status page

`status.html` shows the current flight like an airline status page: delay banner, departure/arrival with gates, aircraft and
inbound flight, weather, amenities, and the standby and upgrade lists. It uses the same shared state as the display.

## How the pages sync

Pages on the **same browser** share state through localStorage, so edits on the control page show up on the display right away (for example, a laptop driving a TV over HDMI).

For a **different device**, use **Copy link for another device**. It puts a snapshot of the current state in the URL. Later edits won't reach that device. The local feed keeps such a device up to date if it can reach this computer.

## Assets

- `assets/united-lockup.png` and `assets/star-alliance.png`: header logos (trimmed, resized, and the star lightened to white). They are trademarks of their owners and are used here only for this non-commercial fan project. **Logo image** on the control page overrides the whole header lockup.
- `assets/qr-assistance.png`: the "Need assistance?" QR code (links to United's travel help page), also used on the app promo. If it's missing, the Flight tab shows the estimated arrival instead.
- `assets/icons/united-sprite.svg`: United's icon sprite from united.com, used for amenities and labels.

Reference photos go in `ref/` (ignored by git). Colors and sizes are CSS variables at the top of `css/display.css`;
the colours and the row heights there are sampled from United's own design-system screens rather than guessed.
