# What the app reads from the Pond

Screens used to show invented data: a real person's name and email, "6 devices", "72°F", Lo-fi Beats playing. This file records what each screen reads now, from which endpoint, and what it shows when a read fails. The rule throughout: **show only what the Pond said.** A read that fails is *unknown*, never zero or empty, because zero is a claim about somebody's home and a request that did not come back has claimed nothing.

Everything here is read through `services/api-client.ts`; no screen fetches on its own.

## Who this phone belongs to

`GET /api/v1/devices/self` (goose-in-a-pond#390) returns this device and the household member it is attributed to. The phone never names itself: the Pond reads the device off the token it issued at pairing, and the attribution comes from the pairing code. The response is for **display only**. It proves nothing to the Pond and grants nothing.

| Answer | Shown |
|---|---|
| `profile: { id, display_name }` | the member's name |
| `profile: null` | no name. Nobody has claimed this device, which is the normal case, because pairing happens before anyone says who they are. |
| `404` / `405` | no name, not logged. An older Pond without the route answers 405, because the GET falls through to `/devices/{id}`. |
| `503` or a network failure | no name, logged. A Pond that tried and failed is not the same as one with nothing to say. |

`memberOf()` and `isSelfUnsupported()`, read as part of `readHousehold()` in `view-models/use-household.ts`.

## The profile header

| Shown | Source |
|---|---|
| Name and avatar initial | the member, above. The initial is taken by code point, so a name starting outside the Basic Multilingual Plane is not cut in half. With no member, a home icon. |
| Which Pond | `GET /api/v1/system/info` → `hostname`. This works for existing pairings, with no re-pair needed. |
| Devices | `GET /api/v1/devices`, the same count the Devices tab shows |
| Rooms | the Devices tab's own `groupByRoom`, not counting Unassigned, which is a fallback rather than a room anyone named |
| Routines | `GET /api/v1/schedules` |
| Users | `GET /api/v1/profiles` |

There is no email line and no plan badge. A profile is an id, a name and an avatar, with no account behind it, and there is no entitlement for a badge to reflect.

Each figure is its own read, settled independently, so a Pond that cannot list its schedules still shows its device count. **A failed read shows a dash.** `readHousehold()`, `settledCount()` and `countRooms()` in `view-models/use-household.ts`.

## How this is tested

The reads live in plain async functions that take the client as an argument, `readHousehold(client)`, rather than inside the hooks. That lets the whole behaviour be tested with a fake client and no renderer: partial failure, an older Pond's 405, and a Pond that tried and failed. It is what defeated a provider-level test earlier. The hooks set state only in the promise's callback, which is also what `react-hooks/set-state-in-effect` asks for.

Each rule was checked by breaking it on purpose: counting a failed read as zero fails two tests, and treating the 405 as a failure fails two others.

## Known gaps

- **Names need a profile.** With no household profiles, or a pairing code not bound to one, there is no name to show, and that is correct.
- **`Schedule` in `services/types.ts` does not match the wire.** It declares `name`, `enabled` and `prompt`, and the Pond sends none of them; it sends `label`, `paused` and a `kind`. Only `.length` is read here, so this screen is unaffected. Anything reading those fields would get `undefined`, which matters for #14.
