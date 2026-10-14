import { API_BASE } from '../app/runtime'

export interface Coordinates {
  lat: number
  lng: number
}

export interface LocationSuggestion extends Coordinates {
  label: string
  address: string | null
  postal: string | null
}

function isValidCoordinates(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number'
    && typeof lng === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
}

export function normalizeLocationSuggestions(value: unknown): LocationSuggestion[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).flatMap((item): LocationSuggestion[] => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const lat = typeof raw.lat === 'number' ? raw.lat : Number(raw.lat)
    const lng = typeof raw.lng === 'number' ? raw.lng : Number(raw.lng)
    if (!label || !isValidCoordinates(lat, lng)) return []
    return [{
      label,
      address: typeof raw.address === 'string' && raw.address.trim() ? raw.address.trim() : null,
      postal: typeof raw.postal === 'string' && raw.postal.trim() ? raw.postal.trim() : null,
      lat,
      lng,
    }]
  })
}

function suggestionsUrl(query: string): string {
  const origin = globalThis.location?.origin ?? 'http://localhost'
  const url = new URL(`${API_BASE}/api/v1/locations/suggest`, origin)
  url.searchParams.set('q', query)
  return url.toString()
}

export async function suggestLocations(query: string, signal?: AbortSignal): Promise<LocationSuggestion[]> {
  const normalized = query.trim()
  if (normalized.length < 2 || normalized.length > 100) return []
  const response = await fetch(suggestionsUrl(normalized), { signal })
  if (!response.ok) throw new Error(`Location suggestions failed: ${response.status}`)
  return normalizeLocationSuggestions(await response.json())
}

export async function geocodeQuery(query: string, signal?: AbortSignal): Promise<Coordinates | null> {
  const first = (await suggestLocations(query, signal))[0]
  return first ? { lat: first.lat, lng: first.lng } : null
}
