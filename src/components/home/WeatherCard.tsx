'use client';

/**
 * Compact in-feed Weather widget. Resolves the visitor's location via the shared
 * resolver in `@/lib/geo` (IP-first chain, memoized across the weather card and
 * local news so location is resolved once per session), then fetches the
 * *current* conditions from Open-Meteo and shows city, temp, an emoji icon and
 * the condition text. Clicking navigates to the full /weather page. Fails
 * gracefully: if anything throws it renders nothing.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from '@/app/(site)/home.module.css';
import { getGeoLocation, type GeoData } from '@/lib/geo';

const weatherIcons: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌧️',
  55: '🌧️', 56: '🌨️', 57: '🌨️', 61: '🌦️', 63: '🌧️', 65: '🌧️', 66: '🌨️',
  67: '🌨️', 71: '🌨️', 73: '❄️', 75: '❄️', 77: '🌨️', 80: '🌦️', 81: '🌧️',
  82: '⛈️', 85: '🌨️', 86: '❄️', 95: '⛈️', 96: '⛈️', 99: '⛈️',
};

const weatherDescriptions: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy',
  48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  56: 'Freezing drizzle', 57: 'Heavy freezing drizzle', 61: 'Light rain',
  63: 'Moderate rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Mod. showers', 82: 'Heavy showers', 85: 'Light snow showers',
  86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm w/ hail',
  99: 'Severe thunderstorm',
};

interface OpenMeteoCurrent {
  temperature_2m: number;
  weather_code: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
}

async function fetchCurrent(geo: GeoData): Promise<OpenMeteoResponse> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&current=temperature_2m,weather_code&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return (await res.json()) as OpenMeteoResponse;
}

interface Summary {
  city: string;
  temp: number;
  icon: string;
  condition: string;
}

export default function WeatherCard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const didLoad = useRef(false);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    let cancelled = false;
    (async () => {
      try {
        const geo = await getGeoLocation();
        const data = await fetchCurrent(geo);
        const code = data.current?.weather_code ?? 0;
        if (!cancelled && data.current) {
          setSummary({
            city: geo.city,
            temp: Math.round(data.current.temperature_2m),
            icon: weatherIcons[code] || '🌡️',
            condition: weatherDescriptions[code] || 'Current weather',
          });
        } else if (!cancelled) {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fail gracefully — render nothing if data could not be loaded.
  if (failed) return null;

  return (
    <Link className={styles.widgetCard} href="/weather">
      <div className={styles.widgetHead}>
        <span className={styles.widgetKicker}>Weather</span>
        <span className={styles.widgetArrow}>→</span>
      </div>
      {summary ? (
        <div className={styles.widgetBody}>
          <div className={styles.weatherTop}>
            <span className={styles.weatherIcon}>{summary.icon}</span>
            <span className={styles.weatherTemp}>{summary.temp}°</span>
          </div>
          <div className={styles.weatherCity}>{summary.city}</div>
          <div className={styles.weatherCond}>{summary.condition}</div>
          <div className={styles.widgetFoot}>Tap for the full forecast</div>
        </div>
      ) : (
        <div className={styles.widgetBody}>
          <div className={styles.weatherCond}>Loading local weather…</div>
        </div>
      )}
    </Link>
  );
}
