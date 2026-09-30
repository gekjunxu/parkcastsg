import test from 'node:test'
import assert from 'node:assert/strict'
import { areaFromParams, areaSearchUrl, canSearchViewport, isInViewport, distanceMetres, carparksInViewport, type MapViewport } from './mapViewport'
import type { Carpark } from '../data/carparks'

const bounds: MapViewport = { north: 1.32, south: 1.30, east: 103.84, west: 103.82, center: { lat: 1.31, lng: 103.83 }, zoom: 15 }
test('exploration uses the visible rectangle, including edges, rather than a fixed radius', () => {
  assert.equal(isInViewport({ lat: 1.32, lng: 103.84 }, bounds), true)
  assert.equal(isInViewport({ lat: 1.321, lng: 103.83 }, bounds), false)
  assert.equal(isInViewport({ lat: 1.31, lng: 103.841 }, bounds), false)
  assert.equal(isInViewport({ lat: NaN, lng: 103.83 }, bounds), false)
})
test('distance uses metres and is symmetric', () => {
  assert.equal(distanceMetres(bounds.center, bounds.center), 0)
  const a = { lat: 1.31, lng: 103.83 }, b = { lat: 1.32, lng: 103.83 }
  assert.ok(Math.abs(distanceMetres(a, b) - 1111.95) < 1)
  assert.equal(distanceMetres(a, b), distanceMetres(b, a))
})
test('visible results recalculate proximity without mutating the cached island dataset', () => {
  const inside = { id: 'in', ...bounds.center, distance: 9000, walkingMinutes: 113 } as Carpark
  const outside = { id: 'out', lat: 1.4, lng: 103.83 } as Carpark
  const result = carparksInViewport([inside, outside], bounds)
  assert.equal(result.length, 1)
  assert.equal(result[0].distance, 0)
  assert.equal(result[0].walkingMinutes, 1)
  assert.equal(inside.distance, 9000)
})

test('search this area stays on bounded results and round-trips map geometry', () => {
  const url = areaSearchUrl(bounds)
  assert.ok(url.startsWith('/results?'))
  assert.ok(!url.startsWith('/map'))
  const restored = areaFromParams(new URLSearchParams(url.split('?')[1]))
  assert.deepEqual(restored, bounds)
})
test('island-wide and invalid viewports require zooming in instead of a full download', () => {
  assert.equal(canSearchViewport(bounds), true)
  assert.equal(canSearchViewport({ ...bounds, east: 104 }), false)
  assert.equal(canSearchViewport({ ...bounds, north: Infinity }), false)
  assert.equal(canSearchViewport({ ...bounds, south: 2 }), false)
  assert.equal(areaFromParams(new URLSearchParams('north=nan&south=1&east=104&west=103')), null)
})
