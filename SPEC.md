# Deccan Birders Sighting Record — format specification v1

This document is the contract. Any software that can read JSON and fetch bytes
from Swarm can read these records using nothing but this page. You do not need
the app that wrote them, and you do not need this repository.

That is the whole point. The group has lost its records three times to software
that was the only thing able to read them.

---

## 1. Where the records are

Each birder has one **feed**, identified by two public values:

| | |
|---|---|
| **owner** | a 20-byte Ethereum-style address, hex, no `0x` prefix |
| **topic** | the exact string `deccan-birders-sightings-v1`, hashed with keccak256 |

The feed's latest update points at an **index document**. The index lists every
sighting. Each sighting is a separate Swarm object.

```
feed(owner, topic)  ──▶  index.json  ──▶  sighting.json ──▶ photo bytes
                                     ──▶  sighting.json
                                     ──▶  sighting.json
```

Nothing else is needed. There is no database, no server, and no account.

### Resolving the feed over HTTP

```
GET {bee}/feeds/{owner}/{topicHex}?type=sequence
→ { "reference": "<index reference>" }

GET {bee}/bytes/{index reference}
→ the index document below
```

`{bee}` is any Bee node or gateway, e.g. `https://api.gateway.ethswarm.org`.

**`topicHex` is `keccak256("deccan-birders-sightings-v1")`**, which is:

```
275d7b533f511b6cb4c3c21786843bdbcfa6bdc8a51be8f7b01f0016ec17861a
```

Recompute it yourself at any time with `npm run topic`. The *string* is
canonical; the hex is a convenience so a reader with no keccak library can
still resolve the feed.

> Raw objects are uploaded to `/bytes` and **must be read back from `/bytes`**.
> Fetching a bytes reference through `/bzz` returns a redirect and then a 404.

---

## 2. The index document

```json
{
  "format": "deccan-birders.index",
  "formatVersion": 1,
  "specUrl": "https://github.com/Sakibimam/deccan-birders/blob/main/SPEC.md",
  "owner": "a1b2c3…",
  "updatedAt": "2026-09-19T08:14:02.000Z",
  "count": 2,
  "sightings": [
    { "id": "…", "reference": "…", "observedDate": "2026-09-18", "species": "Indian Pitta" }
  ]
}
```

`sightings[].reference` is where the full record lives. The other fields are
duplicated from the record so a reader can render a list without fetching
everything; the record itself is always authoritative.

Newest first. `count` must equal `sightings.length`.

---

## 3. The sighting record

```json
{
  "format": "deccan-birders.sighting",
  "formatVersion": 1,
  "specUrl": "https://github.com/Sakibimam/deccan-birders/blob/main/SPEC.md",

  "id": "9f8c1e52-7a41-4b0e-9f1d-2c6a5e0b7d33",
  "recordedAt": "2026-09-19T08:12:44.000Z",

  "observed": {
    "date": "2026-09-18",
    "time": "06:40",
    "timeZone": "Asia/Kolkata"
  },

  "species": {
    "commonName": "Indian Pitta",
    "scientificName": "Pitta brachyura"
  },

  "count": 2,
  "countIsEstimate": false,

  "location": {
    "latitude": 17.3850,
    "longitude": 78.4867,
    "coordinateSystem": "WGS84",
    "accuracyMetres": 30,
    "placeName": "Ameenpur Lake, Hyderabad"
  },

  "observer": {
    "name": "Meera",
    "swarmAddress": "a1b2c3…"
  },

  "notes": "Two birds calling from the scrub on the north bank.",

  "photos": [
    { "swarmReference": "…", "contentType": "image/jpeg", "byteLength": 184320 }
  ]
}
```

### Field rules

| Field | Type | Required | Notes |
|---|---|---|---|
| `format` | string | yes | Exactly `deccan-birders.sighting` |
| `formatVersion` | integer | yes | `1` |
| `id` | string | yes | UUID v4, stable for the life of the record |
| `recordedAt` | string | yes | RFC 3339, **UTC**, when it was filed |
| `observed.date` | string | yes | `YYYY-MM-DD`, the date **the bird was seen** |
| `observed.time` | string | no | `HH:MM`, 24-hour, local to `timeZone` |
| `observed.timeZone` | string | yes | IANA name, e.g. `Asia/Kolkata` |
| `species.commonName` | string | yes | As the observer wrote it |
| `species.scientificName` | string | no | Binomial, when known |
| `count` | integer | yes | Number of individuals, `>= 1` |
| `countIsEstimate` | boolean | no | Default `false` |
| `location.latitude` | number | yes | **Decimal degrees**, −90…90 |
| `location.longitude` | number | yes | **Decimal degrees**, −180…180 |
| `location.coordinateSystem` | string | yes | `WGS84` |
| `location.accuracyMetres` | number | no | Radius of uncertainty |
| `location.placeName` | string | no | Free text, never the only location data |
| `observer.name` | string | yes | Display name |
| `observer.swarmAddress` | string | yes | The feed owner who filed it |
| `notes` | string | no | Free text |
| `photos[]` | array | no | May be empty or absent |

### Two rules that exist because of how this group lost data before

1. **Location is always numeric.** A previous app exported the location column
   as `"near the usual spot"`. `latitude` and `longitude` are required decimal
   degrees with a stated coordinate system. `placeName` is an extra, never a
   substitute.
2. **Dates are unambiguous.** `observed.date` is ISO `YYYY-MM-DD` with a
   separate IANA `timeZone`, so no reader has to guess between `03/04/2026`
   meaning March and April, or which midnight a sighting fell on.

---

## 4. Photos

`photos[].swarmReference` is a raw Swarm reference. Fetch it from `/bytes`:

```
GET {bee}/bytes/{swarmReference}
```

The bytes are the image exactly as uploaded. `contentType` tells you how to
render it; do not infer it from a file extension, because there isn't one.

---

## 5. Forward compatibility

- Readers **must ignore unknown fields** rather than failing.
- Readers **must check `format` and `formatVersion`** and refuse politely on a
  major version they do not know.
- Writers **must not** repurpose an existing field's meaning. Add a new one.

A record that omits any required field is invalid and a reader may skip it, but
it should say which record it skipped and why rather than failing silently.
