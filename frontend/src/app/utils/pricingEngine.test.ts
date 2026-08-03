import assert from 'node:assert/strict'
import test from 'node:test'

import type { Carpark } from '../data/carparks'
import { getNumericLiveCarRate, parseTextRate } from './pricingEngine'

test('converts half-hour pricing to an hourly comparison', () => {
  assert.deepEqual(parseTextRate('$0.60 / 30 mins', 12), {
    amount: 1.2,
    basis: 'hour',
  })
})

test('preserves per-entry pricing instead of labelling it per hour', () => {
  assert.deepEqual(parseTextRate('$2.50 per entry', 18), {
    amount: 2.5,
    basis: 'entry',
  })
})

test('selects the active time band', () => {
  const rate = '8am-5pm: $1.20 per hr; after 5pm: $2.50 per entry'

  assert.deepEqual(parseTextRate(rate, 12), {
    amount: 1.2,
    basis: 'hour',
  })
  assert.deepEqual(parseTextRate(rate, 18), {
    amount: 2.5,
    basis: 'entry',
  })
})

test('marks an amount without a billing unit as non-comparable', () => {
  assert.deepEqual(parseTextRate('Maximum charge $12.00', 12), {
    amount: 12,
    basis: 'unknown',
  })
})

test('returns null when no published rate is available', () => {
  assert.equal(parseTextRate('-', 12), null)
  assert.equal(parseTextRate(undefined, 12), null)
})

function makeLtaCarpark(rate: string): Carpark {
  return {
    id: 'LTA_TEST',
    name: 'Test LTA Carpark',
    address: 'Test Address',
    lat: 1.3,
    lng: 103.8,
    availableLots: 0,
    totalLots: 0,
    availabilityLevel: 'unknown',
    walkingMinutes: 1,
    hourlyRate: Number.POSITIVE_INFINITY,
    isSheltered: null,
    distance: 100,
    source: 'lta',
    weekdaysRate1: rate,
    shortTermParking: 'WHOLE DAY',
    freeParking: 'NO',
    isCentral: false,
    isPeak: false,
  }
}

test('treats per-entry rates as non-comparable for cheapest sorting', () => {
  const cp = makeLtaCarpark('$2.50 per entry')
  assert.equal(getNumericLiveCarRate(cp), Number.POSITIVE_INFINITY)
})

test('keeps hourly rates comparable for cheapest sorting', () => {
  const cp = makeLtaCarpark('$3.00 per hr')
  assert.equal(getNumericLiveCarRate(cp), 3)
})
