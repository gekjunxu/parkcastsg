import type { Carpark, AvailabilityLevel } from '../app/data/carparks'
import { getNumericLiveCarRate } from '../app/utils/pricingEngine'
import { API_BASE } from '../app/runtime'

// ---------------------------------------------------------------------------
// Raw shape returned by the backend
// ---------------------------------------------------------------------------
export interface LotTypeAvailability {
  lot_type: string
  available_lots: number
  total_lots: number
}

export interface NearbyCarpark {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  available_lots: number
  total_lots: number
  lot_types: LotTypeAvailability[]
  crowd_level: 'low' | 'medium' | 'high' | 'full' | 'unknown'
  is_sheltered: boolean | null
  distance: number // metres
  night_parking: boolean | null
  car_park_type: string
  source: 'hdb' | 'lta' | 'supplemental'
  weekdays_rate_1: string | null
  weekdays_rate_2: string | null
  saturday_rate: string | null
  sunday_ph_rate: string | null
  free_parking: string
  short_term_parking: string
  is_central: boolean
  is_peak: boolean
  availability_timestamp: string | null
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function getNearbyCarparks(
  lat: number,
  lng: number,
  radius: number,
): Promise<NearbyCarpark[]> {
  const url = `${API_BASE}/api/v1/carparks/nearby?lat=${lat}&lng=${lng}&radius=${radius}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Carpark API error ${res.status}`)
  }
  return res.json()
}

export async function getAllCarparks(): Promise<NearbyCarpark[]> {
  const url = `${API_BASE}/api/v1/carparks/all`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Carpark API error ${res.status}`)
  }
  return res.json()
}

export async function getCarparkById(
  id: string,
  lat?: number,
  lng?: number,
): Promise<NearbyCarpark> {
  let url = `${API_BASE}/api/v1/carparks/${id}`
  if (lat !== undefined && lng !== undefined) {
    url += `?lat=${lat}&lng=${lng}`
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Carpark API error ${res.status}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Transform backend shape → frontend Carpark type
// ---------------------------------------------------------------------------

function crowdToAvailability(crowd: string): AvailabilityLevel {
    switch (crowd) {
        case 'low':
            return 'high';
        case 'medium':
            return 'moderate';
        case 'high':
            return 'low';
        case 'full':
            return 'full';
        case 'unknown':
            return 'unknown';
        default:
            return 'moderate';
    }
}

function distanceToWalkingMinutes(distanceMetres: number): number {
  // Average walking speed ~80 m/min
  return Math.max(1, Math.round(distanceMetres / 80))
}

export function transformCarpark(raw: NearbyCarpark): Carpark {
    const isLta = raw.source === 'lta';
    const isSupplemental = raw.source === 'supplemental';
    const cp: Carpark = {
        id: raw.id,
        name: raw.name,
        address: raw.address,
        lat: raw.lat,
        lng: raw.lng,
        availableLots: raw.available_lots,
        totalLots: raw.total_lots,
        lotTypes: raw.lot_types ? raw.lot_types.map((lot) => ({ lotType: lot.lot_type, availableLots: lot.available_lots, totalLots: lot.total_lots })) : [],
        availabilityLevel: crowdToAvailability(raw.crowd_level),
        walkingMinutes: distanceToWalkingMinutes(raw.distance),

        // Unknown rates stay at Infinity so "Cheapest" never promotes a
        // carpark whose price is not actually known.
        hourlyRate: Number.POSITIVE_INFINITY,

        isSheltered: raw.is_sheltered,
        carparkType: raw.car_park_type,
        distance: raw.distance,
        nightParking: raw.night_parking,
        source: raw.source,
        weekdaysRate1: raw.weekdays_rate_1 ?? undefined,
        weekdaysRate2: raw.weekdays_rate_2 ?? undefined,
        saturdayRate: raw.saturday_rate ?? undefined,
        sundayPhRate: raw.sunday_ph_rate ?? undefined,
        freeParking: raw.free_parking,
        shortTermParking: raw.short_term_parking,
        isCentral: raw.is_central,
        isPeak: raw.is_peak,
        availabilityUpdatedAt: raw.availability_timestamp ?? undefined,
        // LTA/supplemental carparks are not marked recommended (unknown availability)
        isRecommended: !isLta && !isSupplemental && raw.available_lots > 10 && raw.is_sheltered,
    };

    // Assign accurate live numeric rate for all carparks so they sort correctly
    // and render numerically in the CarparkMap popup.
    cp.hourlyRate = getNumericLiveCarRate(cp);

    return cp
}
