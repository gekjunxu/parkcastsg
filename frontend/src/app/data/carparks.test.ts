import assert from 'node:assert/strict'
import test from 'node:test'
import { filterFreeSundayParking, filterShelteredCarparks, sortCarparks, type Carpark } from './carparks'

function carpark(id: string, overrides: Partial<Carpark> = {}): Carpark {
    return {
        id, name: id, address: id, lat: 1.3, lng: 103.8,
        availableLots: 20, totalLots: 100, availabilityLevel: 'moderate',
        walkingMinutes: 2, hourlyRate: 1.2, isSheltered: true,
        distance: 160, source: 'hdb', freeParking: 'NO', ...overrides,
    }
}

test('includes both HDB Sunday/PH schemes regardless of the live rate', () => {
    const morning = carpark('morning', { freeParking: 'SUN & PH FR 7AM-10.30PM' })
    const afternoon = carpark('afternoon', { freeParking: 'SUN & PH FR 1PM-10.30PM' })
    assert.deepEqual(filterFreeSundayParking([morning, afternoon]), [morning, afternoon])
})

test('excludes non-participating, missing, unknown and non-HDB schemes, even at a zero rate', () => {
    const excluded = [
        carpark('paid', { hourlyRate: 0 }),
        carpark('missing', { freeParking: undefined }),
        carpark('empty', { freeParking: '' }),
        carpark('unknown', { freeParking: 'UNKNOWN' }),
        carpark('other', { freeParking: 'SAT ONLY' }),
        ...(['lta', 'supplemental', undefined] as const).map(source =>
            carpark(String(source), { source, freeParking: 'SUN & PH FR 7AM-10.30PM' })),
    ]
    assert.deepEqual(filterFreeSundayParking(excluded), [])
})

test('combines with Rain Mode and sorting without changing the original results', () => {
    const near = carpark('near', { freeParking: 'SUN & PH FR 7AM-10.30PM' })
    const far = carpark('far', { freeParking: 'SUN & PH FR 1PM-10.30PM', walkingMinutes: 5 })
    const surface = carpark('surface', { ...near, id: 'surface', isSheltered: false })
    const paid = carpark('paid')
    const all = [far, paid, surface, near]
    const filtered = filterFreeSundayParking(filterShelteredCarparks(all))
    assert.deepEqual(sortCarparks(filtered, 'closest'), [near, far])
    assert.deepEqual(all, [far, paid, surface, near])
    assert.deepEqual(filterFreeSundayParking(all), [far, surface, near])
})
