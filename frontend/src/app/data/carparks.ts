export type AvailabilityLevel = 'high' | 'moderate' | 'low' | 'full' | 'unknown';

export interface Carpark {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    availableLots: number;
    totalLots: number;
    lotTypes?: {
        lotType: string;
        availableLots: number;
        totalLots: number;
    }[];
    availabilityLevel: AvailabilityLevel;
    walkingMinutes: number;
    hourlyRate: number;
    weekendRate?: number;
    isSheltered: boolean | null;
    carparkType?: string;
    isRecommended?: boolean;
    distance: number; // in meters
    nightParking?: boolean | null;
    source?: 'hdb' | 'lta' | 'supplemental'; // data source
    // Parking rates from CarparkRates.csv — only populated for LTA/supplemental carparks
    // where a name match was found; undefined means "data not available".
    weekdaysRate1?: string;
    weekdaysRate2?: string;
    saturdayRate?: string;
    sundayPhRate?: string;
    // HDB pricing metadata
    freeParking?: string;
    shortTermParking?: string;
    isCentral?: boolean;
    isPeak?: boolean;
    availabilityUpdatedAt?: string;
}

export function getAvailabilityColor(level: AvailabilityLevel): string {
    switch (level) {
        case 'high':
            return '#10B981'; // Emerald green
        case 'moderate':
            return '#F59E0B'; // Amber
        case 'low':
            return '#F59E0B'; // Amber
        case 'full':
            return '#EF4444'; // Red
        case 'unknown':
            return '#9CA3AF'; // Grey
    }
}

const CARPARK_TYPE_LABELS: Record<string, string> = {
    'SURFACE CAR PARK': 'Surface Carpark',
    'MULTI-STOREY CAR PARK': 'Multi-Storey Carpark',
    'BASEMENT CAR PARK': 'Basement Carpark',
    'COVERED CAR PARK': 'Covered Carpark',
    'MECHANISED CAR PARK': 'Mechanised Carpark',
    'MECHANISED AND SURFACE CAR PARK': 'Mechanised & Surface Carpark',
    'SURFACE/MULTI-STOREY CAR PARK': 'Surface / Multi-Storey Carpark',
};

export function formatCarparkType(raw?: string): string {
    if (!raw) return 'Carpark';
    return CARPARK_TYPE_LABELS[raw.toUpperCase()] ?? raw;
}

export function getAvailabilityText(carpark: Carpark): string {
    if (carpark.availabilityLevel === 'unknown') {
        return 'Live availability unavailable';
    }
    if (carpark.availabilityLevel === 'full') {
        return 'Full';
    }
    if (carpark.totalLots === 0) {
        return `${carpark.availableLots} lots available`;
    }
    return `${carpark.availabilityLevel.charAt(0).toUpperCase() + carpark.availabilityLevel.slice(1)} — ${carpark.availableLots} lots`;
}

export function sortCarparks(
    carparks: Carpark[],
    sortBy: 'recommended' | 'cheapest' | 'closest' | 'available'
): Carpark[] {
    const sorted = [...carparks];

    switch (sortBy) {
        case 'cheapest':
            return sorted.sort((a, b) => a.hourlyRate - b.hourlyRate);
        case 'closest':
            return sorted.sort((a, b) => a.walkingMinutes - b.walkingMinutes);
        case 'available':
            return sorted.sort((a, b) => {
                const aUnknown = a.availabilityLevel === 'unknown';
                const bUnknown = b.availabilityLevel === 'unknown';
                if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
                return b.availableLots - a.availableLots;
            });
        case 'recommended':
        default:
            // Sort by: recommended first, then availability, then distance
            return sorted.sort((a, b) => {
                if (a.isRecommended && !b.isRecommended) return -1;
                if (!a.isRecommended && b.isRecommended) return 1;
                // Push 'full' to end; treat 'unknown' as moderate (don't penalise)
                if (a.availabilityLevel === 'full' && b.availabilityLevel !== 'full')
                    return 1;
                if (a.availabilityLevel !== 'full' && b.availabilityLevel === 'full')
                    return -1;
                return a.walkingMinutes - b.walkingMinutes;
            });
    }
}

export function filterShelteredCarparks(carparks: Carpark[]): Carpark[] {
    return carparks.filter((cp) => cp.isSheltered === true);
}
