# Privacy policy — Goose On The Go

**Status: draft. Not yet published.** Five facts below are marked `[NEEDS ANSWER]` and
cannot be settled from the app's source code. This document must not be hosted, linked
from the app, or submitted to either store until every one of them is filled in. See
`docs/DATA-SAFETY.md` for the evidence behind everything that is filled in, and for the
list of what is not.

Last updated: [NEEDS ANSWER — date of publication]

---

## The short version

Goose On The Go is a remote control for a server you own. Almost everything the app does
happens between your phone and that server, and nothing about it passes through us.

We are not a cloud service holding your data. There is no account with us, no analytics,
no advertising, and no third party watching what you do in the app. If you never turn on
remote access, your phone and your Pond never talk to us at all.

The rest of this document says exactly what happens when you do turn it on, because a
promise like the one above is only worth anything if the exceptions are stated plainly.

## What stays on your phone

Your phone keeps the credentials for your Pond in the device's own protected storage — the
Keychain on iOS, EncryptedSharedPreferences on Android. That means your session token, the
token used to renew it, your Pond's verified identity, and a random identifier generated on
your phone when you install the app.

That identifier is how your Pond recognises this phone when you pair with it again, instead
of gradually filling up with duplicate entries. It is generated on your device, it is not
derived from anything about your hardware, and it goes nowhere except to your own Pond.

Your phone also keeps ordinary preferences: your Pond's address on your network, which
screen you were last on, your settings. None of this leaves your phone.

## What your Pond receives

Everything the app does functionally — conversations, devices, schedules, everything —
happens between your phone and your Pond, over an encrypted connection that your phone
verifies is really your Pond and not something pretending to be it.

Your Pond is your hardware, in your home. Data that reaches it has not left your household,
and we have no access to it.

## Remote access, if you choose it

You can use the app without remote access, and the app will ask rather than assume. If you
decline, nothing in this section happens.

Remote access lets you reach your Pond when you are not at home. To do that, your phone and
your Pond have to be introduced to each other across the internet, and that introduction is
made by a coordination service we operate.

**What that service learns:**

- The cryptographic keys that identify your phone as a device on your own private network.
  These identify a device, not a person.
- The private network address assigned to your phone.
- When your phone connects and disconnects.

**What it does not learn:** anything you do. The connection between your phone and your
Pond is encrypted end to end. The coordination service introduces the two and then is not
part of the conversation. If your phone and your Pond cannot reach each other directly, the
traffic is passed through a relay, which carries it already encrypted and cannot read it.

Turning on remote access also requires approval on the Pond itself, from your home network.
We cannot enable it for you, and neither can anyone who has only your phone.

**Retention:** [NEEDS ANSWER — how long connection records and device keys are kept, and
what happens to them when a user signs out]

## Notifications

When your Pond has something to tell you, it sends your phone a push notification through
Google's or Apple's notification service, because that is the only way to wake an app that
is not running.

Those messages are **empty**. They contain no text and no detail about what happened. Your
phone wakes up, connects to your Pond directly, and fetches the actual content from it.

This is deliberate, and it is the reason the app is built this way: it means the content of
your notifications never passes through Google or Apple. What they see is that your device
was pinged. What was in it, they do not have.

To make this work, your phone gives its notification token to your Pond, and your Pond
talks to Google or Apple directly. We are not in that path either.

## Camera

The app uses your camera to read QR codes: the pairing code your Pond displays, and the
setup code on a smart-home device you are adding.

The code is read on your phone. No photograph is saved, and no image is sent anywhere.

## What we do not do

- We do not use analytics, of any kind, from anyone.
- We do not use crash-reporting or attribution services.
- We do not serve advertising, and we do not use an advertising identifier.
- We do not ask for your location, your contacts, or your photo library.
- We do not track you across other apps or websites, and we never will.

These are not intentions. There is no third-party code in the app capable of doing any of
them.

## Children

The app is not directed at children. [NEEDS ANSWER — confirm the age rating being submitted
to each store, so this section matches it]

## Your choices and your rights

- **Decline remote access.** The app works without it, and you can turn it down when asked.
- **Turn it off later.** Signing out releases this phone's access to your Pond, including
  its remote access. You pair again at home to come back.
- **Your data is on your own hardware.** Deleting it is something you do on your Pond, not
  something you ask us for. We do not hold a copy.

For the records held by the coordination service, and for any request about them:
[NEEDS ANSWER — contact address, and the deletion process]

## Who we are

[NEEDS ANSWER — the legal entity acting as data controller for the coordination service,
its registered address, and the countries it operates in. Both stores ask, and a privacy
policy without an identifiable controller is not acceptable to either.]

## Changes to this policy

If this policy changes in a way that affects what leaves your device, we will say so in the
app rather than quietly updating this page. The date at the top always reflects the current
version.

## Contact

[NEEDS ANSWER — a monitored address. Both stores check that it works.]
