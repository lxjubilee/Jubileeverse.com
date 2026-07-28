'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './weather.module.css';

/* ----------------------------------------------------------------------------
   Weather page — faithful port of the original static weather.html.

   Data sources are KEPT EXACTLY as the original and are called directly from
   the browser (NOT via our API):
     - Geolocation: https://ipapi.co/json/  then  https://ip-api.com/json/?fields=...
       then the browser Geolocation API, finally a New York fallback.
     - Forecast:    https://api.open-meteo.com/v1/forecast?...  (same query params).
   Header / nav / footer are provided by the (site) layout, so they are not
   rendered here (the original page's standalone header is intentionally dropped).
---------------------------------------------------------------------------- */

const weatherIcons: Record<number, string> = {
  0: '☀️',
  1: '🌤️',
  2: '⛅',
  3: '☁️',
  45: '🌫️',
  48: '🌫️',
  51: '🌦️',
  53: '🌧️',
  55: '🌧️',
  56: '🌨️',
  57: '🌨️',
  61: '🌦️',
  63: '🌧️',
  65: '🌧️',
  66: '🌨️',
  67: '🌨️',
  71: '🌨️',
  73: '❄️',
  75: '❄️',
  77: '🌨️',
  80: '🌦️',
  81: '🌧️',
  82: '⛈️',
  85: '🌨️',
  86: '❄️',
  95: '⛈️',
  96: '⛈️',
  99: '⛈️',
};

const weatherDescriptions: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Mod. showers',
  82: 'Heavy showers',
  85: 'Light snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm w/ hail',
  99: 'Severe thunderstorm',
};

/** Resolved location used for the forecast query. */
interface GeoData {
  lat: number;
  lon: number;
  city: string;
  region: string;
  country: string;
}

/* --- Minimal types for the slices of the Open-Meteo response we read --- */
interface OpenMeteoCurrent {
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  weather_code: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  surface_pressure: number;
  uv_index?: number;
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  weather_code: number[];
}

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  weather_code: number[];
  sunrise?: string[];
  sunset?: string[];
  uv_index_max?: number[];
  precipitation_probability_max?: number[];
}

interface OpenMeteoResponse {
  current: OpenMeteoCurrent;
  hourly: OpenMeteoHourly;
  daily: OpenMeteoDaily;
}

/* --- Shapes of the third-party IP-geolocation responses --- */
interface IpapiResponse {
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country_name?: string;
}

interface IpApiResponse {
  lat?: number;
  lon?: number;
  city?: string;
  regionName?: string;
  country?: string;
}

/* --- Open-Meteo geocoding (city name -> coordinates) response slice --- */
interface GeocodingResult {
  latitude: number;
  longitude: number;
  name: string;
  admin1?: string;
  country_code?: string;
  country?: string;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

/**
 * Resolve a typed city name to real coordinates via Open-Meteo's geocoding API.
 * Returns null when the city can't be found so the caller can show an error.
 */
async function geocodeCity(city: string): Promise<GeoData | null> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}` +
    `&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as GeocodingResponse;
  const top = data.results?.[0];
  if (!top) return null;
  return {
    lat: top.latitude,
    lon: top.longitude,
    city: top.name,
    region: top.admin1 || '',
    country: top.country_code || top.country || '',
  };
}

/** localStorage key for caching the resolved location (original had none). */
const LOCATION_CACHE_KEY = 'jubileeWeatherLocation';

/** Auto-detected locations go stale after 30 minutes (manual ones never do). */
const LOCATION_CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedLocation {
  geo: GeoData;
  savedAt: number;
  /** True when the user explicitly picked this city (sticky until changed). */
  manual: boolean;
}

const FALLBACK_GEO: GeoData = {
  lat: 40.7128,
  lon: -74.006,
  city: 'New York',
  region: 'NY',
  country: 'United States',
};

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Read the cached location. Auto-detected entries older than the TTL are
 * treated as stale (returns null) so we re-detect after a move/VPN change;
 * manual selections are sticky and never expire.
 */
function readCachedLocation(): GeoData | null {
  try {
    const raw = localStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedLocation> & Partial<GeoData>;

    // New shape: { geo, savedAt, manual }.
    if (parsed.geo && typeof parsed.geo.lat === 'number' && typeof parsed.geo.lon === 'number') {
      const fresh =
        parsed.manual === true ||
        (typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt < LOCATION_CACHE_TTL_MS);
      if (!fresh) return null;
      return {
        lat: parsed.geo.lat,
        lon: parsed.geo.lon,
        city: parsed.geo.city || 'Unknown',
        region: parsed.geo.region || '',
        country: parsed.geo.country || '',
      };
    }

    // Legacy shape: a bare GeoData object (no timestamp) — treat as stale so it
    // gets refreshed once, then re-written in the new format.
    return null;
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

function writeCachedLocation(geo: GeoData, manual: boolean): void {
  try {
    const payload: CachedLocation = { geo, savedAt: Date.now(), manual };
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function clearCachedLocation(): void {
  try {
    localStorage.removeItem(LOCATION_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** Resolve the user's location — same order/sources as the original page. */
async function getGeoLocation(): Promise<GeoData> {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const geo = (await res.json()) as IpapiResponse;
      if (geo.latitude && geo.longitude) {
        return {
          lat: geo.latitude,
          lon: geo.longitude,
          city: geo.city || 'Unknown',
          region: geo.region || '',
          country: geo.country_name || '',
        };
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
        return {
          lat: geo.lat,
          lon: geo.lon,
          city: geo.city || 'Unknown',
          region: geo.regionName || '',
          country: geo.country || '',
        };
      }
    }
  } catch {
    /* try next source */
  }
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
    });
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      city: 'Your Location',
      region: '',
      country: '',
    };
  } catch {
    /* fall through to default */
  }
  return FALLBACK_GEO;
}

async function fetchForecast(geo: GeoData): Promise<OpenMeteoResponse> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,uv_index` +
    `&hourly=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max,precipitation_probability_max` +
    `&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  return (await res.json()) as OpenMeteoResponse;
}

export default function WeatherPage() {
  const [geoData, setGeoData] = useState<GeoData | null>(null);
  const [weatherData, setWeatherData] = useState<OpenMeteoResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [useCelsius, setUseCelsius] = useState(true);
  const [cityQuery, setCityQuery] = useState('');
  const [cityError, setCityError] = useState<string | null>(null);
  const didLoad = useRef(false);

  const toF = (c: number) => Math.round((c * 9) / 5 + 32);
  const displayTemp = (c: number) => (useCelsius ? Math.round(c) : toF(c));
  const unitLabel = () => (useCelsius ? '°C' : '°F');

  /**
   * Load the forecast for a location.
   *   - override given + manual=true  → sticky manual city selection
   *   - override given + manual=false → auto-detected (e.g. fallback), TTL'd
   *   - no override                   → cached (if fresh) else auto-detect
   */
  const load = useCallback(async (override?: GeoData, manual = false) => {
    setStatus('loading');
    try {
      const cached = override ? null : readCachedLocation();
      const geo = override ?? cached ?? (await getGeoLocation());
      setGeoData(geo);
      // Only (re)write the cache when we resolved a NEW location; reusing a
      // fresh cached entry must not reset its TTL or its manual flag.
      if (override || !cached) writeCachedLocation(geo, manual);
      const data = await fetchForecast(geo);
      setWeatherData(data);
      setStatus('ready');
    } catch (err) {
      console.error('Weather page error:', err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void load();
  }, [load]);

  /* Manual entry: geocode the typed city to REAL coordinates via Open-Meteo and
     load the forecast there (sticky until the user changes it). */
  const submitCity = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = cityQuery.trim();
    if (!query) return;
    setCityError(null);
    setStatus('loading');
    try {
      const geo = await geocodeCity(query);
      if (!geo) {
        setCityError(`Couldn't find "${query}". Try a different city name.`);
        // Restore the previous view rather than dropping into the error screen.
        setStatus(weatherData && geoData ? 'ready' : 'error');
        return;
      }
      await load(geo, true);
    } catch (err) {
      console.error('Geocoding error:', err);
      setCityError('Could not look up that city. Please try again.');
      setStatus(weatherData && geoData ? 'ready' : 'error');
    }
  };

  /* "Use my current location": clear the cache (including sticky manual picks)
     and re-detect the current location fresh. */
  const useCurrentLocation = () => {
    setCityError(null);
    setCityQuery('');
    clearCachedLocation();
    void load(); // no override → re-detects and re-caches (manual=false)
  };

  if (status === 'loading') {
    return (
      <div className={styles.weatherPage}>
        <div className={styles.weatherLoading}>
          <div className={styles.weatherLoadingSpinner} />
          <div className={styles.loadingText}>Loading weather data...</div>
        </div>
      </div>
    );
  }

  if (status === 'error' || !weatherData || !geoData) {
    return (
      <div className={styles.weatherPage}>
        <div className={styles.weatherLoading}>
          <div className={styles.errorIcon}>⚠️</div>
          <div className={styles.errorText}>Unable to load weather data</div>
          <button className={styles.tryAgainBtn} onClick={() => void load()}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const current = weatherData.current;
  const hourly = weatherData.hourly;
  const daily = weatherData.daily;

  const code = current.weather_code;
  const icon = weatherIcons[code] || '🌡️';
  const desc = weatherDescriptions[code] || 'Unknown';
  const temp = current.temperature_2m;
  const feelsLike = current.apparent_temperature;
  const humidity = current.relative_humidity_2m;
  const windSpeed = Math.round(current.wind_speed_10m);
  const windDir = current.wind_direction_10m;
  const pressure = Math.round(current.surface_pressure);
  const uvIndex = current.uv_index || 0;
  const high = daily.temperature_2m_max[0];
  const low = daily.temperature_2m_min[0];

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const locationStr = [geoData.city, geoData.region].filter(Boolean).join(', ');

  const windDirText = WIND_DIRS[Math.round(windDir / 45) % 8];

  let uvLevel = 'Low';
  if (uvIndex >= 8) uvLevel = 'Very High';
  else if (uvIndex >= 6) uvLevel = 'High';
  else if (uvIndex >= 3) uvLevel = 'Moderate';

  const sunrise = daily.sunrise
    ? new Date(daily.sunrise[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '--';
  const sunset = daily.sunset
    ? new Date(daily.sunset[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '--';

  // Hourly forecast (next 24 hours starting from the current hour).
  let hourStart = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    if (new Date(hourly.time[i]) >= now) {
      hourStart = i;
      break;
    }
  }
  const hourlyItems: { key: number; time: string; icon: string; temp: number; isNow: boolean }[] =
    [];
  for (let i = hourStart; i < Math.min(hourStart + 24, hourly.time.length); i++) {
    const hDate = new Date(hourly.time[i]);
    hourlyItems.push({
      key: i,
      time: i === hourStart ? 'Now' : hDate.toLocaleTimeString('en-US', { hour: 'numeric' }),
      icon: weatherIcons[hourly.weather_code[i]] || '🌡️',
      temp: displayTemp(hourly.temperature_2m[i]),
      isNow: i === hourStart,
    });
  }

  // Daily forecast.
  const dailyItems = daily.time.map((t, i) => {
    const d = new Date(t);
    const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES_SHORT[d.getDay()];
    const dDesc = weatherDescriptions[daily.weather_code[i]] || '';
    const precip = daily.precipitation_probability_max
      ? daily.precipitation_probability_max[i] || 0
      : 0;
    return {
      key: i,
      day: dayLabel,
      icon: weatherIcons[daily.weather_code[i]] || '🌡️',
      desc: precip > 0 ? `${dDesc} · ${precip}% rain` : dDesc,
      high: displayTemp(daily.temperature_2m_max[i]),
      low: displayTemp(daily.temperature_2m_min[i]),
    };
  });

  return (
    <div className={styles.weatherPage}>
      <div className={styles.currentHero}>
        <div className={styles.currentHeroTop}>
          <div>
            <div className={styles.currentCity}>
              <svg viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
              {locationStr}
            </div>
            <div className={styles.currentDate}>{dateStr}</div>
          </div>
          <div className={styles.unitToggle}>
            <button
              className={useCelsius ? styles.active : ''}
              onClick={() => setUseCelsius(true)}
            >
              °C
            </button>
            <button
              className={!useCelsius ? styles.active : ''}
              onClick={() => setUseCelsius(false)}
            >
              °F
            </button>
          </div>
        </div>
        <div className={styles.currentMain}>
          <div className={styles.currentIcon}>{icon}</div>
          <div className={styles.currentTemp}>
            {displayTemp(temp)}
            <sup>{unitLabel()}</sup>
          </div>
        </div>
        <div className={styles.currentInfo}>
          <div className={styles.currentDesc}>{desc}</div>
          <div className={styles.currentHl}>
            Feels like {displayTemp(feelsLike)}° &middot; H:{displayTemp(high)}° L:
            {displayTemp(low)}°
          </div>
        </div>
      </div>

      <div className={styles.detailsGrid}>
        <div className={styles.detailCard}>
          <div className={styles.detailCardLabel}>Feels Like</div>
          <div className={styles.detailCardValue}>
            {displayTemp(feelsLike)}
            {unitLabel()}
          </div>
        </div>
        <div className={styles.detailCard}>
          <div className={styles.detailCardLabel}>Humidity</div>
          <div className={styles.detailCardValue}>{humidity}%</div>
        </div>
        <div className={styles.detailCard}>
          <div className={styles.detailCardLabel}>Wind</div>
          <div className={styles.detailCardValue}>{windSpeed} km/h</div>
          <div className={styles.detailCardExtra}>{windDirText} direction</div>
        </div>
        <div className={styles.detailCard}>
          <div className={styles.detailCardLabel}>Pressure</div>
          <div className={styles.detailCardValue}>{pressure} hPa</div>
        </div>
        <div className={styles.detailCard}>
          <div className={styles.detailCardLabel}>UV Index</div>
          <div className={styles.detailCardValue}>{Math.round(uvIndex)}</div>
          <div className={styles.detailCardExtra}>{uvLevel}</div>
        </div>
        <div className={styles.detailCard}>
          <div className={styles.detailCardLabel}>Sunrise / Sunset</div>
          <div className={`${styles.detailCardValue} ${styles.detailCardValueSmall}`}>
            🌅 {sunrise}
          </div>
          <div className={styles.detailCardExtra}>🌇 {sunset}</div>
        </div>
      </div>

      <div className={styles.sectionTitle}>Hourly Forecast</div>
      <div className={styles.hourlyScroll}>
        {hourlyItems.map((h) => (
          <div
            key={h.key}
            className={`${styles.hourlyItem} ${h.isNow ? styles.now : ''}`}
          >
            <div className={styles.hourlyTime}>{h.time}</div>
            <div className={styles.hourlyIcon}>{h.icon}</div>
            <div className={styles.hourlyTemp}>{h.temp}°</div>
          </div>
        ))}
      </div>

      <div className={styles.sectionTitle}>7-Day Forecast</div>
      <div className={styles.dailyList}>
        {dailyItems.map((d) => (
          <div key={d.key} className={styles.dailyItem}>
            <div className={styles.dailyDay}>{d.day}</div>
            <div className={styles.dailyIcon}>{d.icon}</div>
            <div className={styles.dailyDesc}>{d.desc}</div>
            <div className={styles.dailyTemps}>
              <span className={styles.dailyLow}>{d.low}°</span>
              <div className={styles.dailyBar} />
              <span className={styles.dailyHigh}>{d.high}°</span>
            </div>
          </div>
        ))}
      </div>

      {/* Manual location entry — geocodes the typed city to real coordinates via
          Open-Meteo's geocoding API and loads the forecast there. The selection
          is sticky (cached) until the user changes it or uses "current location". */}
      <form className={styles.cityForm} onSubmit={(e) => void submitCity(e)}>
        <input
          className={styles.cityInput}
          placeholder="Wrong location? Enter a city name"
          value={cityQuery}
          onChange={(e) => {
            setCityQuery(e.target.value);
            if (cityError) setCityError(null);
          }}
        />
        <button type="submit" className={styles.tryAgainBtn}>
          Update Location
        </button>
        <button type="button" className={styles.useLocationBtn} onClick={useCurrentLocation}>
          Use my current location
        </button>
      </form>
      {cityError ? <div className={styles.cityError}>{cityError}</div> : null}
    </div>
  );
}
