import type { Carpark } from '../data/carparks'

/** Shared matching and list application behavior for carpark filters. */
export abstract class CarparkFilter {
  abstract matches(carpark: Carpark): boolean

  apply(carparks: Carpark[]): Carpark[] {
    return carparks.filter((carpark) => this.matches(carpark))
  }
}

export function applyCarparkFilters(
  carparks: Carpark[],
  filters: CarparkFilter[],
): Carpark[] {
  return filters.reduce((current, filter) => filter.apply(current), carparks)
}

export class ShelteredCarparkFilter extends CarparkFilter {
  matches(carpark: Carpark): boolean {
    return carpark.isSheltered !== false
  }
}

/** Match advertised Sunday and public holiday free parking, regardless of short-term status. */
export class FreeSundayPublicHolidayCarparkFilter extends CarparkFilter {
  matches(carpark: Carpark): boolean {
    return /SUN\s*&\s*PH/i.test(carpark.freeParking ?? '')
  }
}
