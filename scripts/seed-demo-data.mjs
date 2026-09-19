/**
 * DEVELOPER TOOL — not part of the app.
 *
 * Writes a couple of spec-conformant sightings to Swarm using a local Bee node,
 * so the independent reader can be tested against real stored data without
 * driving the browser sign-in flow. The filing app itself uses Swarm ID; this
 * exists only to prove the FORMAT and the READER, end to end.
 *
 *   node scripts/seed-demo-data.mjs
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Bee, PrivateKey, Topic } from '@ethersphere/bee-js'

const BEE = process.env.BEE_API_URL ?? 'http://localhost:1633'
const TOPIC = 'deccan-birders-sightings-v1'
const SPEC_URL = 'https://github.com/Sakibimam/deccan-birders/blob/main/SPEC.md'
const KEY_FILE = new URL('../.seed-key', import.meta.url).pathname

const bee = new Bee(BEE)

if (!existsSync(KEY_FILE)) {
  writeFileSync(KEY_FILE, new PrivateKey(randomBytes(32)).toHex(), { mode: 0o600 })
  console.log('created .seed-key (gitignored)')
}
const signer = new PrivateKey(readFileSync(KEY_FILE, 'utf8').trim())
const owner = signer.publicKey().address()

const batches = await bee.stamp.getAll()
const batch = batches.filter((b) => b.usable && b.duration.toDays() > 0.5)
  .sort((a, b) => b.duration.toSeconds() - a.duration.toSeconds())[0]
if (!batch) {
  console.error('No usable postage batch on this node. Nothing seeded.')
  process.exit(1)
}
console.log(`batch ${batch.batchID.toHex()} — ${batch.duration.toDays().toFixed(1)} days left`)

const sightings = [
  {
    commonName: 'Indian Pitta', scientificName: 'Pitta brachyura',
    date: '2026-09-17', time: '06:40', count: 2,
    latitude: 17.5449, longitude: 78.3389, accuracyMetres: 30,
    placeName: 'Ameenpur Lake, Hyderabad', observer: 'Meera',
    notes: 'Two birds calling from the scrub on the north bank.',
  },
  {
    commonName: 'Painted Stork', scientificName: 'Mycteria leucocephala',
    date: '2026-09-18', time: '17:05', count: 14,
    latitude: 17.3316, longitude: 78.4682, accuracyMetres: 50,
    placeName: 'Mir Alam Tank, Hyderabad', observer: 'Meera',
    notes: 'Roosting group, several juveniles.',
  },
]

const entries = []
for (const s of sightings) {
  const record = {
    format: 'deccan-birders.sighting',
    formatVersion: 1,
    specUrl: SPEC_URL,
    id: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
    observed: { date: s.date, time: s.time, timeZone: 'Asia/Kolkata' },
    species: { commonName: s.commonName, scientificName: s.scientificName },
    count: s.count,
    countIsEstimate: false,
    location: {
      latitude: s.latitude, longitude: s.longitude,
      coordinateSystem: 'WGS84', accuracyMetres: s.accuracyMetres,
      placeName: s.placeName,
    },
    observer: { name: s.observer, swarmAddress: owner.toHex() },
    notes: s.notes,
  }
  // Raw JSON -> /bytes, exactly as the app does with uploadData.
  const up = await bee.data.upload(batch.batchID, JSON.stringify(record))
  entries.unshift({
    id: record.id, reference: up.reference.toHex(),
    observedDate: record.observed.date, species: record.species.commonName,
  })
  console.log(`  ${s.commonName} -> ${up.reference.toHex()}`)
}

const index = {
  format: 'deccan-birders.index', formatVersion: 1, specUrl: SPEC_URL,
  owner: owner.toHex(), updatedAt: new Date().toISOString(),
  count: entries.length, sightings: entries,
}
const indexUp = await bee.data.upload(batch.batchID, JSON.stringify(index))
console.log(`index -> ${indexUp.reference.toHex()}`)

const topic = Topic.fromString(TOPIC)
const writer = bee.feed.makeWriter(topic, signer)
await writer.uploadReference(batch.batchID, indexUp.reference)

console.log(`\nSeeded. Point the reader at:`)
console.log(`  owner    ${owner.toHex()}`)
console.log(`  topic    ${TOPIC}`)
console.log(`  endpoint ${BEE}`)
