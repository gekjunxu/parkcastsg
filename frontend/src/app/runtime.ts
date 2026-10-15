const runtimeEnv = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>
}).env;
const configuredApiBase = runtimeEnv?.VITE_API_BASE_URL?.trim();

export const APP_BASE_PATH =
    runtimeEnv?.BASE_URL === '/' || !runtimeEnv?.BASE_URL
        ? ''
        : runtimeEnv.BASE_URL.replace(/\/$/, '');

export const API_BASE = configuredApiBase || APP_BASE_PATH;
