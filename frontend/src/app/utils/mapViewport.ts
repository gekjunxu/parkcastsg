import type { Carpark } from '../data/carparks'
import type { Coordinates } from '../../api/geocode'

export interface MapViewport {
  north: number
  south: number
  east: number
  west: number
  center: Coordinates
  zoom: number
}

export function canSearchViewport(bounds: MapViewport): boolean {
  return [bounds.north, bounds.south, bounds.east, bounds.west].every(Number.isFinite) &&
    bounds.south >= -90 && bounds.north <= 90 && bounds.west >= -180 && bounds.east <= 180 &&
    bounds.north > bounds.south && bounds.east > bounds.west &&
    bounds.north - bounds.south <= 0.12 && bounds.east - bounds.west <= 0.12
}

export function areaSearchUrl(bounds: MapViewport): string {
  const params = new URLSearchParams({ q: 'Map area', lat: String(bounds.center.lat), lng: String(bounds.center.lng), zoom: String(bounds.zoom) })
  for (const key of ['north', 'south', 'east', 'west'] as const) params.set(key, String(bounds[key]))
  return `/results?${params}`
}

export function areaFromParams(params: URLSearchParams): MapViewport | null {
  if (!['north', 'south', 'east', 'west'].every(key => params.has(key))) return null
  const north = Number(params.get('north')), south = Number(params.get('south'))
  const east = Number(params.get('east')), west = Number(params.get('west'))
  const bounds = { north, south, east, west, center: { lat: (north + south) / 2, lng: (east + west) / 2 }, zoom: Math.max(10, Math.min(18, Number(params.get('zoom')) || 15)) }
  return canSearchViewport(bounds) ? bounds : null
}

export function isInViewport(point: Coordinates, bounds: MapViewport): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
    point.lat >= bounds.south && point.lat <= bounds.north &&
    point.lng >= bounds.west && point.lng <= bounds.east
}

export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}

/** Explorer API distances are from Singapore's centre, not the current view. */
export function carparksInViewport(carparks: Carpark[], bounds: MapViewport): Carpark[] {
  return carparks.filter(cp => isInViewport(cp, bounds)).map(cp => {
    const distance = distanceMetres(bounds.center, cp)
    return { ...cp, distance, walkingMinutes: Math.max(1, Math.round(distance / 80)) }
  })
}
