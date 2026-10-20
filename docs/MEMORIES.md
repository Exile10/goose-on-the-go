# Memories

The Memories screen reads and writes the Pond's own `MemoryFragment`
(`pond-core/src/user_data/domain/memory.rs` in goose-in-a-pond). It used to show a mock
with `category`, `pinned`, `icon` and `time`, none of which exist on the Pond. This page
records how those ideas map onto real fields.

## Routes

| Method | Path | Used for |
|---|---|---|
| GET | `/api/v1/memories` | The list: the household's 50 most recent. No limit or filter is taken. |
| POST | `/api/v1/memories` | Add: `content`, and optionally `segment` and `tier`. |
| PUT | `/api/v1/memories/{id}` | Reword (`content`), keep or let fade (`tier`). Each is sent on its own. |
| DELETE | `/api/v1/memories/{id}` | Forget. |
| POST | `/api/v1/memory/consolidate` | Tidy up now. Streams each stage as server-sent events. |
| POST | `/api/v1/memory/consolidate/stop` | Stop a tidy-up between stages. |

## How the screen's ideas map

| On screen | Pond field | Why |
|---|---|---|
| Filter chips | `segment` | The Pond classifies every extracted memory into one of eight segments, and the segment sets its default importance and tier. Only segments that appear in the list are offered. |
| "Kept" badge and Keep switch | `tier == "permanent"` | Decay cleanup skips the permanent tier: it is never archived or pruned for age. Consolidation never prunes it, and anything merged or split from it stays kept. |
| Date | `created_at` | |

**Not a reserved tag, not an importance threshold.** Decay cleanup reads `tier`,
`importance`, `decay_rate` and `access_count`; it never reads tags. A `pinned` tag
would look pinned on the phone while the memory faded and was archived on the Pond. A
threshold on `importance` would not stop decay either, because decay multiplies importance
down over time regardless.

**The old "Reminder" chip is gone.** Reminders are their own table and route
(`/api/v1/reminders`), not a kind of memory.

**The old icon is gone.** It was decoration chosen per mock entry; the segment badge
carries the same information.

## Keeping a memory

The Keep switch is on the add sheet and the edit sheet. Keeping sends `tier: "permanent"`.
Letting a memory fade sends its segment's default tier (`unkeptTier`): short for "Right
now", long for everything else, including "About you", whose default is permanent and so
would not fade at all.

The tier is always sent alone, never beside new words. A Pond from before
jarida-io/goose-in-a-pond#553 ignores `tier` next to `content` and still answers 204, which
would show a keep that did not happen. Sent alone it is refused with a 422, and the sheet
says the Pond needs an update. When both change, the keep goes first, so a refused keep
leaves the words alone too.

Consolidation guards kept memories from jarida-io/goose-in-a-pond#551: a prune of one is
refused, a merge with one stays kept, and a split of one keeps every piece. An older Pond
can still merge a kept memory into one that is not kept.

## Consolidation progress

A tidy-up started on the phone shows each stage as the Pond reports it: reviewing, the
suggested changes being challenged, the judge ruling, and the accepted changes being
applied, then a tally. The list reloads when it ends.

The Pond also runs consolidation on its own timer when `memory_consolidation_enabled` is
on, but it has no route that reports a run already going, so those runs are not shown.
A `501` means consolidation is switched off in the Pond's settings, or missing from its
build; the screen tells the two apart by the Pond's `error` text (`CONSOLIDATION_NOT_BUILT`
in `services/api-client.ts`), because one is a setting the owner can turn on and the other
needs a different build. Stop only asks: the run ends on the Pond's `cancelled` frame, and a
Stop that does not reach the Pond says so on the card.

## Real by default

`memory` is in `REAL_BY_DEFAULT` (`providers/server-provider.tsx`), so a release build reads
the Pond's memories and can tidy up. Before that it showed `SAMPLE_MEMORIES` as the
household's, with no way to switch, because the Developer screen exists only in dev. An empty
Pond shows the empty state, never the samples.

After an add, reword, keep or forget the Pond accepts, the list is read back quietly, so what
is shown is what the Pond holds rather than the local edit.

## Access and scope

Every memory route sits behind the ordinary bearer-token check: a paired phone reaches all of
them, and none is host-only. A `403` that is not the onboarding guard gets its own sentence
(`memories.errors.forbidden`) rather than the generic one, since no banner explains it.

What the Pond does not do, as of 2026-10-19 (goose-in-a-pond `routes.rs`, `list_memories`,
`update_memory`, `delete_memory`):

- **No per-member scoping.** The list is read with `ProfileScope::Household`, which filters
  nothing: every member's memories, personal ones included, reach every paired phone. A memory
  added from the phone is saved with no `profile_id`, so it is household-wide.
- **Reword, re-tier and forget take any id.** None checks who owns the memory, and an id that
  matches nothing still answers 204.
- **No way to change a memory's segment.** `PUT /memories/{id}` takes `content` and `tier`
  only, so the edit sheet offers the words and the keep, and the segment is chosen once, when
  the memory is added.
