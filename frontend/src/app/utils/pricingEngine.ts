import { isSundayOrPublicHoliday, SINGAPORE_PUBLIC_HOLIDAYS_YYYY_MM_DD } from './holidays';
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

const DOWNTOWN_EAST_PRICING_NOTE =
  "Note: School holidays use the Fri–Sun tariff, but the app doesn't detect school-holiday dates automatically. The 9pm–5am free-parking offer applies only to Begonia Open Air Carpark.";

function isDowntownEast(carpark: Carpark): boolean {
  return carpark.name.trim().toLowerCase() === 'downtown east';
}

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
  const normalizedTime = timeStr.trim().replace(/\s+/g, '');
  const match = normalizedTime.match(/^(\d+)(?:\.(\d+))?(AM|PM|MN|MIDNIGHT)$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const min = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3].toUpperCase();

  if (ampm === 'PM' && hour < 12) hour += 12;
  if ((ampm === 'AM' || ampm === 'MN' || ampm === 'MIDNIGHT') && hour === 12) hour = 0;

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

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_NAME_PATTERN = '(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)';

function dayIndex(dayName: string): number {
  const shortName = dayName.slice(0, 3).toLowerCase();
  return DAY_NAMES.indexOf(shortName as typeof DAY_NAMES[number]);
}

function segmentAppliesToDay(segment: string, currentDay: number | undefined): boolean {
  if (currentDay === undefined || currentDay < 0 || currentDay > 6) return true;

  const dayMatches = [...segment.matchAll(new RegExp(`\\b${DAY_NAME_PATTERN}\\b`, 'gi'))];
  if (dayMatches.length === 0) return true;

  const clock = '(?:[0-9]+(?:\\.[0-9]+)?\\s*(?:am|pm|mn|midnight)|[0-9]{4})';
  const conditionPositions = [
    segment.search(new RegExp(`(${clock})\\s*(?:-|to)\\s*(${clock})`, 'i')),
    segment.search(/aft(?:er)?\s*[0-9]+(?:\.[0-9]+)?(?:am|pm)/i),
    segment.indexOf('$'),
  ].filter(position => position >= 0);
  const firstConditionPosition = conditionPositions.length > 0
    ? Math.min(...conditionPositions)
    : Number.POSITIVE_INFINITY;
  if ((dayMatches[0].index ?? Number.POSITIVE_INFINITY) >= firstConditionPosition) return true;

  const namedDays = dayMatches.map(match => dayIndex(match[0]));

  const applicableDays = new Set(namedDays.filter(day => day >= 0));
  const range = segment.match(new RegExp(`\\b(${DAY_NAME_PATTERN})\\s*(?:[-–]|\\bto\\b)\\s*(${DAY_NAME_PATTERN})\\b`, 'i'));
  if (range) {
    const start = dayIndex(range[1]);
    const end = dayIndex(range[2]);
    if (start >= 0 && end >= 0) {
      let day = start;
      for (let count = 0; count < 7; count += 1) {
        applicableDays.add(day);
        if (day === end) break;
        day = (day + 1) % 7;
      }
    }
  }

  return applicableDays.has(currentDay);
}

function getSegmentTimeWindow(segment: string): { startHour: number; endHour: number } | null {
  const clock = '(?:[0-9]+(?:\\.[0-9]+)?\\s*(?:am|pm|mn|midnight)|[0-9]{4})';
  const timeWindowMatch = segment.match(new RegExp(`(${clock})\\s*(?:-|to)\\s*(${clock})`, 'i'));
  if (!timeWindowMatch) return null;

  const parseBoundary = (value: string) => parseHourBoundary(value) ?? parseInt(value.slice(0, 2), 10);
  const startHour = parseBoundary(timeWindowMatch[1]);
  const endHour = parseBoundary(timeWindowMatch[2]);
  return Number.isNaN(startHour) || Number.isNaN(endHour) ? null : { startHour, endHour };
}

function isHourInWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

function parseRateSegment(segment: string): ParsedTextRate | null {
  const lower = segment.toLowerCase();

  if (lower.includes('free') && (lower.includes('daily') || /free\s+(?:lunch|parking)|(?:lunch|parking)[^;]*\bfree/.test(lower))) {
    return { amount: 0, basis: 'free' };
  }

  let match: RegExpMatchArray | null;

  // $X for 1st hr (Placed FIRST so base rate is extracted)
  match = lower.match(/\$([0-9.]+).*?1st(?:\s?[0-9])?\s?hr/);
  if (match) return { amount: parseFloat(match[1]), basis: 'hour' };

  // $X per hr
  match = lower.match(/\$([0-9.]+)\s*(?:per\s*|\/\s*)(?:hr|hour)\b/);
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
  match = lower.match(/\$([0-9.]+)\s*(?:per\s+|\/\s*)entry/);
  if (match) return { amount: parseFloat(match[1]), basis: 'entry' };

  // $X /min or $X per min — convert to hourly
  match = lower.match(/\$([0-9.]+)\s*(?:per\s*min(?:ute)?|\/\s*min(?:ute)?)/);
  if (match) return { amount: parseFloat(match[1]) * 60, basis: 'hour' };

  // Simple fallback finding any $ amount
  match = lower.match(/\$([0-9.]+)/);
  if (match) return { amount: parseFloat(match[1]), basis: 'unknown' };

  return null;
}

/**
 * Parses the active rate clause from a text tariff into a comparable price.
 * Amounts and billing units are read from the same clause; optional day names
 * let callers select tariffs that differ across weekday groups.
 */
export function parseTextRate(
  rate: string | undefined,
  currentHour: number,
  currentDay?: number,
): ParsedTextRate | null {
  if (!rate || rate.trim() === '-' || rate.toLowerCase() === 'no') return null;

  const rawSegments = rate.toLowerCase().split(/\n|;/).map(s => s.trim()).filter(Boolean);
  const daySegments = rawSegments.filter(segment => segmentAppliesToDay(segment, currentDay));
  const explicitStarts = daySegments
    .map(segment => getSegmentTimeWindow(segment)?.startHour)
    .filter((hour): hour is number => hour !== undefined);

  let previousWindowActive = true;
  const activeSegments: string[] = [];

  for (const segment of rawSegments) {
    if (!segmentAppliesToDay(segment, currentDay)) continue;

    const window = getSegmentTimeWindow(segment);
    const aftMatch = segment.match(/aft(?:er)?\s*([0-9]+(?:\.[0-9]+)?(?:am|pm))/i);
    let inWindow: boolean = previousWindowActive;

    if (window) {
      inWindow = isHourInWindow(currentHour, window.startHour, window.endHour);
    } else if (aftMatch) {
      const startHour = parseHourBoundary(aftMatch[1]);
      if (startHour !== null && explicitStarts.length > 0) {
        const followingBoundary = explicitStarts.filter(hour => hour > startHour).sort((a, b) => a - b)[0]
          ?? explicitStarts.filter(hour => hour < startHour).sort((a, b) => a - b)[0];
        inWindow = followingBoundary === undefined
          ? currentHour >= startHour
          : isHourInWindow(currentHour, startHour, followingBoundary);
      } else if (startHour !== null) {
        inWindow = currentHour >= startHour;
      }
    }

    if (window || aftMatch) previousWindowActive = inWindow;
    if (inWindow) activeSegments.push(segment);
  }

  if (activeSegments.length === 0) return null;

  let firstKnown: ParsedTextRate | null = null;
  let firstUnknown: ParsedTextRate | null = null;
  for (const segment of activeSegments) {
    const parsed = parseRateSegment(segment);
    if (parsed?.basis === 'free') return parsed;
    if (parsed && parsed.basis !== 'unknown' && firstKnown === null) firstKnown = parsed;
    if (parsed && firstUnknown === null) firstUnknown = parsed;
  }

  return firstKnown ?? firstUnknown;
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

function isPublicHolidayEve(now: Date): boolean {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  return SINGAPORE_PUBLIC_HOLIDAYS_YYYY_MM_DD.has(dateKey);
}

/**
 * Selects the schedule for the supplied day, resolving common rate aliases.
 * @param now - SGT-adjusted Date, must match the `day` value passed in.
 */
function getWeekdayRateSchedule(carpark: Carpark): string | undefined {
  const rates = [carpark.weekdaysRate1, carpark.weekdaysRate2].filter(hasRate);
  return rates.length > 0 ? rates.join('\n') : undefined;
}

function resolveRateAlias(rate: string | undefined, carpark: Carpark): string | undefined {
  if (!hasRate(rate)) return undefined;
  if (/^same as (?:wkdays?|weekdays?)$/i.test(rate.trim())) {
    return getWeekdayRateSchedule(carpark);
  }
  if (/^same as (?:sat|saturday)$/i.test(rate.trim()) && hasRate(carpark.saturdayRate)) {
    return /^same as (?:sat|saturday)$/i.test(carpark.saturdayRate.trim())
      ? undefined
      : resolveRateAlias(carpark.saturdayRate, carpark);
  }
  return rate;
}

export function getTargetTextRate(carpark: Carpark, day: number, now: Date): string | undefined {
  // Downtown East publishes its public-holiday-eve tariff with the Fri-Sun rates.
  if (isDowntownEast(carpark) && isPublicHolidayEve(now)) {
    return resolveRateAlias(
      firstValidRate(carpark.saturdayRate, carpark.sundayPhRate),
      carpark,
    );
  }
  if (isSundayOrPublicHoliday(now)) {
    return resolveRateAlias(
      firstValidRate(carpark.sundayPhRate, carpark.weekdaysRate1, carpark.weekdaysRate2),
      carpark,
    );
  }
  if (day === 6) { // Saturday
    return resolveRateAlias(
      firstValidRate(carpark.saturdayRate, carpark.weekdaysRate1, carpark.weekdaysRate2),
      carpark,
    );
  }
  // Mon-Fri: combine both weekday rate fields so that the time-window matching
  // in parseTextRate can select the correct block (e.g. after-5pm
  // rates stored in weekdaysRate2 are invisible when only weekdaysRate1 is used).
  return getWeekdayRateSchedule(carpark);
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
  if (carpark.source === 'lta' || carpark.source === 'ura' || carpark.source === 'supplemental') {
    const rateText = getTargetTextRate(carpark, day, now);
    const parsed = parseTextRate(rateText, hour, day);

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
  if (carpark.source === 'lta' || carpark.source === 'ura' || carpark.source === 'supplemental') {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
    const parsed = parseTextRate(
      getTargetTextRate(carpark, now.getDay(), now),
      now.getHours(),
      now.getDay(),
    );
    if (!parsed || parsed.basis === 'unknown') return Number.POSITIVE_INFINITY;
    if (parsed.basis === 'entry') return Number.POSITIVE_INFINITY;
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
    return {
      car: [unav, ...(isDowntownEast(carpark) ? [DOWNTOWN_EAST_PRICING_NOTE] : [])],
      motorcycle: [unav],
      heavy: [unav],
    };
  }

  const shortTermMsg = carpark.shortTermParking && carpark.shortTermParking !== 'WHOLE DAY'
    ? `⚠️ Short-term parking is ONLY allowed during: ${carpark.shortTermParking}`
    : "Short-term parking allowed Whole Day.";

  // --- NON-HDB RAW RATE DISPLAY ---
  if (carpark.source === 'lta' || carpark.source === 'ura' || carpark.source === 'supplemental') {
    return {
      car: [
        shortTermMsg,
        carpark.weekdaysRate1 ? `Daily: ${carpark.weekdaysRate1}` : null,
        carpark.weekdaysRate2 ? `Daily (Alt): ${carpark.weekdaysRate2}` : null,
        carpark.saturdayRate ? `Saturday: ${resolveRateAlias(carpark.saturdayRate, carpark)}` : null,
        carpark.sundayPhRate ? `Sunday & PH: ${resolveRateAlias(carpark.sundayPhRate, carpark)}` : null,
        isDowntownEast(carpark) ? DOWNTOWN_EAST_PRICING_NOTE : null,
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
