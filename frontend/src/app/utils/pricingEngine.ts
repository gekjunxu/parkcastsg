import { isSundayOrPublicHoliday } from './holidays';
import type { Carpark } from '../data/carparks';

interface LivePrices {
  car: string;
  motorcycle: string;
  heavy: string;
}

interface PeakWindow {
  days: number[]; // 0=Sun, 1=Mon...6=Sat
  startHour: number; // 24-h format
  endHour: number;
}
type PeakConfig = Record<string, PeakWindow[]>;

export type ParsedRateBasis = 'hour' | 'entry' | 'free' | 'unknown';

export interface ParsedTextRate {
  amount: number;
  basis: ParsedRateBasis;
}

const PEAK_CARPARKS: PeakConfig = {
  // ACB, CY: Weekdays, 10:00am to 6:00pm; Weekends, 8:00am to 7:00pm
  "ACB": [{ days: [1, 2, 3, 4, 5], startHour: 10, endHour: 18 }, { days: [0, 6], startHour: 8, endHour: 19 }],
  "CY": [{ days: [1, 2, 3, 4, 5], startHour: 10, endHour: 18 }, { days: [0, 6], startHour: 8, endHour: 19 }],
  // SE21, SE22: Monday to Saturday, 10:00am to 10:00pm
  "SE21": [{ days: [1, 2, 3, 4, 5, 6], startHour: 10, endHour: 22 }],
  "SE22": [{ days: [1, 2, 3, 4, 5, 6], startHour: 10, endHour: 22 }],
  // SE24: Daily, 10:00am to 10:00pm
  "SE24": [{ days: [0, 1, 2, 3, 4, 5, 6], startHour: 10, endHour: 22 }],
  // MP14, MP15, MP16: Daily, 8:00am to 8:00pm
  "MP14": [{ days: [0, 1, 2, 3, 4, 5, 6], startHour: 8, endHour: 20 }],
  "MP15": [{ days: [0, 1, 2, 3, 4, 5, 6], startHour: 8, endHour: 20 }],
  "MP16": [{ days: [0, 1, 2, 3, 4, 5, 6], startHour: 8, endHour: 20 }],
  // HG9, HG9T, HG15, HG16: Weekdays, 11:00am to 8:00pm; Weekends, 9:00am to 8:00pm
  "HG9": [{ days: [1, 2, 3, 4, 5], startHour: 11, endHour: 20 }, { days: [0, 6], startHour: 9, endHour: 20 }],
  "HG9T": [{ days: [1, 2, 3, 4, 5], startHour: 11, endHour: 20 }, { days: [0, 6], startHour: 9, endHour: 20 }],
  "HG15": [{ days: [1, 2, 3, 4, 5], startHour: 11, endHour: 20 }, { days: [0, 6], startHour: 9, endHour: 20 }],
  "HG16": [{ days: [1, 2, 3, 4, 5], startHour: 11, endHour: 20 }, { days: [0, 6], startHour: 9, endHour: 20 }],
};

function isPeakActive(id: string, day: number, hour: number): boolean {
  const config = PEAK_CARPARKS[id];
  if (!config) return false;
  return config.some(window => window.days.includes(day) && hour >= window.startHour && hour < window.endHour);
}

function parseTimeString(timeStr: string): { hour: number, min: number } | null {
  const match = timeStr.match(/^(\d+)(?:\.(\d+))?(AM|PM)$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const min = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3].toUpperCase();

  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  return { hour, min };
}

function checkIsFreeParkingActive(freeParkingSpec: string | undefined, now: Date): boolean {
  if (!freeParkingSpec || freeParkingSpec === 'NO' || freeParkingSpec.trim() === '') {
    return false;
  }
  // Assume it's SUN & PH
  if (!freeParkingSpec.includes('SUN & PH')) return false;
  if (!isSundayOrPublicHoliday(now)) return false;

  const hour = now.getHours();
  const min = now.getMinutes();

  let startHour = 7;
  let startMin = 0;
  let endHour = 22;
  let endMin = 30;

  const timeMatch = freeParkingSpec.match(/FR\s+([0-9.A-Z]+)-([0-9.A-Z]+)/i);
  if (timeMatch) {
    const parsedStart = parseTimeString(timeMatch[1]);
    const parsedEnd = parseTimeString(timeMatch[2]);
    if (parsedStart) {
      startHour = parsedStart.hour;
      startMin = parsedStart.min;
    }
    if (parsedEnd) {
      endHour = parsedEnd.hour;
      endMin = parsedEnd.min;
    }
  }

  const nowMins = hour * 60 + min;
  const startMins = startHour * 60 + startMin;
  const endMins = endHour * 60 + endMin;

  if (nowMins < startMins || nowMins >= endMins) return false;

  return true;
}

function isShortTermParkingAvailable(spec: string | undefined, now: Date): boolean {
  if (!spec || spec === 'NO') return false;
  if (spec === 'WHOLE DAY') return true;

  const hour = now.getHours();
  const min = now.getMinutes();
  const nowMins = hour * 60 + min;

  const timeMatch = spec.match(/^([0-9.A-Z]+)-([0-9.A-Z]+)$/i);
  if (timeMatch) {
    const parsedStart = parseTimeString(timeMatch[1]);
    const parsedEnd = parseTimeString(timeMatch[2]);
    if (parsedStart && parsedEnd) {
      const startMins = parsedStart.hour * 60 + parsedStart.min;
      const endMins = parsedEnd.hour * 60 + parsedEnd.min;
      return nowMins >= startMins && nowMins < endMins;
    }
  }

  return true;
}

function parseHourBoundary(timeStr: string): number | null {
  const parsed = parseTimeString(timeStr.trim());
  if (!parsed) return null;
  return parsed.hour;
}

/**
 * Attempts to parse arbitrary text-based SGD pricing strings 
 * (e.g. from CarparkRates.csv) into numerical hourly equivalents.
 * Segment checking ensures we only process the rate block that belongs to the current hour.
 */
export function parseTextRate(rate: string | undefined, currentHour: number): ParsedTextRate | null {
  if (!rate || rate === '-' || rate.toLowerCase() === 'no') return null;
  
  let lower = rate.toLowerCase();

  // Try to segment by newline or semicolon if there are multiple parts
  const rawSegments = lower.split(/\n|;/).map(s => s.trim()).filter(s => s);
  const activeSegments = [];

  // Tracks whether the most recent explicitly time-windowed segment was active.
  // Segments without a time qualifier inherit this value so that sub-rate
  // fragments (e.g. "$0.37 for sub. 10mins") are only included when their
  // parent time block is active.
  let prevActive = true;

  for (const segment of rawSegments) {
     const timeWindowMatch = segment.match(/([0-9]+(?:\.[0-9]+)?(?:am|pm))\s*-\s*([0-9]+(?:\.[0-9]+)?(?:am|pm))/i) || 
                             segment.match(/([0-9]{4})\s*-\s*([0-9]{4})/i);
     const aftMatch = segment.match(/aft(?:er)?\s*([0-9]+(?:\.[0-9]+)?(?:am|pm))/i);
     
     const hasExplicitWindow = !!(timeWindowMatch || aftMatch);
     let inWindow: boolean;

     if (timeWindowMatch) {
        const startMatch = timeWindowMatch[1];
        const endMatch = timeWindowMatch[2];
        const startH = parseHourBoundary(startMatch) ?? parseInt(startMatch.slice(0, 2), 10);
        const endH = parseHourBoundary(endMatch) ?? parseInt(endMatch.slice(0, 2), 10);
        
        if (!isNaN(startH) && !isNaN(endH)) {
            if (startH <= endH) {
               inWindow = currentHour >= startH && currentHour < endH;
            } else { // wraps past midnight e.g. 5pm-7am
               inWindow = currentHour >= startH || currentHour < endH;
            }
        } else {
            inWindow = prevActive;
        }
     } else if (aftMatch) {
         const startH = parseHourBoundary(aftMatch[1]);
         inWindow = startH !== null ? currentHour >= startH : prevActive;
     } else {
         // No explicit time window — inherit from the previous time-windowed segment
         inWindow = prevActive;
     }

     if (hasExplicitWindow) {
         prevActive = inWindow;
     }
     
     if (inWindow) {
         activeSegments.push(segment);
     }
  }
  
  if (activeSegments.length > 0) {
     lower = activeSegments.join(" ");
  }

  // Free checks
  if (lower.includes('free') && (lower.includes('daily') || !/\d/.test(lower))) {
    return { amount: 0, basis: 'free' };
  }

  let match: RegExpMatchArray | null;

  // $X for 1st hr (Placed FIRST so base rate is extracted)
  match = lower.match(/\$([0-9.]+).*?1st(?:\s?[0-9])?\s?hr/);
  if (match) return { amount: parseFloat(match[1]), basis: 'hour' };

  // $X per hr
  match = lower.match(/\$([0-9.]+)\s(?:per|\/)\s?(?:hr|hour)/);
  if (match) return { amount: parseFloat(match[1]), basis: 'hour' };

  // $X per ½ hr -> X * 2
  match = lower.match(/\$([0-9.]+)\s(?:per|\/)\s?½\s?hr/);
  if (match) return { amount: parseFloat(match[1]) * 2, basis: 'hour' };

  // $X / 30 mins -> X * 2
  match = lower.match(/\$([0-9.]+)\s(?:per|\/)\s?30\s?mins?/);
  if (match) return { amount: parseFloat(match[1]) * 2, basis: 'hour' };

  // $X for sub ½ hr -> X * 2
  match = lower.match(/\$([0-9.]+).*?sub.*?½\s?hr/);
  if (match) return { amount: parseFloat(match[1]) * 2, basis: 'hour' };

  // $X for sub hr -> X
  match = lower.match(/\$([0-9.]+).*?sub.*?hr/);
  if (match) return { amount: parseFloat(match[1]), basis: 'hour' };

  // $X per entry
  match = lower.match(/\$([0-9.]+).*?per entry/);
  if (match) return { amount: parseFloat(match[1]), basis: 'entry' };

  // $X /min or $X per min — convert to hourly
  match = lower.match(/\$([0-9.]+)\s*(?:per\s*min(?:ute)?|\/\s*min(?:ute)?)/);
  if (match) return { amount: parseFloat(match[1]) * 60, basis: 'hour' };

  // Simple fallback finding any $ amount
  match = lower.match(/\$([0-9.]+)/);
  if (match) return { amount: parseFloat(match[1]), basis: 'unknown' };

  return null;
}

/** Backwards-compatible numeric helper used by focused parser tests. */
export function parseTextRateEquivalent(
  rate: string | undefined,
  currentHour: number,
): number | null {
  return parseTextRate(rate, currentHour)?.amount ?? null;
}

/** Returns true only when a rate string contains usable data (not missing/sentinel). */
function hasRate(rate: string | undefined): rate is string {
  return !!rate && rate.trim() !== '' && rate.trim() !== '-';
}

/** Returns the first valid rate from the provided fields, or undefined if none. */
function firstValidRate(...fields: (string | undefined)[]): string | undefined {
  return fields.find(hasRate);
}

/**
 * Determines which text rate string perfectly applies for the current hour.
 * @param now - SGT-adjusted Date, must match the `day` value passed in.
 */
function getTargetTextRate(carpark: Carpark, day: number, now: Date): string | undefined {
  if (isSundayOrPublicHoliday(now)) {
    return firstValidRate(carpark.sundayPhRate, carpark.weekdaysRate1, carpark.weekdaysRate2);
  }
  if (day === 6) { // Saturday
    return firstValidRate(carpark.saturdayRate, carpark.weekdaysRate1, carpark.weekdaysRate2);
  }
  // Mon-Fri: combine both weekday rate fields so that the time-window matching
  // in parseTextRate can select the correct block (e.g. after-5pm
  // rates stored in weekdaysRate2 are invisible when only weekdaysRate1 is used).
  const parts = [carpark.weekdaysRate1, carpark.weekdaysRate2].filter(hasRate);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Calculates current real-time prices for map UI.
 */
export function calculateLiveRates(carpark: Carpark): LivePrices {
  // Always use SGT
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const hour = now.getHours();
  const day = now.getDay();

  if (!isShortTermParkingAvailable(carpark.shortTermParking, now)) {
    return {
      car: 'No Short-Term Parking',
      motorcycle: 'No Short-Term Parking',
      heavy: 'No Short-Term Parking'
    };
  }

  const isFree = checkIsFreeParkingActive(carpark.freeParking, now);

  if (isFree) {
    return {
      car: 'Free*',
      motorcycle: 'Free*',
      heavy: '$2.40/hr' // Assuming heavy vehicles do not benefit from FPS
    };
  }

  // --- NON-HDB CUSTOM PARSABLE RATES ---
  if (carpark.source === 'lta' || carpark.source === 'supplemental') {
    const rateText = getTargetTextRate(carpark, day, now);
    const parsed = parseTextRate(rateText, hour);

    if (parsed !== null) {
        if (parsed.basis === 'free') {
          return { car: 'Free*', motorcycle: 'Free*', heavy: 'Free*' };
        }
        const parsedStr = parsed.basis === 'hour'
          ? `$${parsed.amount.toFixed(2)}/hr`
          : parsed.basis === 'entry'
            ? `$${parsed.amount.toFixed(2)}/entry`
            : rateText || 'Rate unavailable';
        return {
          car: parsedStr,
          motorcycle: 'No Data',
          heavy: 'No Data'
        };
    } else {
        // Fallback for empty or truly completely unparsable edgecases.
        return {
          car: rateText || 'Rate unavailable',
          motorcycle: 'No Data',
          heavy: 'No Data'
        };
    }
  }

  // --- CAR ---
  let carPriceStr = '$1.20/hr'; // Standard non-central or central non-office-hours
  const hasPeakData = !!PEAK_CARPARKS[carpark.id];

  if (carpark.isPeak && hasPeakData) {
    if (isPeakActive(carpark.id, day, hour)) {
      if (carpark.isCentral) {
        if (day >= 1 && day <= 6 && hour >= 7 && hour < 17) {
          carPriceStr = '$2.80/hr';
        } else {
          carPriceStr = '$1.60/hr';
        }
      } else {
        carPriceStr = '$1.60/hr';
      }
    } else {
      // Standard rates apply outside peak. Central bounds apply? 
      // HDB says: Central $1.20 per half hour from 7am-5pm. Outside 5pm it's $0.60.
      if (carpark.isCentral && day >= 1 && day <= 6 && hour >= 7 && hour < 17) {
        carPriceStr = '$2.40/hr';
      } else {
        carPriceStr = '$1.20/hr';
      }
    }
  } else if (carpark.isPeak) {
    // Without exact data, return standard but with warning
    if (carpark.isCentral && day >= 1 && day <= 6 && hour >= 7 && hour < 17) {
      carPriceStr = '$2.40/hr (Peak surcharge may apply)';
    } else {
      carPriceStr = '$1.20/hr (Peak surcharge may apply)';
    }
  } else if (carpark.isCentral) {
    // Normal central rules: 7am - 5pm Mon-Sat is double
    if (day >= 1 && day <= 6 && hour >= 7 && hour < 17) {
      carPriceStr = '$2.40/hr';
    } else {
      carPriceStr = '$1.20/hr';
    }
  }

  // --- MOTORCYCLE ---
  const motorcyclePriceStr = '$0.65/lot';

  // --- HEAVY VEHICLE ---
  const heavyPriceStr = '$2.40/hr';

  return {
    car: carPriceStr,
    motorcycle: motorcyclePriceStr,
    heavy: heavyPriceStr
  };
}

/**
 * Extracts a numeric value from the live car rate for sorting purposes.
 * Returns Infinity when no comparable rate is known so unknown prices sort last.
 */
export function getNumericLiveCarRate(carpark: Carpark): number {
  if (carpark.source === 'lta' || carpark.source === 'supplemental') {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
    const parsed = parseTextRate(
      getTargetTextRate(carpark, now.getDay(), now),
      now.getHours(),
    );
    if (!parsed || parsed.basis === 'unknown') return Number.POSITIVE_INFINITY;
    return parsed.amount;
  }

  const live = calculateLiveRates(carpark);
  const str = live.car;
  if (str.includes('Free')) return 0;
  if (str.includes('No Short-Term')) return Number.POSITIVE_INFINITY;

  const match = str.match(/\$([0-9.]+)/);
  if (match) return parseFloat(match[1]);
  return Number.POSITIVE_INFINITY;
}

/**
 * Generates detailed breakdowns for the detail page.
 */
export function generatePricingBreakdown(carpark: Carpark) {
  const breakdown = {
    car: [] as string[],
    motorcycle: [] as string[],
    heavy: [] as string[]
  };

  if (carpark.shortTermParking === 'NO') {
    const unav = "Short-term parking completely unavailable";
    return { car: [unav], motorcycle: [unav], heavy: [unav] };
  }

  const shortTermMsg = carpark.shortTermParking && carpark.shortTermParking !== 'WHOLE DAY'
    ? `⚠️ Short-term parking is ONLY allowed during: ${carpark.shortTermParking}`
    : "Short-term parking allowed Whole Day.";

  // --- NON-HDB RAW RATE DISPLAY ---
  if (carpark.source === 'lta' || carpark.source === 'supplemental') {
    return {
      car: [
        shortTermMsg,
        carpark.weekdaysRate1 ? `Daily: ${carpark.weekdaysRate1}` : null,
        carpark.weekdaysRate2 ? `Daily (Alt): ${carpark.weekdaysRate2}` : null,
        carpark.saturdayRate ? `Saturday: ${carpark.saturdayRate}` : null,
        carpark.sundayPhRate ? `Sunday & PH: ${carpark.sundayPhRate}` : null,
      ].filter((line): line is string => line !== null),
      motorcycle: ["Rate varies. Please see operator's signage."],
      heavy: ["Rate varies. Please see operator's signage."]
    };
  }

  breakdown.car.push(shortTermMsg);
  breakdown.motorcycle.push(shortTermMsg);
  breakdown.heavy.push(shortTermMsg);

  // Car Details
  if (carpark.isPeak) {
    const peakStr = PEAK_CARPARKS[carpark.id] ? "during specific peak hours" : "(Specific Peak-hour surcharge may apply)";
    if (carpark.isCentral) {
      breakdown.car.push(`Peak Hours (Mon-Sat 7am-5pm): $1.40 per half-hour ${peakStr}`);
      breakdown.car.push(`Peak Hours (Other Hours): $0.80 per half-hour ${peakStr}`);
      breakdown.car.push("Non-Peak (Mon-Sat 7am-5pm): $1.20 per half-hour");
      breakdown.car.push("Non-Peak (Other Hours): $0.60 per half-hour");
    } else {
      breakdown.car.push(`Peak Hours: $0.80 per half-hour ${peakStr}`);
      breakdown.car.push("Other Hours: $0.60 per half-hour");
    }
  } else if (carpark.isCentral) {
    breakdown.car.push("Mon-Sat (7:00am to 5:00pm): $1.20 per half-hour");
    breakdown.car.push("Other Hours: $0.60 per half-hour");
  } else {
    breakdown.car.push("All Hours: $0.60 per half-hour");
  }

  // Caps
  if (!carpark.isPeak) {
    if (carpark.nightParking) {
      breakdown.car.push("Night Cap: $5.00 from 10:30pm to 7:00am");
      const cap = carpark.isCentral ? "$20.00" : "$12.00";
      breakdown.car.push(`Whole-day Cap: ${cap} (7:00am to 7:00am next day)`);
    } else {
      const cap = carpark.isCentral ? "$20.00" : "$12.00";
      breakdown.car.push(`Day Cap (7:00am to 10:30pm): ${cap}`);
    }
  } else {
    breakdown.car.push("Caps: Whole-day caps are not applicable to peak-hour carparks.");
  }

  if (carpark.freeParking && carpark.freeParking !== 'NO') {
    breakdown.car.push(`Free Parking: ${carpark.freeParking}`);
    breakdown.car.push("* Free parking excludes season-parking-reserved lots");
  }

  // Motorcycle Details
  breakdown.motorcycle.push("Whole Day (7:00am to 10:30pm): $0.65 per lot");
  breakdown.motorcycle.push("Whole Night (10:30pm to 7:00am): $0.65 per lot");
  if (carpark.freeParking && carpark.freeParking !== 'NO') {
    breakdown.motorcycle.push(`Free Parking: ${carpark.freeParking}`);
    breakdown.motorcycle.push("* Free parking excludes season-parking-reserved lots");
  }

  // Heavy Details
  breakdown.heavy.push("All Hours: $1.20 per half-hour ($2.40/hr)");

  return breakdown;
}
