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
