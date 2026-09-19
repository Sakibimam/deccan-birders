import { FORMAT_VERSION, INDEX_FORMAT, SIGHTING_FORMAT, SPEC_URL } from './config'

/**
 * The stored shapes. These are written into the uploaded bytes exactly as
 * declared here, and documented field-by-field in SPEC.md at the repo root.
 *
 * Every stored object names its own format and version. A reader that has
 * never seen this code can look at one object and work out what it is.
 */

export interface SightingPhoto {
  swarmReference: string
  contentType: string
  byteLength: number
}

export interface SightingRecord {
  format: typeof SIGHTING_FORMAT
  formatVersion: number
  specUrl: string
  id: string
  recordedAt: string
  observed: { date: string; time?: string; timeZone: string }
  species: { commonName: string; scientificName?: string }
  count: number
  countIsEstimate?: boolean
  location: {
    latitude: number
    longitude: number
    coordinateSystem: 'WGS84'
    accuracyMetres?: number
    placeName?: string
  }
  observer: { name: string; swarmAddress: string }
  notes?: string
  photos?: SightingPhoto[]
}

export interface IndexEntry {
  id: string
  reference: string
  observedDate: string
  species: string
}

export interface SightingIndex {
  format: typeof INDEX_FORMAT
  formatVersion: number
  specUrl: string
  owner: string
  updatedAt: string
  count: number
  sightings: IndexEntry[]
}

export interface SightingInput {
  commonName: string
  scientificName?: string
  date: string
  time?: string
  count: number
  countIsEstimate?: boolean
  latitude: number
  longitude: number
  accuracyMetres?: number
  placeName?: string
  observerName: string
  notes?: string
}

export function buildSighting(
  input: SightingInput,
  observerAddress: string,
  photos: SightingPhoto[],
): SightingRecord {
  return {
    format: SIGHTING_FORMAT,
    formatVersion: FORMAT_VERSION,
    specUrl: SPEC_URL,
    id: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
    observed: {
      date: input.date,
      ...(input.time ? { time: input.time } : {}),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
    species: {
      commonName: input.commonName.trim(),
      ...(input.scientificName?.trim() ? { scientificName: input.scientificName.trim() } : {}),
    },
    count: input.count,
    countIsEstimate: input.countIsEstimate ?? false,
    location: {
      latitude: input.latitude,
      longitude: input.longitude,
      coordinateSystem: 'WGS84',
      ...(input.accuracyMetres !== undefined ? { accuracyMetres: input.accuracyMetres } : {}),
      ...(input.placeName?.trim() ? { placeName: input.placeName.trim() } : {}),
    },
    observer: { name: input.observerName.trim(), swarmAddress: observerAddress },
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(photos.length ? { photos } : {}),
  }
}

export function buildIndex(owner: string, entries: IndexEntry[]): SightingIndex {
  return {
    format: INDEX_FORMAT,
    formatVersion: FORMAT_VERSION,
    specUrl: SPEC_URL,
    owner,
    updatedAt: new Date().toISOString(),
    count: entries.length,
    sightings: entries,
  }
}

/** Rejects records the spec calls invalid, before anything is spent storing them. */
export function validate(input: SightingInput): string | null {
  if (!input.commonName.trim()) return 'Species name is required.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'Date must be a real calendar date.'
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)
    return 'Latitude must be between −90 and 90 degrees.'
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180)
    return 'Longitude must be between −180 and 180 degrees.'
  if (!Number.isInteger(input.count) || input.count < 1) return 'Count must be a whole number, at least 1.'
  if (!input.observerName.trim()) return 'Your name is required, so the record says who saw it.'
  return null
}
