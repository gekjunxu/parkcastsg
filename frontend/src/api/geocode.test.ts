import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { geocodeQuery, normalizeLocationSuggestions, suggestLocations } from './geocode'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})
test('normalizes valid suggestions and discards malformed coordinates', () => {
  const result = normalizeLocationSuggestions([
    { label: 'One', address: '1 Main', postal: '123456', lat: 1.3, lng: 103.8 },
    { label: 'Bad', address: 'Bad', postal: null, lat: 91, lng: 103.8 },
    { label: '', address: 'Missing label', postal: null, lat: 1.3, lng: 103.8 },
  ])

  assert.deepEqual(result, [{
    label: 'One', address: '1 Main', postal: '123456', lat: 1.3, lng: 103.8,
  }])
})

test('calls the deployment-aware suggestions endpoint and forwards abort signal', async () => {
  let request: Request | undefined
  let signal: AbortSignal | null | undefined
  globalThis.fetch = async (input, init) => {
    signal = init?.signal
    request = new Request(input, init)
    return new Response(JSON.stringify([{ label: 'Marina Bay', lat: 1.28, lng: 103.86 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const controller = new AbortController()

  const result = await suggestLocations(' Marina & Bay ', controller.signal)

  assert.equal(new URL(request!.url).pathname, '/api/v1/locations/suggest')
  assert.equal(new URL(request!.url).searchParams.get('q'), 'Marina & Bay')
  assert.equal(signal, controller.signal)
  assert.equal(result[0].label, 'Marina Bay')
})

test('returns the first suggestion coordinates and propagates upstream failures', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify([
    { label: 'First', lat: 1.2, lng: 103.7 },
    { label: 'Second', lat: 1.3, lng: 103.8 },
  ]), { status: 200 })
  assert.deepEqual(await geocodeQuery('first'), { lat: 1.2, lng: 103.7 })

  globalThis.fetch = async () => new Response('unavailable', { status: 502 })
  await assert.rejects(() => suggestLocations('first'), /Location suggestions failed: 502/)
})
