#!/usr/bin/env python3
"""Record when the coordinator considers a phone's embedded node online, for issue #50.

The app's own connection banner is derived from HTTP probing, which is the behaviour under
investigation, so it cannot be the evidence. The coordinator is the authority: this polls
it and writes one row per observed state change, with the raw timestamps needed to say how
long a node survives backgrounding.
"""
import argparse
import csv
import json
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone

# headscale has renamed these between versions, and getting it wrong would silently report
# a node as permanently offline, so try each spelling rather than assume one.
NAME_KEYS = ("given_name", "givenName", "name", "hostname")
ONLINE_KEYS = ("online", "isOnline", "is_online")
SEEN_KEYS = ("last_seen", "lastSeen")
ID_KEYS = ("id", "ID", "node_key", "nodeKey")


def first(node, keys, default=None):
    for key in keys:
        if key in node and node[key] is not None:
            return node[key]
    return default


def poll(command):
    """Return the node list, or a string describing why it could not be read."""
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as error:
        return f"{type(error).__name__}: {error}"
    if done.returncode != 0:
        return f"exit {done.returncode}: {done.stderr.strip()[:200]}"
    try:
        parsed = json.loads(done.stdout)
    except json.JSONDecodeError as error:
        return f"unparsable output: {error}"
    # Some versions wrap the list in an object.
    if isinstance(parsed, dict):
        for key in ("nodes", "machines", "data"):
            if isinstance(parsed.get(key), list):
                return parsed[key]
        return "unexpected object shape: " + ", ".join(sorted(parsed)[:6])
    return parsed if isinstance(parsed, list) else f"unexpected type {type(parsed).__name__}"


def find(nodes, wanted):
    wanted = wanted.lower()
    for node in nodes:
        if str(first(node, ID_KEYS, "")).lower() == wanted:
            return node
        if str(first(node, NAME_KEYS, "")).lower() == wanted:
            return node
    return None


def describe(seconds):
    if seconds < 90:
        return f"{seconds:.0f}s"
    return f"{seconds / 60:.1f}m"


def watch(args):
    command = shlex.split(args.headscale) + ["nodes", "list", "--output", "json"]
    print(f"polling: {' '.join(command)}", file=sys.stderr)
    print(f"node: {args.node}   interval: {args.interval}s", file=sys.stderr)
    print("Ctrl-C to stop and print the summary.\n", file=sys.stderr)

    started = time.monotonic()
    state = None
    changed_at = started
    # (was_online, duration) for every completed spell, which is what the issue's
    # "27s, 64s and 188s" figures are.
    spells = []
    rows = []
    deadline = started + args.duration if args.duration else None

    try:
        while deadline is None or time.monotonic() < deadline:
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            elapsed = time.monotonic() - started
            result = poll(command)

            if isinstance(result, str):
                current, seen, note = "unreadable", "", result
            else:
                node = find(result, args.node)
                if node is None:
                    known = ", ".join(sorted(str(first(n, NAME_KEYS, "?")) for n in result)[:8])
                    current, seen, note = "absent", "", f"not in list; saw: {known}"
                else:
                    online = first(node, ONLINE_KEYS)
                    current = "online" if online else "offline"
                    seen = str(first(node, SEEN_KEYS, ""))
                    note = ""

            if current != state:
                if state is not None:
                    held = time.monotonic() - changed_at
                    spells.append((state, held))
                    print(f"  {state} held {describe(held)}", file=sys.stderr)
                    changed_at = time.monotonic()
                else:
                    changed_at = time.monotonic()
                print(f"{now}  +{describe(elapsed):>6}  {current}{'  ' + note if note else ''}")
                rows.append({
                    "timestamp": now,
                    "elapsed_seconds": round(elapsed, 1),
                    "state": current,
                    "coordinator_last_seen": seen,
                    "note": note,
                })
                state = current

            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped", file=sys.stderr)

    if state is not None:
        spells.append((state, time.monotonic() - changed_at))

    if args.out:
        with open(args.out, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]) if rows else
                                    ["timestamp", "elapsed_seconds", "state", "coordinator_last_seen", "note"])
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nwrote {len(rows)} transitions to {args.out}", file=sys.stderr)

    summarise(spells, time.monotonic() - started)


def summarise(spells, total):
    online = [held for was, held in spells if was == "online"]
    offline = [held for was, held in spells if was == "offline"]
    print("\n--- summary ---", file=sys.stderr)
    print(f"observed for {describe(total)}", file=sys.stderr)
    print(f"online spells:  {len(online)}" + (f"  longest {describe(max(online))}  shortest {describe(min(online))}" if online else ""), file=sys.stderr)
    print(f"offline spells: {len(offline)}" + (f"  longest {describe(max(offline))}" if offline else ""), file=sys.stderr)
    if online:
        print(f"online {sum(online) / total * 100:.0f}% of the observation", file=sys.stderr)
    # The question the issue asks is how long it survives, so say it plainly.
    if len(online) == 1 and not offline:
        print("stayed online throughout", file=sys.stderr)
    elif online:
        print(f"first disconnect after {describe(online[0])}", file=sys.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("node", help="node name or id as the coordinator lists it")
    parser.add_argument("--headscale", default="headscale",
                        help="command that reaches the coordinator, e.g. 'ssh pond-coordinator headscale'")
    parser.add_argument("--interval", type=float, default=15.0, help="seconds between polls (default 15)")
    parser.add_argument("--duration", type=float, default=0.0, help="stop after this many seconds (default: until Ctrl-C)")
    parser.add_argument("--out", help="write observed transitions to this CSV")
    watch(parser.parse_args())
