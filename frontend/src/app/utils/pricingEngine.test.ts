import assert from 'node:assert/strict'
import test from 'node:test'

import type { Carpark } from '../data/carparks'
import {
  calculateLiveRates,
  generatePricingBreakdown,
  getNumericLiveCarRate,
  getTargetTextRate,
  parseTextRate,
} from './pricingEngine'

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

test('does not pair an earlier per-minute amount with a later entry unit', () => {
  assert.deepEqual(
    parseTextRate('12am-5pm: $0.024 per min; 5pm-12am: $2.40 per entry', 18),
    { amount: 2.4, basis: 'entry' },
  )
})

test('uses the matching weekday tier for Downtown East', () => {
  const rate = 'Mon-Thu 5pm-12am: $2.45 per entry; Fri-Sun 5pm-12am: $3.40 per entry'
  const parsed = parseTextRate(rate, 18, 5)

  assert.deepEqual(parsed, { amount: 3.4, basis: 'entry' })
})

test('applies Downtown East free lunch parking during its weekday window', () => {
  const rate = 'Mon-Thu 12am-5pm: $0.028 per min; Mon-Fri 12pm-2pm: Free Lunch Time Parking'
  const parsed = parseTextRate(rate, 12, 2)

  assert.deepEqual(parsed, { amount: 0, basis: 'free' })
})

test('treats an after-1am band as the overnight interval before the daytime band', () => {
  const rate = '7am-6pm: $1.20 per hr; 6pm-1am: $2.40 per entry; Aft 1am: $2.04 per hr'

  assert.deepEqual(parseTextRate(rate, 20), { amount: 2.4, basis: 'entry' })
  assert.deepEqual(parseTextRate(rate, 2), { amount: 2.04, basis: 'hour' })
})

test('parses rates written with “to” time ranges and compact slash units', () => {
  const rate = '7am to 6pm: $2/hr; 6pm to 12mn: $2.40/entry; 12mn to 7am: $2.40/hr'

  assert.deepEqual(parseTextRate(rate, 21), { amount: 2.4, basis: 'entry' })
  assert.deepEqual(parseTextRate(rate, 3), { amount: 2.4, basis: 'hour' })
})

test('converts arbitrary minute billing intervals to an hourly comparison', () => {
  assert.deepEqual(parseTextRate('$0.32 per 15 mins', 12), {
    amount: 1.28,
    basis: 'hour',
  })
})

test('parses a URA-rendered time window and minimum duration', () => {
  assert.deepEqual(
    parseTextRate('07.00 AM-08.30 AM: $0.60 per 30 mins', 8),
    { amount: 1.2, basis: 'hour' },
  )
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

test('does not apply HDB rates to static URA records without pricing data', () => {
  const cp = makeLtaCarpark('')
  cp.id = 'URA_A0001'
  cp.name = 'URA Carpark'
  cp.source = 'ura'

  assert.equal(calculateLiveRates(cp).car, 'Rate unavailable')
  assert.equal(getNumericLiveCarRate(cp), Number.POSITIVE_INFINITY)
})

test('resolves weekend rates marked as the weekday schedule', () => {
  const cp = makeLtaCarpark('7am-6pm: $1.20 per hr')
  cp.weekdaysRate2 = '6pm-4am: $3.20 per entry; 4am-7am: $2.50 per hr'
  cp.saturdayRate = 'Same as wkdays'

  assert.equal(
    getTargetTextRate(cp, 6, new Date(2026, 9, 10, 12)),
    `${cp.weekdaysRate1}\n${cp.weekdaysRate2}`,
  )
})

test('uses Downtown East weekend rates on the eve of a public holiday', () => {
  const cp = makeLtaCarpark('Mon-Thu 12am-5pm: $0.028 per min')
  cp.name = 'Downtown East'
  cp.weekdaysRate2 = 'Fri 12am-5pm: $0.030 per min'
  cp.saturdayRate = '12am-5pm: $0.030 per min; 5pm-12am: $3.40 per entry'

  assert.equal(
    getTargetTextRate(cp, 4, new Date(2026, 11, 24, 12)),
    cp.saturdayRate,
  )
})

test('does not treat operating-hours notes after the rate as a weekday price restriction', () => {
  const cp = makeLtaCarpark('6am-5pm: $5 per hr (car park closes at 11pm from Mon-Sat)')
  cp.sundayPhRate = 'Same as wkdays'
  const schedule = getTargetTextRate(cp, 0, new Date(2026, 9, 11, 12))

  assert.deepEqual(parseTextRate(schedule, 12, 0), { amount: 5, basis: 'hour' })
})

test('shows Downtown East school-holiday and Begonia-only free-parking conditions', () => {
  const cp = makeLtaCarpark('$0.028 per min')
  cp.name = 'Downtown East'

  const details = generatePricingBreakdown(cp).car.join('\n').toLowerCase()
  assert.ok(details.includes('school holidays use the fri–sun tariff'))
  assert.ok(details.includes("the app doesn't detect school-holiday dates automatically"))
  assert.ok(details.includes('9pm–5am free-parking offer applies only to begonia open air carpark'))
})
