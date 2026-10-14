const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim();

export const APP_BASE_PATH =
    import.meta.env.BASE_URL === '/'
        ? ''
        : import.meta.env.BASE_URL.replace(/\/$/, '');

export const API_BASE = configuredApiBase || APP_BASE_PATH;
