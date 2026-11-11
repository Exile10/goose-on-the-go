# The ngrok tunnel page

Settings → Connection → **ngrok tunnel** (`app/(stack)/ngrok-tunnel.tsx`). From here a household
sets up its own ngrok account as the way into the Pond from outside the home, and switches between
that and the built-in network. It covers the same ground as the ngrok panel on the Pond's own
screen.

How the phone learns and dials the tunnel's address is in [PINNED_HTTPS.md](PINNED_HTTPS.md); this
page only chooses the route and holds the setup.

## What the page shows

- **Status line.** Which way phones get in now: the built-in network, ngrok at its address, the
  tunnel starting or failed, or the fallback described below.
- **Use ngrok.** On means phones away from home come in through ngrok; off means the built-in
  network. Turning it off asks first, because the tunnel stops.
- **Set up ngrok.** Four steps, each with a link opened in the in-app browser:
  1. Create an account at `dashboard.ngrok.com/signup`.
  2. Add a payment method. ngrok opens TCP addresses only for accounts with a card on file, even
     on the free plan, which is not charged.
  3. Copy the authtoken from the dashboard's *Your Authtoken* page.
  4. Paste it and save. The Pond opens one ngrok session with it before keeping it, so a mistyped
     token is refused here rather than when the tunnel starts.
- **Reserved address (paid plans).** A reserved TCP address (`host:port`, from the dashboard's
  Gateway → TCP Addresses, on the Hobbyist and Pay-as-you-go plans) never changes.

The authtoken is held by the Pond and never sent back. On the phone it exists only as what has been
typed, until the Pond has it.

## The rules, and why

An unreserved ngrok address changes every time the tunnel starts, for example when the Pond
restarts. A phone learns the address only from the Pond on the home network, so a phone away from
home cannot follow a change.

| Action | At home | Away from home |
| --- | --- | --- |
| See the status | yes | yes |
| Save or remove the authtoken | yes | no (`at_home_only`) |
| Set the reserved address | yes | no (`at_home_only`) |
| Switch to the built-in network | yes | yes |
| Switch to ngrok | yes | only with a reserved address (`needs_reserved_address`) |

The Pond enforces every rule; the page only explains them. "At home" is the Pond's decision: the
request came from a directly attached network, never over the tailnet or the tunnel.

## Falling back when the address changes

If the tunnel comes up with an address phones have not learned, and the address is not reserved,
the Pond turns the built-in network back on and reports the new address as `fallback`. The page
says so in the status line. Phones away from home keep reaching the Pond through the built-in
network.

The Pond adopts the new address once the household switches to ngrok again at home (here, or on the
Pond's own screen). The built-in network then goes off again. Open Goose On The Go on the other
phones at home so they pick up the new address too.

With a reserved address the address never changes, so there is no fallback.

## The Pond's routes

All behind the bearer token, on the companion API (`crates/pond-server/src/remote_tunnel.rs`,
`phone_management`):

- `GET /api/v1/remote-access/route`: `{route, atHome, tokenSet, endpoint, reservedAddress,
  reserved, status, fallback, builtInRunning}`.
- `PUT /api/v1/remote-access/route`: `{route: "built_in" | "ngrok", reservedAddress?}`.
- `PUT /api/v1/remote-access/route/token`: `{authtoken}`.
- `DELETE /api/v1/remote-access/route/token`.

A refusal is `{error, code}`; the page matches `code` (`refusalText` in
`view-models/use-ngrok-tunnel.ts`) and never shows the English `error`. A Pond without these routes
answers 404, and the page says it needs an update.

## Code

- `models/ngrok-tunnel.ts`: reading the Pond's answer, the links, `ngrokBlock`, address checks.
- `view-models/use-ngrok-tunnel.ts`: reads and polls through `useLive` (every 30 s, every 5 s while
  the tunnel starts), and the writes.
- Tests: `models/__tests__/ngrok-tunnel.test.ts`, `view-models/__tests__/use-ngrok-tunnel.test.ts`.
