import assert from 'node:assert/strict'
import { test } from 'node:test'
import { destinationSearchUrl, textSearchUrl } from './destination-navigation'

test('encodes selected labels, coordinates, and radius in the results URL', () => {
  const url = destinationSearchUrl({
    label: 'Tower / Harbour & Bay',
    lat: 1.264293,
    lng: 103.822305,
  }, 500)

  assert.equal(
    url,
    '/results?q=Tower+%2F+Harbour+%26+Bay&lat=1.264293&lng=103.822305&radius=500',
  )
})
test('keeps text-only searches compatible with the existing results route', () => {
  assert.equal(textSearchUrl(' Marina Bay ', 1000), '/results?q=Marina+Bay&radius=1000')
})
