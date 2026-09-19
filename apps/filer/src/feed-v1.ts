import { keccak256 } from 'js-sha3'

/**
 * Writes feed updates in the format Bee's own /feeds endpoint serves.
 *
 * Why this exists, rather than SwarmIdClient.makeSequentialFeedWriter():
 *
 * That writer produces a v2 feed. Bee reports it as
 * `Swarm-Feed-Resolved-Version: v2`, returns a nonsensical Content-Length, and
 * its ETag is not a fetchable reference — and the PUBLIC GATEWAY returns
 * HTTP 500 for it outright. A reader on the gateway, which is the whole point
 * of this problem, could never resolve it. Feeds written in the v1 layout below
 * resolve correctly on both a local node and the public gateway.
 *
 * The layout, matching bee-js:
 *   identifier = keccak256( topic[32] ‖ index[8, big-endian] )
 *   payload    = timestamp[8, big-endian seconds] ‖ reference[32]
 *
 * The update is a single-owner chunk signed by the user's Swarm ID app key, so
 * the feed belongs to the user, not to this app.
 */

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

function u64be(value: bigint): Uint8Array {
  const buf = new Uint8Array(8)
  new DataView(buf.buffer).setBigUint64(0, value, false)
  return buf
}

export function feedIdentifier(topicHex: string, index: bigint): Uint8Array {
  const topic = hexToBytes(topicHex)
  const idx = u64be(index)
  const joined = new Uint8Array(topic.length + idx.length)
  joined.set(topic, 0)
  joined.set(idx, topic.length)
  return hexToBytes(keccak256(joined))
}

export function feedPayload(referenceHex: string): Uint8Array {
  const timestamp = u64be(BigInt(Math.floor(Date.now() / 1000)))
  const reference = hexToBytes(referenceHex)
  const payload = new Uint8Array(timestamp.length + reference.length)
  payload.set(timestamp, 0)
  payload.set(reference, timestamp.length)
  return payload
}

/**
 * Ask the NETWORK what the next index is. Never counted locally: a counter in
 * localStorage desynchronises the moment the user opens the app on a second
 * device, and this app's whole claim is that the records are not tied to a
 * device.
 *
 * `Swarm-Feed-Index-Next` is listed in Bee's Access-Control-Expose-Headers, so
 * it is readable cross-origin. An empty feed is a normal first run, not an error.
 */
export async function nextFeedIndex(
  endpoint: string,
  owner: string,
  topicHex: string,
): Promise<bigint> {
  const url = `${endpoint.replace(/\/$/, '')}/feeds/${owner.replace(/^0x/, '')}/${topicHex}?type=sequence`
  try {
    const res = await fetch(url)
    if (res.status === 404) return 0n
    if (!res.ok) return 0n
    const next = res.headers.get('swarm-feed-index-next')
    if (next) return BigInt(`0x${next}`)
    const current = res.headers.get('swarm-feed-index')
    if (current) return BigInt(`0x${current}`) + 1n
    return 0n
  } catch {
    return 0n
  }
}
