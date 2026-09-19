/**
 * ACCEPTANCE TEST
 *
 * Walks the exact path the independent reader walks — same URLs, same order,
 * same format checks — against real data on Swarm. If this passes, a stranger
 * with only the owner address, the topic and SPEC.md can read the records.
 *
 *   node scripts/verify.mjs <owner> [endpoint]
 */
import { Topic } from '@ethersphere/bee-js'

const owner = (process.argv[2] ?? '').replace(/^0x/, '')
const base = (process.argv[3] ?? process.env.BEE_API_URL ?? 'http://localhost:1633').replace(/\/$/, '')
if (!owner) { console.error('usage: node scripts/verify.mjs <owner> [endpoint]'); process.exit(1) }

const SIGHTING_FORMAT = 'deccan-birders.sighting'
const INDEX_FORMAT = 'deccan-birders.index'
const VERSION = 1
const TOPIC = 'deccan-birders-sightings-v1'

let pass = 0, fail = 0
const ok = (m) => { console.log(`  PASS  ${m}`); pass++ }
const no = (m) => { console.log(`  FAIL  ${m}`); fail++ }

const topicHex = Topic.fromString(TOPIC).toHex()
console.log(`\nowner ${owner}\ntopic ${TOPIC} -> ${topicHex}\nat    ${base}\n`)

// 1. Resolve the feed.
const feedRes = await fetch(`${base}/feeds/${owner}/${topicHex}?type=sequence`)
feedRes.ok ? ok(`feed resolves (HTTP ${feedRes.status})`) : no(`feed lookup HTTP ${feedRes.status}`)
const feedText = await feedRes.text()

let index
try {
  const body = JSON.parse(feedText)
  if (body.format === INDEX_FORMAT) { index = body; ok('feed returned the index document directly') }
  else if (typeof body.reference === 'string') {
    const r = await fetch(`${base}/bytes/${body.reference}`)
    index = await r.json(); ok('feed returned an envelope; index read from /bytes')
  } else no('feed resolved to an unrecognised object')
} catch { no('feed did not resolve to JSON') }

if (index) {
  index.format === INDEX_FORMAT ? ok(`index declares format "${index.format}"`) : no('index format missing')
  index.formatVersion === VERSION ? ok(`index declares version ${index.formatVersion}`) : no('index version missing')
  Array.isArray(index.sightings) ? ok(`index lists ${index.sightings.length} sighting(s)`) : no('index has no sightings array')

  for (const entry of index.sightings ?? []) {
    const res = await fetch(`${base}/bytes/${entry.reference}`)
    if (!res.ok) { no(`/bytes/${entry.reference.slice(0,10)}… HTTP ${res.status}`); continue }
    const rec = await res.json()
    const problems = []
    if (rec.format !== SIGHTING_FORMAT) problems.push('format')
    if (rec.formatVersion !== VERSION) problems.push('formatVersion')
    for (const f of ['id','observed','species','count','location','observer'])
      if (rec[f] === undefined) problems.push(f)
    if (typeof rec.location?.latitude !== 'number') problems.push('location.latitude not numeric')
    if (typeof rec.location?.longitude !== 'number') problems.push('location.longitude not numeric')
    if (!rec.observed?.timeZone) problems.push('observed.timeZone')
    problems.length === 0
      ? ok(`"${rec.species.commonName}" ${rec.observed.date} @ ${rec.location.latitude},${rec.location.longitude} — spec-conformant`)
      : no(`record ${entry.reference.slice(0,10)}… missing/invalid: ${problems.join(', ')}`)
  }

  // The endpoint-family rule: a raw reference must NOT resolve through /bzz.
  const firstRef = index.sightings?.[0]?.reference
  if (firstRef) {
    const bzz = await fetch(`${base}/bzz/${firstRef}`, { redirect: 'follow' })
    bzz.ok
      ? no('/bzz served a raw bytes reference — endpoint families are not distinct here')
      : ok(`/bzz correctly refuses a raw bytes reference (HTTP ${bzz.status}) — reader must use /bytes`)
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
