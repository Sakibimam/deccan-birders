import { keccak256 } from 'js-sha3'
import { SwarmIdClient } from '@snaha/swarm-id'
import type { ConnectionInfo } from '@snaha/swarm-id'
import {
  FEED_TOPIC,
  INDEX_FORMAT,
  IFRAME_ORIGIN,
  READ_ENDPOINT,
  SUBSIDISED_GATEWAY_URL,
} from './config'
import { UploadFailure, classifyThrown, describeUnavailable } from './errors'
import type { IndexEntry, SightingIndex, SightingPhoto, SightingRecord } from './record'
import { buildIndex } from './record'
import { feedIdentifier, feedPayload, nextFeedIndex } from './feed-v1'

let client: SwarmIdClient | null = null
let initialising: Promise<SwarmIdClient> | null = null

export function getClient(): SwarmIdClient {
  if (!client) throw new Error('Swarm ID client not initialised')
  return client
}

/**
 * Idempotent. React StrictMode runs effects twice in development, and a second
 * SwarmIdClient racing the first produced a real, user-visible bug: a fresh page
 * load showed an error about a sighting that had never been filed. One in-flight
 * initialisation is shared by every caller.
 */
export function initSwarmId(onChange: (info: ConnectionInfo) => void): Promise<SwarmIdClient> {
  if (initialising) return initialising
  initialising = createClient(onChange)
  return initialising
}

async function createClient(onChange: (info: ConnectionInfo) => void): Promise<SwarmIdClient> {
  client = new SwarmIdClient({
    iframeOrigin: IFRAME_ORIGIN,
    // Without this, every first-time user has canUpload === false.
    subsidisedGatewayUrl: SUBSIDISED_GATEWAY_URL,
    metadata: {
      name: 'Deccan Birders',
      description: 'File a bird sighting to your own Swarm storage.',
    },
    onConnectionChange: onChange,
  })
  try {
    await client.initialize()
  } catch (error) {
    // Let the next mount retry rather than wedging the app permanently.
    initialising = null
    client = null
    throw error
  }
  return client
}

/**
 * THE CAPABILITY GATE.
 *
 * Nothing in this file uploads without calling this first. It throws a typed
 * UploadFailure carrying a specific reason, so the caller never has to guess
 * why a write is impossible and the user never sees "something went wrong".
 */
function requireUploadCapability(c: SwarmIdClient): void {
  const info = c.connectionInfo
  const signedIn = Boolean(info.identity)
  if (!signedIn || !info.canUpload) {
    throw describeUnavailable(info.uploadUnavailableReason, signedIn)
  }
}

/**
 * Upload options used on every write.
 *
 * `pin` and `tag` are deliberately absent. Uploads here may travel the
 * subsidised gateway path, and the public gateway's CORS allow-list refuses
 * Swarm-Pin and Swarm-Tag — which surfaces in the browser as a bare
 * "Failed to fetch" with nothing useful in the console. They are not worth the
 * hour they cost to diagnose, so no gateway-capable upload sets them.
 */
const GATEWAY_SAFE_UPLOAD = { deferred: false } as const

/** Raw bytes -> /bytes. Read back from /bytes. Never through /bzz. */
async function uploadBytes(c: SwarmIdClient, bytes: Uint8Array): Promise<string> {
  requireUploadCapability(c)
  try {
    const result = await c.uploadData(bytes, GATEWAY_SAFE_UPLOAD)
    return result.reference.toString()
  } catch (error) {
    if (error instanceof UploadFailure) throw error
    throw classifyThrown(error)
  }
}

export async function uploadPhoto(c: SwarmIdClient, file: File): Promise<SightingPhoto> {
  requireUploadCapability(c)
  if (file.size > 8 * 1024 * 1024) {
    throw new UploadFailure(
      'photo-too-large',
      `“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB.`,
      'Photos must be under 8 MB. Reduce the size and try again — the rest of the sighting is unaffected.',
    )
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const reference = await uploadBytes(c, bytes)
  return {
    swarmReference: reference,
    contentType: file.type || 'application/octet-stream',
    byteLength: bytes.byteLength,
  }
}

const encoder = new TextEncoder()

/**
 * Stores one sighting and republishes the owner's index behind their feed.
 *
 * The feed is what makes the records findable by anyone later: it is keyed to
 * the user's own Swarm ID app address plus a documented topic, so a reader
 * needs those two public values and nothing else.
 */
export async function publishSighting(
  c: SwarmIdClient,
  record: SightingRecord,
  existing: IndexEntry[],
): Promise<{ sightingReference: string; indexReference: string }> {
  requireUploadCapability(c)

  const sightingReference = await uploadBytes(c, encoder.encode(JSON.stringify(record)))

  const entry: IndexEntry = {
    id: record.id,
    reference: sightingReference,
    observedDate: record.observed.date,
    species: record.species.commonName,
  }
  const index = buildIndex(record.observer.swarmAddress, [entry, ...existing])
  const indexReference = await uploadBytes(c, encoder.encode(JSON.stringify(index)))

  try {
    const topicHex = keccakTopic(FEED_TOPIC)
    const index = await nextFeedIndex(READ_ENDPOINT, record.observer.swarmAddress, topicHex)
    const soc = c.makeSOCWriter()
    await soc.rawUpload(
      feedIdentifier(topicHex, index),
      feedPayload(indexReference),
      GATEWAY_SAFE_UPLOAD,
    )
  } catch (error) {
    throw new UploadFailure(
      'feed-write-failed',
      'The sighting was stored, but your public list could not be updated.',
      'The record itself is safe on Swarm. Try filing again to refresh the list, or share the reference below directly.',
      `${error instanceof Error ? error.message : String(error)} · sighting reference ${sightingReference}`,
    )
  }

  return { sightingReference, indexReference }
}

/**
 * Loads the signed-in user's sightings FROM SWARM.
 *
 * This is the read path on startup, and it deliberately touches no local
 * storage at all. If it did, the app would be a local database with a Swarm
 * backup, and the records would not really be the user's.
 */
export async function loadIndexFromSwarm(owner: string): Promise<SightingIndex | null> {
  const topicHex = keccakTopic(FEED_TOPIC)
  const feedUrl = `${READ_ENDPOINT.replace(/\/$/, '')}/feeds/${owner.replace(/^0x/, '')}/${topicHex}?type=sequence`

  const feedResponse = await fetch(feedUrl)
  // A feed with no updates is a normal first-run state, not an error.
  if (feedResponse.status === 404) return null
  if (!feedResponse.ok) throw new Error(`feed lookup failed (HTTP ${feedResponse.status})`)

  // Bee dereferences the feed and returns the stored document itself, with its
  // reference in the ETag header. Some deployments return a {reference} envelope
  // instead, so handle both rather than assuming the shape.
  const body = (await feedResponse.json()) as Partial<SightingIndex> & { reference?: string }
  if (body && body.format === INDEX_FORMAT) return body as SightingIndex
  if (typeof body?.reference === 'string') {
    // Written with uploadData -> /bytes, so read back from /bytes.
    const indexResponse = await fetch(`${READ_ENDPOINT.replace(/\/$/, '')}/bytes/${body.reference}`)
    if (!indexResponse.ok) throw new Error(`index fetch failed (HTTP ${indexResponse.status})`)
    return (await indexResponse.json()) as SightingIndex
  }
  return null
}

/**
 * keccak256 of the topic string, matching Bee's feed topic derivation.
 *
 * Deliberately NOT done with bee-js. bee-js imports Node's `stream` module,
 * which Vite shims to an empty browser module — the build warns that `Readable`
 * is not exported, and any code path that touched it would fail at runtime.
 * Pulling 475 KB and a broken shim into the browser to hash one string is a bad
 * trade, so this uses the hash function directly, exactly as the reader does.
 */
export function keccakTopic(topic: string): string {
  return keccak256(topic)
}
