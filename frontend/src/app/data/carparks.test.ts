import assert from 'node:assert/strict'
import test from 'node:test'

import { sortCarparks, type Carpark } from './carparks'

function carpark(id: string, overrides: Partial<Carpark> = {}): Carpark {
  return {
    id,
    name: id,
    address: id,
    lat: 1.3,
    lng: 103.8,
    availableLots: 20,
    totalLots: 100,
    availabilityLevel: 'moderate',
    walkingMinutes: 2,
    hourlyRate: 1.2,
    isSheltered: null,
    distance: 160,
    source: 'hdb',
    ...overrides,
  }
}

test('Available nearby ranks availability before walking distance and does not mutate input', () => {
  const full = carpark('full', { availabilityLevel: 'full', walkingMinutes: 1 })
  const unknown = carpark('unknown', { availabilityLevel: 'unknown', walkingMinutes: 1 })
  const nearbyModerate = carpark('nearby-moderate', { availabilityLevel: 'moderate', walkingMinutes: 1 })
  const farHigh = carpark('far-high', { availabilityLevel: 'high', walkingMinutes: 9 })
  const nearbyHigh = carpark('nearby-high', { availabilityLevel: 'high', walkingMinutes: 2 })
  const input = [full, unknown, nearbyModerate, farHigh, nearbyHigh]

  const sorted = sortCarparks(input, 'nearby')

  assert.deepEqual(sorted.map(carpark => carpark.id), ['nearby-high', 'far-high', 'nearby-moderate', 'unknown', 'full'])
  assert.deepEqual(input.map(carpark => carpark.id), ['full', 'unknown', 'nearby-moderate', 'far-high', 'nearby-high'])
})
