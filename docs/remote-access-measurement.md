# Measuring whether remote access survives the screen going off

Issue #50 observes that the app declares no foreground service and that nothing holds the
embedded node up when the app is backgrounded. During remote-access acceptance on
2026-09-21 the app was backgrounded at 18:04:44 and the coordinator recorded the node
disconnecting shortly afterwards, with connect/disconnect cycles of 27s, 64s and 188s
across that session.

**That has not been established as causal.** The same session had a genuine DNS defect
that explained a separate cellular failure, and no controlled test has distinguished
background throttling from anything else. This document exists so the next person runs the
test rather than repeating the inference.

## Why the app's banner is not evidence

The connection banner is derived from `ConnectionManager`'s HTTP probing
(`services/connection-manager.ts`), and `docs/PINNED_HTTPS.md` records that recovery
deliberately performs no background probes. So the banner reports what the app last managed
to reach, which is downstream of the thing under investigation. A node can be alive while
the banner says disconnected, and the banner can lag a node that died minutes ago.

The coordinator is the authority: `headscale nodes list` and its `node disconnected` log
lines.

## What is being separated

There are two distinct failures, and the point of the third run is to tell them apart.

1. **The node does not survive backgrounding.** The OS suspends or kills the process, the
   node's control connection drops, and the coordinator sees it go offline. A foreground
   service is the supported remedy.
2. **The node survives but the app never re-checks it.** On resume, `AppState` triggers
   `ConnectionManager.environment()`, which re-probes HTTP endpoints. Nothing queries
   `PondTls.remoteStatus()` and nothing calls `restoreRemoteAccess` outside mount and sign-out.
   A node that died is therefore never noticed, and the app retries endpoints that no longer
   route.

If the coordinator shows the node online throughout but the app cannot reach the Pond until
something forces a re-probe, the defect is the second, and no foreground service fixes it.

## Setup

Record all of this before starting; a run without it cannot be compared to another.

- Device, OS version, and build under test (commit sha).
- **Battery optimisation state for the app.** Samsung layers its own management on top of
  stock Doze, so note whether the app is unrestricted or optimised. This single setting can
  invalidate a comparison between two runs.
- Network: Wi-Fi SSID or carrier, and whether the Pond is reachable locally.
- Whether the Pond and coordinator were otherwise idle.

The coordinator is `controlpond.jarida.io`, which is
`DEFAULT_CONTROL_URL` in the Pond's `crates/pond-server/src/embedded_network.rs`. Its
administration API is **not** reachable over HTTPS: the Caddyfile answers `/api/*` with 404
on purpose, so `headscale` has to be run on the host itself. The stack lives at
`/opt/goose-remote-access/deploy/remote-access` and runs under Docker Compose rather than
as a bare binary.

Find the node name first — the watcher needs it exactly as the coordinator lists it. On the
coordinator host:

```bash
cd /opt/goose-remote-access/deploy/remote-access && docker compose exec -T headscale headscale nodes list
```

Then start the watcher, which writes one row per observed state change. Substitute the node
name and your own SSH target:

```bash
python3 scripts/watch-remote-node.py NODE_NAME --headscale "ssh SSH_TARGET cd /opt/goose-remote-access/deploy/remote-access && docker compose exec -T headscale headscale" --interval 15 --out run1.csv
```

`--headscale` takes the whole command prefix, so any way of reaching the coordinator works
as long as it ends at the `headscale` binary; the watcher appends
`nodes list --output json` itself.

Note that `docker compose exec -T` consumes standard input, which the Pond's
`deploy/remote-access/README.md` warns will eat the input of the script invoking it. The
watcher closes stdin on every call for exactly that reason, so it will not swallow your
terminal over a long run — but if you write your own polling loop, close stdin yourself.

It polls `headscale nodes list --output json`, tolerates the command failing without
stopping, and prints a summary of online and offline spells at the end — the spells are the
figures to compare against the 27s/64s/188s the issue recorded.

Capture the device side in parallel. The node logs through `android.util.Log.i("PondNetwork", …)`
(`plugins/pond-tls/PondNetwork.kt:43`), and the lifecycle transitions the issue cites appear
in the same stream:

```bash
adb logcat -v time -s PondNetwork:I ActivityManager:I ReactNativeJS:V > run1-device.log
```

## The three runs

Each must outlast a Doze window; an hour is the shortest useful duration, and longer is
better for runs 2 and 3.

**Run 1 — foreground, stable Wi-Fi.** The control. The app open and on screen throughout.
If the node drops here, backgrounding is not the story and the rest of the investigation
changes.

**Run 2 — backgrounded, screen off.** Background the app with the home gesture, screen off,
device untouched. This is the scenario the product promises and the one the issue suspects.

**Run 3 — an hour idle, then resume.** As run 2, then foreground the app and, without
touching anything else, record two things separately:

- what the coordinator says about the node at the moment of resume, and
- how long until the app can actually reach the Pond.

This is the run that separates the two failures above, so record the resume moment to the
second.

## Recording the result

For each run, keep the CSV, the device log, and a short note of what was observed. Add a
row to this table and commit it with the artefacts:

| Run | Date | Build | Battery opt. | Duration | First disconnect | Offline spells | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Raw timestamps, not impressions. "It seemed to drop after a while" is what this document
exists to replace.

## Reading the outcome

- **Node stays online in run 2** — backgrounding is not the cause, and the foreground
  service in #50 would be solving a problem that does not exist. Look at run 3 for the
  resume gap instead.
- **Node drops in run 2 but not run 1** — backgrounding is implicated. A foreground service
  is the supported mechanism, and the persistent notification it requires becomes a product
  decision worth making deliberately.
- **Node drops in run 1 too** — the problem is not lifecycle at all. Suspect the network
  path, the coordinator, or the DNS defect this session was originally confounded by.
- **Node online throughout run 3, but the app cannot reach the Pond on resume** — the
  resume gap, fixed in JavaScript and testable without a device.

Whatever the answer, write the guarantee into `docs/PINNED_HTTPS.md`: whether remote access
survives the screen going off, for how long, and how iOS differs. Somebody relying on it to
check their home while away needs to know which it is. #48's data-safety declaration also
has to describe the persistent notification, if one ends up existing.
