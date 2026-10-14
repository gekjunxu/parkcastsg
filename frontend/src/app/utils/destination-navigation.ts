import type { Coordinates } from '../../api/geocode'

export interface SelectedDestination extends Coordinates {
  label: string
}

export function destinationSearchUrl(destination: SelectedDestination, radius: number): string {
  const params = new URLSearchParams({
    q: destination.label,
    lat: String(destination.lat),
    lng: String(destination.lng),
    radius: String(radius),
  })
  return `/results?${params.toString()}`
}

export function textSearchUrl(query: string, radius: number): string {
  const params = new URLSearchParams({ q: query.trim(), radius: String(radius) })
  return `/results?${params.toString()}`
}
