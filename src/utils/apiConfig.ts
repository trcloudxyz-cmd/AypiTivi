const API_BASE_STORAGE_KEY = 'akis_api_base_url_v1';
const DEFAULT_PACKAGED_API_BASE =
  'https://ais-pre-4vwbx72awcoyi7a3tb7cxl-656872196960.europe-west2.run.app';

export function isPackagedWebOsApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'file:';
}

export function getApiBaseUrl(): string {
  if (!isPackagedWebOsApp()) return '';
  try {
    const saved = localStorage.getItem(API_BASE_STORAGE_KEY)?.trim();
    if (saved) return saved.replace(/\/+$/, '');
  } catch {
    // Ignore storage read errors
  }
  const envBase = (import.meta as {env?: {VITE_API_BASE_URL?: string}}).env?.VITE_API_BASE_URL;
  if (envBase && envBase.trim()) {
    return envBase.trim().replace(/\/+$/, '');
  }
  return DEFAULT_PACKAGED_API_BASE;
}

export function setApiBaseUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '');
  try {
    if (cleaned) {
      localStorage.setItem(API_BASE_STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(API_BASE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage write errors
  }
  return getApiBaseUrl();
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function apiCredentials(): RequestCredentials {
  return isPackagedWebOsApp() ? 'omit' : 'include';
}
