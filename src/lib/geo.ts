/**
 * Shared visitor-location resolver.
 *
 * Resolves the visitor's approximate location through the same chain the weather
 * feature uses:
 *   1. https://ipapi.co/json/
 *   2. https://ip-api.com/json/?fields=city,regionName,country,lat,lon
 *   3. browser Geolocation API
 *   4. New York fallback
 *
 * The chain is IP-first, so the common path never triggers a permission prompt;
 * the browser Geolocation step is only reached when both IP sources fail.
 *
 * The result is memoized at module scope: the first caller kicks off the
 * resolution and every subsequent caller (weather card, local news, …) awaits
 * the same in-flight promise. This guarantees the location is resolved exactly
 * once per session and that all features agree on a single location.
 */

export interface GeoData {
  lat: number;
  lon: number;
  city: string;
}

interface IpapiResponse {
  latitude?: number;
  longitude?: number;
  city?: string;
}

interface IpApiResponse {
  lat?: number;
  lon?: number;
  city?: string;
}

export const FALLBACK_GEO: GeoData = { lat: 40.7128, lon: -74.006, city: 'New York' };

let cached: Promise<GeoData> | null = null;

async function resolveGeoLocation(): Promise<GeoData> {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const geo = (await res.json()) as IpapiResponse;
      if (geo.latitude && geo.longitude) {
        return { lat: geo.latitude, lon: geo.longitude, city: geo.city || 'Your area' };
      }
    }
  } catch {
    /* try next source */
  }
  try {
    const res = await fetch('https://ip-api.com/json/?fields=city,regionName,country,lat,lon', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const geo = (await res.json()) as IpApiResponse;
      if (geo.lat && geo.lon) {
        return { lat: geo.lat, lon: geo.lon, city: geo.city || 'Your area' };
      }
    }
  } catch {
    /* try next source */
  }
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
    });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude, city: 'Your area' };
  } catch {
    /* fall through to default */
  }
  return FALLBACK_GEO;
}

/**
 * Resolve the visitor's location, sharing a single resolution across all callers.
 * Always resolves (never rejects) — falls back to {@link FALLBACK_GEO}.
 */
export function getGeoLocation(): Promise<GeoData> {
  if (!cached) {
    // If resolution somehow throws synchronously, don't poison the cache.
    cached = resolveGeoLocation().catch(() => FALLBACK_GEO);
  }
  return cached;
}
