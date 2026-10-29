import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  getCarparkById,
  getCarparksInArea,
  getNearbyCarparks,
  transformCarpark,
  type NearbyCarpark,
} from './carparkService'

const originalFetch = globalThis.fetch

const rawCarpark: NearbyCarpark = {
  id: 'URA_A0004',
  name: 'Pasir Ris Mall',
  address: '1 Pasir Ris Central',
  lat: 1.3721,
  lng: 103.9496,
  available_lots: 0,
  total_lots: 120,
  lot_types: [{ lot_type: 'C', available_lots: 0, total_lots: 120 }],
  crowd_level: 'unknown',
  is_sheltered: null,
  distance: 160,
  night_parking: null,
  car_park_type: 'CAR PARK',
  source: 'ura',
  weekdays_rate_1: null,
  weekdays_rate_2: null,
  saturday_rate: null,
  sunday_ph_rate: null,
  free_parking: '',
  short_term_parking: '',
  is_central: false,
  is_peak: false,
  availability_timestamp: null,
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('requests nearby carparks with the caller signal', async () => {
  let request: Request | undefined
  let signal: AbortSignal | null | undefined
  globalThis.fetch = async (input, init) => {
    signal = init?.signal
    const url = input instanceof Request ? input.url : new URL(input, 'http://localhost').toString()
    request = new Request(url, init)
    return new Response(JSON.stringify([rawCarpark]), { status: 200 })
  }
  const controller = new AbortController()

  const result = await getNearbyCarparks(1.3, 103.8, 500, controller.signal)

  assert.equal(new URL(request!.url).pathname, '/api/v1/carparks/nearby')
  assert.equal(new URL(request!.url).search, '?lat=1.3&lng=103.8&radius=500')
  assert.equal(signal, controller.signal)
  assert.equal(result[0].id, 'URA_A0004')
})

test('serializes bounded map searches and reports API failures', async () => {
  let request: Request | undefined
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : new URL(input, 'http://localhost').toString()
    request = new Request(url)
    return new Response('unavailable', { status: 502 })
  }

  await assert.rejects(
    () => getCarparksInArea({
      north: 1.4,
      south: 1.3,
      east: 103.9,
      west: 103.8,
      center: { lat: 1.35, lng: 103.85 },
      zoom: 14,
    }),
    /Carpark API error 502/,
  )
  assert.equal(new URL(request!.url).searchParams.get('north'), '1.4')
  assert.equal(new URL(request!.url).searchParams.get('west'), '103.8')
})

test('preserves detail identifiers and optional coordinates', async () => {
  let request: Request | undefined
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : new URL(input, 'http://localhost').toString()
    request = new Request(url)
    return new Response(JSON.stringify(rawCarpark), { status: 200 })
  }

  const result = await getCarparkById(
    'SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE',
    1.264,
    103.822,
  )

  assert.equal(
    new URL(request!.url).pathname,
    '/api/v1/carparks/SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE',
  )
  assert.equal(new URL(request!.url).search, '?lat=1.264&lng=103.822')
  assert.equal(result.name, 'Pasir Ris Mall')
})

test('maps unknown availability and walking distance without inventing a rate', () => {
  const carpark = transformCarpark(rawCarpark)

  assert.equal(carpark.availabilityLevel, 'unknown')
  assert.equal(carpark.walkingMinutes, 2)
  assert.equal(carpark.hourlyRate, Number.POSITIVE_INFINITY)
  assert.equal(carpark.availabilityUpdatedAt, undefined)
})
