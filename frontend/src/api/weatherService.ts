import { API_BASE } from '../app/runtime';

export interface WeatherForecastRaw {
    area: string;
    forecast: string;
    is_raining: boolean;
    valid_period: string;
}

export interface WeatherData {
    area: string;
    forecast: string;
    isRaining: boolean;
    validPeriod: string;
}

export async function getWeatherForecast(lat: number, lng: number): Promise<WeatherData> {
    const url = `${API_BASE}/api/v1/weather?lat=${lat}&lng=${lng}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Weather API error ${res.status}`);
    }
    const raw: WeatherForecastRaw = await res.json();
    return {
        area: raw.area,
        forecast: raw.forecast,
        isRaining: raw.is_raining,
        validPeriod: raw.valid_period,
    };
}
