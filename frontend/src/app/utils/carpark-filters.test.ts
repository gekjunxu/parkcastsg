import assert from 'node:assert/strict'
import test from 'node:test'

import type { Carpark } from '../data/carparks'
import {
  applyCarparkFilters,
  FreeSundayPublicHolidayCarparkFilter,
  ShelteredCarparkFilter,
} from './carpark-filters'

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
    isSheltered: true,
    distance: 160,
    source: 'hdb',
    freeParking: 'NO',
    ...overrides,
  }
}

test('ShelteredCarparkFilter keeps sheltered and unknown-status carparks', () => {
  const sheltered = carpark('sheltered')
  const unknown = carpark('unknown', { isSheltered: null })
  const open = carpark('open', { isSheltered: false })

  assert.deepEqual(new ShelteredCarparkFilter().apply([sheltered, unknown, open]), [sheltered, unknown])
})

test('FreeSundayPublicHolidayCarparkFilter matches only HDB Sunday/PH schemes', () => {
  const morning = carpark('morning', { freeParking: 'SUN & PH FR 7AM-10.30PM' })
  const afternoon = carpark('afternoon', { freeParking: 'sun & ph fr 1PM-10.30PM' })
  const lta = carpark('lta', { source: 'lta', freeParking: morning.freeParking })
  const supplemental = carpark('supplemental', { source: 'supplemental', freeParking: morning.freeParking })
  const unrelated = carpark('unrelated', { freeParking: 'SAT ONLY' })

  assert.deepEqual(
    new FreeSundayPublicHolidayCarparkFilter().apply([morning, afternoon, lta, supplemental, unrelated]),
    [morning, afternoon],
  )
})

test('applyCarparkFilters composes filters without mutating the source list', () => {
  const near = carpark('near', { freeParking: 'SUN & PH FR 7AM-10.30PM' })
  const open = carpark('open', { isSheltered: false, freeParking: near.freeParking })
  const paid = carpark('paid')
  const all = [open, paid, near]

  assert.deepEqual(
    applyCarparkFilters(all, [new ShelteredCarparkFilter(), new FreeSundayPublicHolidayCarparkFilter()]),
    [near],
  )
  assert.deepEqual(all, [open, paid, near])
})
