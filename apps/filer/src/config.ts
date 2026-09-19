/**
 * Public configuration. Nothing here is a secret: the gateway is the Swarm
 * Foundation's public one and the iframe origin is Swarm ID's own domain.
 * Both may be overridden at build time by a VITE_ environment variable.
 */

/** Swarm ID's hosted identity UI. */
export const IFRAME_ORIGIN = import.meta.env.VITE_SWARM_ID_ORIGIN ?? 'https://swarm-id.snaha.net'

/**
 * A fresh Swarm ID account owns no postage batch, so without this every
 * first-time user gets `canUpload: false` and their first sighting fails.
 * Configuring it up front is the difference between an app that works for
 * Meera and one that only works for people who already hold stamps.
 */
export const SUBSIDISED_GATEWAY_URL =
  import.meta.env.VITE_SUBSIDISED_GATEWAY ?? 'https://api.gateway.ethswarm.org/'

/**
 * Read endpoint used to resolve feeds and fetch raw bytes. Unauthenticated and
 * public — never put a URL containing a token or credentials here.
 */
export const READ_ENDPOINT = import.meta.env.VITE_READ_ENDPOINT ?? 'https://api.gateway.ethswarm.org'

/** The feed topic. Canonical, documented in SPEC.md, never randomly generated. */
export const FEED_TOPIC = 'deccan-birders-sightings-v1'

/** Format identifiers written into every stored object. See SPEC.md. */
export const SIGHTING_FORMAT = 'deccan-birders.sighting'
export const INDEX_FORMAT = 'deccan-birders.index'
export const FORMAT_VERSION = 1

export const SPEC_URL =
  'https://github.com/Sakibimam/deccan-birders/blob/main/SPEC.md'
