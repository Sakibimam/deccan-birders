# Deccan Birders

> Meera's one requirement: whatever writes the records must not be the only
> thing that can read them.

Two applications that share no code. One files bird sightings to Swarm under the
birder's own identity. The other reads them back knowing nothing but the
published format. Nobody exports anything.

```
apps/filer     React + Swarm ID. Files a sighting.
apps/reader    One HTML file. Zero imports. Reads sightings.
SPEC.md        The format. The contract between them.
```

## Try it

```bash
npm install
npm run dev        # the filing app  -> http://localhost:5173
npm run reader     # the reader      -> http://localhost:4173
```

The reader asks for an owner address and a topic. Both are shown in the filing
app under **Open these in another app**. Paste them in and the sightings appear
in software that has never seen the filing app's code.

## Why there are two apps

The group has lost its records three times. A forum that closed. A Facebook
group that ate the photos. A birding app that shut down and exported the
location column as `"near the usual spot"`.

Every one of those was software that was the only thing able to read its own
data. So the deliverable here is not an app with an export button — it is a
**format**, documented in [SPEC.md](./SPEC.md), with two independent
implementations to prove the format is real.

`apps/reader/index.html` imports nothing. No React, no bundler, no shared
module, no `package.json`. Its only dependency is a keccak256 implementation
from a CDN, used to turn the documented topic string into a feed topic — a hash
function, not a record parser. It was written the way a fourth app's author
would have to write it: with the stored data and the spec, and nothing else.

## How a record is found

```
feed(owner, topic)  ──▶  index.json  ──▶  sighting.json  ──▶  photo bytes
```

The birder's Swarm ID gives them an **app key address**. That address plus the
documented topic `deccan-birders-sightings-v1` is the whole address of their
records. It is public, it never changes, and it is all a reader needs.

**The list you see on screen is loaded from Swarm, not from the browser.** There
is no local database and no cache in the read path. If there were, the records
would live on the device and Swarm would just be a backup — which is the thing
this project exists not to be.

## Uploading for a user who owns nothing

A fresh Swarm ID account has no postage batch, so a first-time user cannot
upload at all. The client is constructed with a `subsidisedGatewayUrl` so their
uploads are stamped for them:

```ts
new SwarmIdClient({
  iframeOrigin: 'https://swarm-id.snaha.net',
  subsidisedGatewayUrl: 'https://api.gateway.ethswarm.org/',
  metadata: { name: 'Deccan Birders', /* … */ },
})
```

Every write path is gated on `connectionInfo.canUpload` before it is attempted
(`requireUploadCapability` in `apps/filer/src/swarm.ts`), the submit button is
disabled while capability is missing, and the reason is shown on screen.

### Failures say which failure

`no-stamp`, `stamp-expired`, `stamper-failed`, a gateway that refused the
request, a timeout, a photo over the size limit, an invalid record, a feed write
that failed after the record was safely stored — each renders as its own
sentence with its own suggested action and its own reason code. None of them
collapse into "something went wrong", because that is how a group loses three
years of records without noticing.

### Two gateway details that cost people an afternoon

- **`pin` and `tag` are never passed.** The public gateway's CORS allow-list
  refuses `Swarm-Pin` and `Swarm-Tag`, and a refused header appears in the
  browser only as a bare `Failed to fetch` with nothing in the console.
- **Raw bytes go to `/bytes` and come back from `/bytes`.** Fetching a raw
  reference through `/bzz` gives a redirect and then a 404. The acceptance test
  below asserts this rather than trusting it.

## Verify it yourself

```bash
npm run hashcheck                        # filer and reader derive the same topic
node scripts/seed-demo-data.mjs          # needs a local Bee node with a stamp
node scripts/verify.mjs <owner-address>  # walks the reader's exact path
```

`verify.mjs` resolves the feed, reads the index, fetches every sighting, checks
each one against the spec's required fields, and asserts that `/bzz` refuses a
raw reference. Last run:

```
PASS  feed resolves (HTTP 200)
PASS  feed returned the index document directly
PASS  index declares format "deccan-birders.index"
PASS  index declares version 1
PASS  index lists 1 sighting(s)
PASS  "Indian Roller" 2026-09-19 @ 17.39,78.31 — spec-conformant
PASS  /bzz correctly refuses a raw bytes reference (HTTP 404)
7 passed, 0 failed
```

### The acceptance criterion, actually performed

Driven end to end in a real browser, not asserted:

1. Signed in through the real Swarm ID popup, creating a fresh account that
   owns no postage batch — the case every first-time user hits.
2. `canUpload` became true via the subsidised gateway; the filing form is not
   even offered before that.
3. Filed "Indian Roller ×3" at Osman Sagar, Hyderabad.
4. Opened `apps/reader/index.html` — a different application — pointed it at
   the **public gateway** and the owner address, and the sighting rendered:
   species, binomial, numeric coordinates, observer. **Nobody exported
   anything.**

```
PASS  signed in; filing form is offered
PASS  canUpload is true — subsidised gateway covers a user with no stamp
PASS  upload reported success
PASS  the new sighting appears in the list
PASS  1 sighting card(s) rendered
PASS  numeric coordinates rendered (not "near the usual spot")
PASS  no records skipped
```

### Why the feed is written by hand

`SwarmIdClient.makeSequentialFeedWriter()` produces a **v2** feed. Bee reports
it as `Swarm-Feed-Resolved-Version: v2`, returns a nonsensical `Content-Length`,
its `ETag` is not a fetchable reference — and the **public gateway returns HTTP
500 for it outright**. A reader on the gateway could never resolve it, which
would defeat the entire problem.

So `apps/filer/src/feed-v1.ts` writes the update as a single-owner chunk in the
layout Bee's own `/feeds` endpoint serves:

```
identifier = keccak256( topic[32] ‖ index[8, big-endian] )
payload    = timestamp[8, big-endian seconds] ‖ reference[32]
```

signed by the user's Swarm ID app key. Those resolve on a local node *and* the
public gateway — verified end to end below.

The next index is read from the network via the `Swarm-Feed-Index-Next` header,
which Bee lists in `Access-Control-Expose-Headers` so it is readable
cross-origin. It is never counted locally: a counter in `localStorage`
desynchronises the moment the user opens the app on a second device, and this
app's whole claim is that the records are not tied to a device.

> One thing worth knowing, found by testing rather than reading: Bee's
> `/feeds/{owner}/{topic}` endpoint **dereferences the feed and returns the
> stored document itself**, with its reference in the `ETag` header. It does not
> return a `{"reference": "..."}` envelope, which is what most examples imply.
> Both apps handle either shape.

## Secrets

No private key, mnemonic, gift code or authenticated URL appears in any tracked
file. The gateway and iframe origins are public endpoints. The seed tool's key
lives in `.seed-key`, which is gitignored, and it is a developer convenience —
the app itself holds no keys, because the user's identity is their own.

## Versions

`@ethersphere/bee-js` is pinned to **13.1.0** and `@snaha/swarm-id` to **0.4.1**.
bee-js v13 moved every flat method into a namespace (`bee.uploadData` became
`bee.data.upload`), and most examples online are still v12.

## Licence

MIT.
