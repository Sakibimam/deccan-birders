import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConnectionInfo, SwarmIdClient } from '@snaha/swarm-id'
import { FEED_TOPIC, READ_ENDPOINT, SPEC_URL } from './config'
import { UploadFailure, classifyThrown, describeUnavailable } from './errors'
import {
  initSwarmId,
  keccakTopic,
  loadIndexFromSwarm,
  publishSighting,
  uploadPhoto,
} from './swarm'
import { buildSighting, validate } from './record'
import type { IndexEntry, SightingInput, SightingPhoto } from './record'

const today = () => new Date().toISOString().slice(0, 10)

const EMPTY: SightingInput = {
  commonName: '',
  scientificName: '',
  date: today(),
  time: '',
  count: 1,
  latitude: Number.NaN,
  longitude: Number.NaN,
  placeName: '',
  observerName: '',
  notes: '',
}

export default function App() {
  const [client, setClient] = useState<SwarmIdClient | null>(null)
  const [info, setInfo] = useState<ConnectionInfo | null>(null)
  const [form, setForm] = useState<SightingInput>(EMPTY)
  const [photos, setPhotos] = useState<File[]>([])
  const [entries, setEntries] = useState<IndexEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<UploadFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [topicHex, setTopicHex] = useState('')

  useEffect(() => {
    initSwarmId(setInfo)
      .then((c) => {
        setClient(c)
        setInfo(c.connectionInfo)
      })
      .catch((e) => setFailure(classifyThrown(e)))
    setTopicHex(keccakTopic(FEED_TOPIC))
  }, [])

  const owner = info?.appKey?.address ?? ''
  const signedIn = Boolean(info?.identity)
  const canUpload = Boolean(info?.canUpload)

  // The list on screen is loaded from Swarm, never from local storage.
  useEffect(() => {
    if (!owner) return
    loadIndexFromSwarm(owner)
      .then((index) => setEntries(index?.sightings ?? []))
      .catch(() => setNotice('Could not load your earlier sightings from Swarm just now.'))
  }, [owner])

  const capability = useMemo(() => {
    if (!info) return null
    if (canUpload) return null
    return describeUnavailable(info.uploadUnavailableReason, signedIn)
  }, [info, canUpload, signedIn])

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setFailure(null)
      setNotice(null)

      const problem = validate(form)
      if (problem) {
        setFailure(new UploadFailure('invalid-record', problem, 'Correct the field and file again.'))
        return
      }
      if (!client) return

      // Gate: never attempt a write unless capability is confirmed.
      if (!client.connectionInfo.canUpload) {
        setFailure(describeUnavailable(client.connectionInfo.uploadUnavailableReason, signedIn))
        return
      }

      setBusy(true)
      try {
        const uploaded: SightingPhoto[] = []
        for (const file of photos) uploaded.push(await uploadPhoto(client, file))

        const record = buildSighting(form, owner, uploaded)
        const { sightingReference } = await publishSighting(client, record, entries)

        setEntries((prev) => [
          { id: record.id, reference: sightingReference, observedDate: record.observed.date, species: record.species.commonName },
          ...prev,
        ])
        setForm({ ...EMPTY, observerName: form.observerName })
        setPhotos([])
        setNotice('Filed. It is on Swarm under your own identity, readable by any app that has the format.')
      } catch (error) {
        setFailure(error instanceof UploadFailure ? error : classifyThrown(error))
      } finally {
        setBusy(false)
      }
    },
    [client, form, photos, entries, owner, signedIn],
  )

  const set = <K extends keyof SightingInput>(key: K, value: SightingInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setNotice('This browser cannot provide a location. Type the coordinates instead.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set('latitude', Number(pos.coords.latitude.toFixed(5)))
        set('longitude', Number(pos.coords.longitude.toFixed(5)))
        set('accuracyMetres', Math.round(pos.coords.accuracy))
      },
      () => setNotice('Location permission was refused. Type the coordinates instead.'),
    )
  }

  return (
    <main>
      <header>
        <h1>Deccan Birders</h1>
        <p className="sub">
          File a sighting. It is stored on Swarm under your identity, in a format written down in{' '}
          <a href={SPEC_URL} target="_blank" rel="noopener">the spec</a> — so it outlives this app.
        </p>
      </header>

      {!signedIn && (
        <section className="card">
          <h2>Sign in</h2>
          <p>Your sightings are stored under your own Swarm identity, not in our account.</p>
          <button onClick={() => client?.connect()} disabled={!client}>Sign in with Swarm ID</button>
        </section>
      )}

      {capability && signedIn && (
        <section className="card warn">
          <h2>{capability.message}</h2>
          <p>{capability.remedy}</p>
          {capability.detail && <p className="detail">{capability.detail}</p>}
        </section>
      )}

      {signedIn && (
        <form className="card" onSubmit={submit}>
          <h2>What did you see?</h2>

          <label>Species
            <input value={form.commonName} onChange={(e) => set('commonName', e.target.value)}
                   placeholder="Indian Pitta" required />
          </label>
          <label>Scientific name <span className="opt">optional</span>
            <input value={form.scientificName ?? ''} onChange={(e) => set('scientificName', e.target.value)}
                   placeholder="Pitta brachyura" />
          </label>

          <div className="row">
            <label>Date
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
            </label>
            <label>Time <span className="opt">optional</span>
              <input type="time" value={form.time ?? ''} onChange={(e) => set('time', e.target.value)} />
            </label>
            <label>How many
              <input type="number" min={1} value={form.count}
                     onChange={(e) => set('count', Number(e.target.value))} required />
            </label>
          </div>

          <label>Place
            <input value={form.placeName ?? ''} onChange={(e) => set('placeName', e.target.value)}
                   placeholder="Ameenpur Lake, Hyderabad" />
          </label>
          <div className="row">
            <label>Latitude
              <input type="number" step="any" value={Number.isFinite(form.latitude) ? form.latitude : ''}
                     onChange={(e) => set('latitude', Number(e.target.value))} required />
            </label>
            <label>Longitude
              <input type="number" step="any" value={Number.isFinite(form.longitude) ? form.longitude : ''}
                     onChange={(e) => set('longitude', Number(e.target.value))} required />
            </label>
            <button type="button" className="ghost" onClick={useMyLocation}>Use my location</button>
          </div>
          <p className="hint">
            Coordinates are required on purpose. The last app this group used exported the place as
            “near the usual spot”, and those records are gone.
          </p>

          <label>Your name
            <input value={form.observerName} onChange={(e) => set('observerName', e.target.value)}
                   placeholder="Meera" required />
          </label>
          <label>Notes <span className="opt">optional</span>
            <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={3} />
          </label>
          <label>Photos <span className="opt">optional</span>
            <input type="file" accept="image/*" multiple
                   onChange={(e) => setPhotos(Array.from(e.target.files ?? []))} />
          </label>

          <button type="submit" disabled={busy || !canUpload}>
            {busy ? 'Filing…' : 'File this sighting'}
          </button>
          {!canUpload && <p className="hint">Filing is disabled until storage is available — see above.</p>}
        </form>
      )}

      {failure && (
        <section className="card bad">
          <h2>{failure.message}</h2>
          <p>{failure.remedy}</p>
          {failure.detail && <p className="detail">{failure.detail}</p>}
          <p className="detail">reason code: {failure.kind}</p>
        </section>
      )}
      {notice && <section className="card ok"><p>{notice}</p></section>}

      {signedIn && (
        <section className="card">
          <h2>Your sightings <span className="opt">read from Swarm</span></h2>
          {entries.length === 0
            ? <p>Nothing filed yet.</p>
            : <ul className="list">{entries.map((e) => (
                <li key={e.id}><strong>{e.species}</strong><span>{e.observedDate}</span></li>
              ))}</ul>}
          <details>
            <summary>Open these in another app</summary>
            <p>Any reader can fetch your sightings from these two public values:</p>
            <dl>
              <dt>owner</dt><dd className="mono">{owner || '—'}</dd>
              <dt>topic</dt><dd className="mono">{FEED_TOPIC}</dd>
              <dt>topic (hex)</dt><dd className="mono">{topicHex || '—'}</dd>
              <dt>endpoint</dt><dd className="mono">{READ_ENDPOINT}</dd>
            </dl>
            <p>The format is documented at <a href={SPEC_URL} target="_blank" rel="noopener">SPEC.md</a>.</p>
          </details>
        </section>
      )}
    </main>
  )
}
