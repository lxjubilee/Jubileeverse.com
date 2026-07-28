'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './finance.module.css';

/* ============================================================================
   Finance page — faithful port of the original static finance.html.

   Data source: the original page ships its market data as STATIC demo data
   embedded in the page script (financeDataSets) — there is NO backend/finance
   API. The only network calls are the geolocation lookups used to pick a
   region (United States / India / United Kingdom). Those are third-party
   services and stay as direct fetches:
     1. https://ipapi.co/json/            (primary)
     2. https://ip-api.com/json/?fields=  (fallback)
   If both fail, we default to the US data set, exactly like the original.

   The news cards in the original are static demo entries that do not link to
   real articles, so they remain non-navigating (matching the source).
   ============================================================================ */

interface IndexEntry {
  name: string;
  ticker: string;
  value: string;
  change: string;
  changeVal: string;
  positive: boolean;
}

interface SecurityEntry {
  name: string;
  ticker: string;
  price: string;
  change: string;
  positive: boolean;
}

interface NewsEntry {
  title: string;
  category: string;
  image: string;
  time: string;
}

interface MarketTab {
  id: string;
  label: string;
}

interface FinanceDataSet {
  region: string;
  currency: string;
  tabs: MarketTab[];
  indices: IndexEntry[];
  stocks: SecurityEntry[];
  crypto?: SecurityEntry[];
  mutualfunds?: SecurityEntry[];
  news: NewsEntry[];
}

const financeDataSets: Record<string, FinanceDataSet> = {
  US: {
    region: 'United States',
    currency: 'USD',
    tabs: [
      { id: 'indices', label: 'Indices' },
      { id: 'stocks', label: 'Stocks' },
      { id: 'crypto', label: 'Crypto' },
    ],
    indices: [
      { name: 'Dow Jones', ticker: 'DJI', value: '44,156.73', change: '+0.42%', changeVal: '+183.51', positive: true },
      { name: 'S&P 500', ticker: 'SPX', value: '6,012.28', change: '+0.58%', changeVal: '+34.67', positive: true },
      { name: 'NASDAQ', ticker: 'IXIC', value: '19,654.02', change: '+0.83%', changeVal: '+162.03', positive: true },
      { name: 'Russell 2000', ticker: 'RUT', value: '2,287.49', change: '-0.81%', changeVal: '-18.64', positive: false },
      { name: 'VIX', ticker: 'VIX', value: '14.85', change: '-3.24%', changeVal: '-0.50', positive: false },
    ],
    stocks: [
      { name: 'Apple Inc.', ticker: 'AAPL', price: '227.63', change: '+1.24%', positive: true },
      { name: 'Microsoft Corp.', ticker: 'MSFT', price: '415.50', change: '+0.89%', positive: true },
      { name: 'NVIDIA Corp.', ticker: 'NVDA', price: '875.28', change: '+2.15%', positive: true },
      { name: 'Amazon.com Inc.', ticker: 'AMZN', price: '186.40', change: '+0.67%', positive: true },
      { name: 'Alphabet Inc.', ticker: 'GOOGL', price: '198.41', change: '+1.12%', positive: true },
      { name: 'Meta Platforms', ticker: 'META', price: '638.40', change: '+0.89%', positive: true },
      { name: 'Tesla Inc.', ticker: 'TSLA', price: '248.50', change: '-1.23%', positive: false },
      { name: 'Berkshire Hathaway', ticker: 'BRK.B', price: '456.78', change: '+0.34%', positive: true },
    ],
    crypto: [
      { name: 'Bitcoin', ticker: 'BTC-USD', price: '101,350.00', change: '+2.41%', positive: true },
      { name: 'Ethereum', ticker: 'ETH-USD', price: '3,245.80', change: '+1.87%', positive: true },
      { name: 'Solana', ticker: 'SOL-USD', price: '198.45', change: '+4.23%', positive: true },
      { name: 'XRP', ticker: 'XRP-USD', price: '2.34', change: '-0.85%', positive: false },
      { name: 'Cardano', ticker: 'ADA-USD', price: '0.89', change: '+1.12%', positive: true },
    ],
    news: [
      { title: 'Fed Signals Potential Rate Cuts in Second Half of 2026', category: 'Economy', image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=200&fit=crop', time: '2 hours ago' },
      { title: 'Tech Giants Report Record Earnings Amid AI Boom', category: 'Technology', image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&h=200&fit=crop', time: '3 hours ago' },
      { title: 'Oil Prices Surge on Middle East Supply Concerns', category: 'Commodities', image: 'https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=400&h=200&fit=crop', time: '5 hours ago' },
      { title: 'Housing Market Shows Signs of Recovery', category: 'Real Estate', image: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=400&h=200&fit=crop', time: '6 hours ago' },
    ],
  },
  IN: {
    region: 'India',
    currency: 'INR',
    tabs: [
      { id: 'indices', label: 'Indices' },
      { id: 'stocks', label: 'Stocks' },
      { id: 'mutualfunds', label: 'Mutual Funds' },
    ],
    indices: [
      { name: 'SENSEX', ticker: 'BSE', value: '76,190.46', change: '-0.42%', changeVal: '-320.72', positive: false },
      { name: 'NIFTY 50', ticker: 'NSE', value: '23,092.20', change: '-0.38%', changeVal: '-88.55', positive: false },
      { name: 'BANK NIFTY', ticker: 'BANKNIFTY', value: '48,345.10', change: '+0.52%', changeVal: '+249.80', positive: true },
      { name: 'NIFTY IT', ticker: 'NIFTYIT', value: '38,567.85', change: '+0.78%', changeVal: '+298.42', positive: true },
      { name: 'NIFTY MIDCAP', ticker: 'NIFTYMID', value: '52,143.70', change: '-0.15%', changeVal: '-78.22', positive: false },
    ],
    stocks: [
      { name: 'Reliance Industries', ticker: 'RELIANCE', price: '1,263.75', change: '+1.12%', positive: true },
      { name: 'Tata Consultancy', ticker: 'TCS', price: '3,842.50', change: '-0.67%', positive: false },
      { name: 'HDFC Bank', ticker: 'HDFCBANK', price: '1,642.20', change: '+0.78%', positive: true },
      { name: 'Infosys Ltd', ticker: 'INFY', price: '1,578.30', change: '+0.85%', positive: true },
      { name: 'ICICI Bank', ticker: 'ICICIBANK', price: '1,087.45', change: '+0.44%', positive: true },
      { name: 'Bharti Airtel', ticker: 'BHARTIARTL', price: '1,172.60', change: '-0.31%', positive: false },
      { name: 'Wipro Ltd', ticker: 'WIPRO', price: '287.35', change: '+1.53%', positive: true },
      { name: 'State Bank of India', ticker: 'SBIN', price: '762.40', change: '+0.92%', positive: true },
    ],
    mutualfunds: [
      { name: 'SBI Bluechip Fund', ticker: 'SBIBLU', price: '78.45', change: '+0.56%', positive: true },
      { name: 'HDFC Flexi Cap Fund', ticker: 'HDFCFLEX', price: '1,523.80', change: '+0.89%', positive: true },
      { name: 'ICICI Pru Value Discovery', ticker: 'ICICIVAL', price: '412.35', change: '-0.23%', positive: false },
      { name: 'Axis Small Cap Fund', ticker: 'AXISSM', price: '92.67', change: '+1.45%', positive: true },
    ],
    news: [
      { title: 'RBI Keeps Repo Rate Unchanged at 6.5%', category: 'Economy', image: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=400&h=200&fit=crop', time: '1 hour ago' },
      { title: 'IT Sector Rallies on Strong Q3 Earnings', category: 'Technology', image: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=400&h=200&fit=crop', time: '3 hours ago' },
      { title: 'Auto Sales Hit Record High in January', category: 'Automobile', image: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=200&fit=crop', time: '4 hours ago' },
      { title: 'Rupee Strengthens Against Dollar on FII Inflows', category: 'Currency', image: 'https://images.unsplash.com/photo-1580519542036-c47de6196ba5?w=400&h=200&fit=crop', time: '5 hours ago' },
    ],
  },
  GB: {
    region: 'United Kingdom',
    currency: 'GBP',
    tabs: [
      { id: 'indices', label: 'Indices' },
      { id: 'stocks', label: 'Stocks' },
    ],
    indices: [
      { name: 'FTSE 100', ticker: 'UKX', value: '8,532.28', change: '+0.34%', changeVal: '+28.85', positive: true },
      { name: 'FTSE 250', ticker: 'MCX', value: '20,845.12', change: '-0.18%', changeVal: '-37.52', positive: false },
      { name: 'FTSE All-Share', ticker: 'ASX', value: '4,652.40', change: '+0.22%', changeVal: '+10.23', positive: true },
    ],
    stocks: [
      { name: 'AstraZeneca', ticker: 'AZN', price: '10,942.00', change: '+1.21%', positive: true },
      { name: 'Shell PLC', ticker: 'SHEL', price: '2,678.50', change: '-0.56%', positive: false },
      { name: 'HSBC Holdings', ticker: 'HSBA', price: '718.40', change: '+0.72%', positive: true },
      { name: 'Unilever PLC', ticker: 'ULVR', price: '4,285.00', change: '+0.45%', positive: true },
      { name: 'BP PLC', ticker: 'BP', price: '485.35', change: '-0.38%', positive: false },
      { name: 'GlaxoSmithKline', ticker: 'GSK', price: '1,542.80', change: '+0.67%', positive: true },
    ],
    news: [
      { title: 'Bank of England Holds Interest Rates Steady', category: 'Economy', image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400&h=200&fit=crop', time: '2 hours ago' },
      { title: 'UK Housing Prices Rise for Third Consecutive Month', category: 'Real Estate', image: 'https://images.unsplash.com/photo-1558036117-15d82a90b9b1?w=400&h=200&fit=crop', time: '4 hours ago' },
      { title: 'London Stock Exchange Sees Record IPO Activity', category: 'Markets', image: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=400&h=200&fit=crop', time: '6 hours ago' },
    ],
  },
};

const DEFAULT_COUNTRY = 'US';

/** Detect the visitor's country via the same two third-party IP services the
 *  original page used, with a 5s timeout each and a US fallback. */
async function getCountry(): Promise<string> {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const g = (await res.json()) as { country_code?: string };
      return g.country_code || 'US';
    }
  } catch {
    /* ignore and try fallback */
  }
  try {
    const res = await fetch('https://ip-api.com/json/?fields=countryCode', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const g = (await res.json()) as { countryCode?: string };
      return g.countryCode || 'US';
    }
  } catch {
    /* ignore */
  }
  return 'US';
}

/** Reproduces the original generateMiniChart(): a random sparkline polyline
 *  biased upward for positive movers and downward for negative ones. */
function MiniChart({ positive }: { positive: boolean }) {
  const points = useMemo(() => {
    const pts: string[] = [];
    let y = 12;
    for (let x = 0; x <= 50; x += 5) {
      y += (Math.random() - (positive ? 0.35 : 0.65)) * 4;
      y = Math.max(2, Math.min(22, y));
      pts.push(`${x},${y}`);
    }
    return pts.join(' ');
  }, [positive]);
  const color = positive ? '#0a8043' : '#d93025';
  return (
    <svg width="50" height="24" viewBox="0 0 50 24">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function currencySymbol(currency: string): string {
  if (currency === 'USD') return '$';
  if (currency === 'GBP') return '£';
  return '₹';
}

export default function FinancePage() {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [tab, setTab] = useState('indices');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let detected = await getCountry();
      if (!financeDataSets[detected]) detected = DEFAULT_COUNTRY;
      if (cancelled) return;
      setCountry(detected);
      setTab(financeDataSets[detected].tabs[0].id);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const data = financeDataSets[country] ?? financeDataSets[DEFAULT_COUNTRY];

  // Stock table contents driven by the current tab (mirrors renderPage()).
  let securities: SecurityEntry[];
  let tableTitle: string;
  if (tab === 'crypto') {
    securities = data.crypto ?? [];
    tableTitle = 'Cryptocurrencies';
  } else if (tab === 'mutualfunds') {
    securities = data.mutualfunds ?? [];
    tableTitle = 'Mutual Funds';
  } else if (tab === 'stocks') {
    securities = data.stocks;
    tableTitle = 'Popular Stocks';
  } else {
    securities = data.stocks;
    tableTitle = 'Top Stocks';
  }

  // Market status is time-of-day based (9am–4pm = Open), computed client-side.
  const [marketStatus, setMarketStatus] = useState<'Open' | 'Closed' | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    setMarketStatus(h >= 9 && h < 16 ? 'Open' : 'Closed');
  }, []);

  if (loading) {
    return (
      <main className={styles.financePage}>
        <div className={styles.loading}>
          <div className={styles.loadingSpinner} />
          <div className={styles.loadingText}>Loading market data...</div>
        </div>
      </main>
    );
  }

  const sym = currencySymbol(data.currency);

  return (
    <main className={styles.financePage}>
      {/* Market tabs */}
      <div className={styles.marketTabs}>
        {data.tabs.map((t) => (
          <button
            key={t.id}
            className={`${styles.marketTab} ${t.id === tab ? styles.active : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Market overview / indices */}
      <div className={styles.sectionTitle}>
        <span className={styles.sectionTitleIcon}>📈</span> Market Overview
      </div>
      <div className={styles.indicesBanner}>
        {data.indices.map((idx) => (
          <div key={idx.ticker} className={styles.indexCard}>
            <div className={styles.indexCardName}>
              {idx.name} ({idx.ticker})
            </div>
            <div className={styles.indexCardValue}>{idx.value}</div>
            <div
              className={`${styles.indexCardChange} ${idx.positive ? styles.positive : styles.negative}`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                {idx.positive ? <path d="M7 14l5-5 5 5z" /> : <path d="M7 10l5 5 5-5z" />}
              </svg>
              {idx.change} ({idx.changeVal})
            </div>
          </div>
        ))}
      </div>

      {/* Quick stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div
            className={styles.statCardValue}
            style={{
              color:
                marketStatus === 'Open'
                  ? 'var(--finance-green)'
                  : marketStatus === 'Closed'
                    ? 'var(--finance-red)'
                    : undefined,
            }}
          >
            {marketStatus ?? '—'}
          </div>
          <div className={styles.statCardLabel}>Market Status</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statCardValue}>{data.indices.length}</div>
          <div className={styles.statCardLabel}>Indices Tracked</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statCardValue}>{securities.length}</div>
          <div className={styles.statCardLabel}>Securities</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statCardValue}>{data.region}</div>
          <div className={styles.statCardLabel}>Region</div>
        </div>
      </div>

      {/* Stock table */}
      <div className={styles.sectionTitle}>
        <span className={styles.sectionTitleIcon}>📋</span> {tableTitle}
      </div>
      <div className={styles.stockTable}>
        <div className={styles.stockTableHeader}>
          <span>Name</span>
          <span>Price</span>
          <span>Chart</span>
          <span>Change</span>
        </div>
        {securities.map((s) => (
          <div key={s.ticker} className={styles.stockRow}>
            <div className={styles.stockInfo}>
              <span className={styles.stockName}>{s.name}</span>
              <span className={styles.stockTicker}>{s.ticker}</span>
            </div>
            <div className={styles.stockPrice}>
              {sym}
              {s.price}
            </div>
            <div className={styles.stockChart}>
              <MiniChart positive={s.positive} />
            </div>
            <div className={`${styles.stockChange} ${s.positive ? styles.positive : styles.negative}`}>
              {s.change}
            </div>
          </div>
        ))}
      </div>

      {/* Financial news (static demo cards, non-navigating like the original) */}
      <div className={styles.sectionTitle}>
        <span className={styles.sectionTitleIcon}>📰</span> Financial News
      </div>
      <div className={styles.newsGrid}>
        {data.news.map((n) => (
          <div key={n.title} className={styles.newsCard}>
            <img className={styles.newsCardImage} src={n.image} alt={n.title} loading="lazy" />
            <div className={styles.newsCardBody}>
              <div className={styles.newsCardCategory}>{n.category}</div>
              <div className={styles.newsCardTitle}>{n.title}</div>
              <div className={styles.newsCardMeta}>{n.time}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
