'use client';

/**
 * Sports dashboard. Faithful conversion of the original static
 * public/sports.html. Geo-detects the visitor's country to choose a region
 * dataset (US / IN / GB), renders league tabs, recent results, upcoming
 * matches, a standings table and quick links, and tries to enrich the active
 * region with a real-time "Live" tab from GET /api/sports.
 *
 * The (site) layout supplies the header/nav/footer, so the original page's own
 * header is intentionally not rendered here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import styles from './sports.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Team {
  name: string;
  short?: string;
  flag: string;
  score?: string;
  sub?: string;
}

interface ResultMatch {
  type: 'result';
  team1: Team;
  team2: Team;
  status: string;
  result?: string;
  league?: string;
}

interface UpcomingMatch {
  type: 'upcoming';
  team1: Team;
  team2: Team;
  date: string;
  time: string;
  venue: string;
  league?: string;
}

type Match = ResultMatch | UpcomingMatch;

interface StandingRow {
  pos: number;
  name: string;
  flag: string;
  w: number;
  l: number;
  pct?: string;
  pts?: string;
}

interface League {
  name: string;
  icon: string;
  matches: Match[];
  standings: StandingRow[];
  standingsColumns: string[];
}

interface Tab {
  id: string;
  label: string;
  icon: string;
}

interface RegionData {
  league: string;
  icon: string;
  tabs: Tab[];
  leagues: Record<string, League>;
}

/** Shape of GET /api/sports. */
interface LiveRegion {
  league: string;
  icon?: string;
  matches?: Match[];
  lastUpdated?: string;
}

interface SportsApiResponse {
  success?: boolean;
  data?: Record<string, LiveRegion>;
}

// ---------------------------------------------------------------------------
// Static datasets (ported verbatim from the original page)
// ---------------------------------------------------------------------------

function buildDataSets(): Record<string, RegionData> {
  const sportsDataSets: Record<string, RegionData> = {
    US: {
      league: 'NFL',
      icon: '🏈',
      tabs: [
        { id: 'nfl', label: 'NFL', icon: '🏈' },
        { id: 'nba', label: 'NBA', icon: '🏀' },
        { id: 'mlb', label: 'MLB', icon: '⚾' },
      ],
      leagues: {
        nfl: {
          name: 'National Football League',
          icon: '🏈',
          matches: [
            { type: 'result', team1: { name: 'Kansas City Chiefs', short: 'KC', flag: '🟡', score: '27' }, team2: { name: 'Buffalo Bills', short: 'BUF', flag: '🔵', score: '24' }, status: 'Final', result: 'KC won by 3 pts', league: 'NFL Week 18' },
            { type: 'result', team1: { name: 'Philadelphia Eagles', short: 'PHI', flag: '🟢', score: '31' }, team2: { name: 'Dallas Cowboys', short: 'DAL', flag: '⭐', score: '17' }, status: 'Final', result: 'PHI won by 14 pts', league: 'NFL Week 18' },
            { type: 'result', team1: { name: 'Baltimore Ravens', short: 'BAL', flag: '🟣', score: '35' }, team2: { name: 'Cincinnati Bengals', short: 'CIN', flag: '🟠', score: '28' }, status: 'Final', result: 'BAL won by 7 pts', league: 'NFL Week 18' },
            { type: 'result', team1: { name: 'Miami Dolphins', short: 'MIA', flag: '🐬', score: '20' }, team2: { name: 'New York Jets', short: 'NYJ', flag: '🟢', score: '17' }, status: 'Final', result: 'MIA won by 3 pts', league: 'NFL Week 17' },
            { type: 'upcoming', team1: { name: 'San Francisco 49ers', short: 'SF', flag: '🔴' }, team2: { name: 'Detroit Lions', short: 'DET', flag: '🦁' }, date: 'Feb 2', time: '6:30 PM', venue: "Levi's Stadium, Santa Clara", league: 'NFC Championship' },
            { type: 'upcoming', team1: { name: 'Green Bay Packers', short: 'GB', flag: '💚' }, team2: { name: 'Chicago Bears', short: 'CHI', flag: '🐻' }, date: 'Feb 3', time: '1:00 PM', venue: 'Lambeau Field, Green Bay', league: 'NFL Playoffs' },
          ],
          standings: [
            { pos: 1, name: 'Kansas City Chiefs', flag: '🟡', w: 14, l: 3, pct: '.824' },
            { pos: 2, name: 'Buffalo Bills', flag: '🔵', w: 13, l: 4, pct: '.765' },
            { pos: 3, name: 'Baltimore Ravens', flag: '🟣', w: 13, l: 4, pct: '.765' },
            { pos: 4, name: 'Philadelphia Eagles', flag: '🟢', w: 12, l: 5, pct: '.706' },
            { pos: 5, name: 'San Francisco 49ers', flag: '🔴', w: 12, l: 5, pct: '.706' },
            { pos: 6, name: 'Detroit Lions', flag: '🦁', w: 11, l: 6, pct: '.647' },
            { pos: 7, name: 'Miami Dolphins', flag: '🐬', w: 10, l: 7, pct: '.588' },
            { pos: 8, name: 'Dallas Cowboys', flag: '⭐', w: 9, l: 8, pct: '.529' },
          ],
          standingsColumns: ['Team', 'W', 'L', 'PCT'],
        },
        nba: {
          name: 'National Basketball Association',
          icon: '🏀',
          matches: [
            { type: 'result', team1: { name: 'Boston Celtics', short: 'BOS', flag: '☘️', score: '118' }, team2: { name: 'LA Lakers', short: 'LAL', flag: '💛', score: '105' }, status: 'Final', result: 'BOS won', league: 'NBA Regular Season' },
            { type: 'result', team1: { name: 'Denver Nuggets', short: 'DEN', flag: '💙', score: '122' }, team2: { name: 'Golden State Warriors', short: 'GSW', flag: '🔵', score: '119' }, status: 'Final', result: 'DEN won by 3 pts', league: 'NBA Regular Season' },
            { type: 'upcoming', team1: { name: 'Milwaukee Bucks', short: 'MIL', flag: '🦌' }, team2: { name: 'Phoenix Suns', short: 'PHX', flag: '🟠' }, date: 'Feb 4', time: '8:00 PM', venue: 'Fiserv Forum, Milwaukee', league: 'NBA Regular Season' },
          ],
          standings: [
            { pos: 1, name: 'Boston Celtics', flag: '☘️', w: 38, l: 12, pct: '.760' },
            { pos: 2, name: 'OKC Thunder', flag: '🔵', w: 36, l: 13, pct: '.735' },
            { pos: 3, name: 'Denver Nuggets', flag: '💙', w: 33, l: 16, pct: '.673' },
            { pos: 4, name: 'Milwaukee Bucks', flag: '🦌', w: 30, l: 18, pct: '.625' },
          ],
          standingsColumns: ['Team', 'W', 'L', 'PCT'],
        },
        mlb: {
          name: 'Major League Baseball',
          icon: '⚾',
          matches: [
            { type: 'upcoming', team1: { name: 'LA Dodgers', short: 'LAD', flag: '🔵' }, team2: { name: 'NY Yankees', short: 'NYY', flag: '⚾' }, date: 'Mar 27', time: '7:00 PM', venue: 'Dodger Stadium, Los Angeles', league: 'Opening Day' },
            { type: 'upcoming', team1: { name: 'Houston Astros', short: 'HOU', flag: '🟠' }, team2: { name: 'Texas Rangers', short: 'TEX', flag: '🔵' }, date: 'Mar 27', time: '8:00 PM', venue: 'Minute Maid Park, Houston', league: 'Opening Day' },
          ],
          standings: [],
          standingsColumns: ['Team', 'W', 'L', 'PCT'],
        },
      },
    },
    IN: {
      league: 'ICC',
      icon: '🏏',
      tabs: [
        { id: 'icc', label: 'ICC', icon: '🏏' },
        { id: 'ipl', label: 'IPL', icon: '🏏' },
        { id: 'football', label: 'ISL', icon: '⚽' },
      ],
      leagues: {
        icc: {
          name: 'International Cricket Council',
          icon: '🏏',
          matches: [
            { type: 'result', team1: { name: 'Sri Lanka', short: 'SL', flag: '🇱🇰', score: '189/5', sub: '(20.0)' }, team2: { name: 'England', short: 'ENG', flag: '🏴', score: '173/4', sub: '(16.4)' }, status: 'Completed', result: 'ENG won by 6 wickets (D/L)', league: 'T20I Series' },
            { type: 'result', team1: { name: 'Pakistan', short: 'PAK', flag: '🇵🇰', score: '207/6', sub: '(20.0)' }, team2: { name: 'Australia', short: 'AUS', flag: '🇦🇺', score: '96', sub: '(16.5)' }, status: 'Completed', result: 'PAK won by 111 runs', league: 'T20I Series' },
            { type: 'result', team1: { name: 'India', short: 'IND', flag: '🇮🇳', score: '297/6', sub: '(50.0)' }, team2: { name: 'New Zealand', short: 'NZ', flag: '🇳🇿', score: '245', sub: '(47.3)' }, status: 'Completed', result: 'IND won by 52 runs', league: 'ODI Series' },
            { type: 'result', team1: { name: 'South Africa', short: 'SA', flag: '🇿🇦', score: '312/4', sub: '(50.0)' }, team2: { name: 'Bangladesh', short: 'BAN', flag: '🇧🇩', score: '198', sub: '(43.2)' }, status: 'Completed', result: 'SA won by 114 runs', league: 'ODI Series' },
            { type: 'upcoming', team1: { name: 'Afghanistan', short: 'AFG', flag: '🇦🇫' }, team2: { name: 'Scotland', short: 'SCO', flag: '🏴' }, date: 'Feb 2', time: '3:00 PM', venue: 'BCCI Centre, Bengaluru', league: 'T20I' },
            { type: 'upcoming', team1: { name: 'India', short: 'IND', flag: '🇮🇳' }, team2: { name: 'England', short: 'ENG', flag: '🏴' }, date: 'Feb 5', time: '2:00 PM', venue: 'MA Chidambaram Stadium, Chennai', league: 'ODI Series' },
          ],
          standings: [
            { pos: 1, name: 'India', flag: '🇮🇳', w: 12, l: 1, pts: '132' },
            { pos: 2, name: 'Australia', flag: '🇦🇺', w: 10, l: 3, pts: '118' },
            { pos: 3, name: 'England', flag: '🏴', w: 9, l: 4, pts: '106' },
            { pos: 4, name: 'South Africa', flag: '🇿🇦', w: 8, l: 4, pts: '100' },
            { pos: 5, name: 'New Zealand', flag: '🇳🇿', w: 7, l: 5, pts: '90' },
            { pos: 6, name: 'Pakistan', flag: '🇵🇰', w: 6, l: 6, pts: '78' },
          ],
          standingsColumns: ['Team', 'W', 'L', 'PTS'],
        },
        ipl: {
          name: 'Indian Premier League',
          icon: '🏏',
          matches: [
            { type: 'result', team1: { name: 'Mumbai Indians', short: 'MI', flag: '🔵', score: '186/4', sub: '(20.0)' }, team2: { name: 'Chennai Super Kings', short: 'CSK', flag: '🟡', score: '178/7', sub: '(20.0)' }, status: 'Completed', result: 'MI won by 8 runs', league: 'IPL 2025' },
            { type: 'result', team1: { name: 'Royal Challengers', short: 'RCB', flag: '🔴', score: '205/3', sub: '(20.0)' }, team2: { name: 'Kolkata Knight Riders', short: 'KKR', flag: '🟣', score: '199/8', sub: '(20.0)' }, status: 'Completed', result: 'RCB won by 6 runs', league: 'IPL 2025' },
            { type: 'upcoming', team1: { name: 'Delhi Capitals', short: 'DC', flag: '🔵' }, team2: { name: 'Gujarat Titans', short: 'GT', flag: '🔷' }, date: 'Feb 3', time: '7:30 PM', venue: 'Arun Jaitley Stadium, Delhi', league: 'IPL 2025' },
          ],
          standings: [
            { pos: 1, name: 'Mumbai Indians', flag: '🔵', w: 5, l: 2, pts: '10' },
            { pos: 2, name: 'Royal Challengers', flag: '🔴', w: 4, l: 2, pts: '8' },
            { pos: 3, name: 'Chennai Super Kings', flag: '🟡', w: 4, l: 3, pts: '8' },
            { pos: 4, name: 'Kolkata Knight Riders', flag: '🟣', w: 3, l: 3, pts: '6' },
          ],
          standingsColumns: ['Team', 'W', 'L', 'PTS'],
        },
        football: {
          name: 'Indian Super League',
          icon: '⚽',
          matches: [
            { type: 'result', team1: { name: 'Mohun Bagan SG', short: 'MBSG', flag: '🟢', score: '2' }, team2: { name: 'Mumbai City FC', short: 'MCFC', flag: '🔵', score: '1' }, status: 'Final', result: 'MBSG won', league: 'ISL 2024-25' },
            { type: 'upcoming', team1: { name: 'Kerala Blasters', short: 'KBFC', flag: '🟡' }, team2: { name: 'Bengaluru FC', short: 'BFC', flag: '🔵' }, date: 'Feb 4', time: '7:30 PM', venue: 'Jawaharlal Nehru Stadium, Kochi', league: 'ISL 2024-25' },
          ],
          standings: [
            { pos: 1, name: 'Mohun Bagan SG', flag: '🟢', w: 10, l: 2, pts: '34' },
            { pos: 2, name: 'Mumbai City FC', flag: '🔵', w: 9, l: 3, pts: '30' },
            { pos: 3, name: 'FC Goa', flag: '🟠', w: 8, l: 4, pts: '28' },
          ],
          standingsColumns: ['Team', 'W', 'L', 'PTS'],
        },
      },
    },
    GB: {
      league: 'Premier League',
      icon: '⚽',
      tabs: [
        { id: 'epl', label: 'Premier League', icon: '⚽' },
        { id: 'ucl', label: 'Champions League', icon: '🏆' },
      ],
      leagues: {
        epl: {
          name: 'English Premier League',
          icon: '⚽',
          matches: [
            { type: 'result', team1: { name: 'Arsenal', short: 'ARS', flag: '🔴', score: '3' }, team2: { name: 'Chelsea', short: 'CHE', flag: '🔵', score: '1' }, status: 'Final', result: 'Arsenal won', league: 'Matchweek 24' },
            { type: 'result', team1: { name: 'Liverpool', short: 'LIV', flag: '🔴', score: '2' }, team2: { name: 'Man City', short: 'MCI', flag: '🔵', score: '2' }, status: 'Final', result: 'Draw', league: 'Matchweek 24' },
            { type: 'upcoming', team1: { name: 'Man United', short: 'MUN', flag: '🔴' }, team2: { name: 'Tottenham', short: 'TOT', flag: '⚪' }, date: 'Feb 2', time: '4:30 PM', venue: 'Old Trafford, Manchester', league: 'Matchweek 25' },
          ],
          standings: [
            { pos: 1, name: 'Liverpool', flag: '🔴', w: 17, l: 2, pts: '53' },
            { pos: 2, name: 'Arsenal', flag: '🔴', w: 14, l: 3, pts: '47' },
            { pos: 3, name: 'Man City', flag: '🔵', w: 13, l: 5, pts: '43' },
            { pos: 4, name: 'Aston Villa', flag: '🟣', w: 12, l: 5, pts: '40' },
          ],
          standingsColumns: ['Team', 'W', 'L', 'PTS'],
        },
        ucl: {
          name: 'UEFA Champions League',
          icon: '🏆',
          matches: [
            { type: 'upcoming', team1: { name: 'Real Madrid', short: 'RMA', flag: '⚪' }, team2: { name: 'Bayern Munich', short: 'BAY', flag: '🔴' }, date: 'Feb 11', time: '9:00 PM', venue: 'Santiago Bernabeu, Madrid', league: 'Round of 16' },
            { type: 'upcoming', team1: { name: 'PSG', short: 'PSG', flag: '🔵' }, team2: { name: 'Barcelona', short: 'BAR', flag: '🔵' }, date: 'Feb 12', time: '9:00 PM', venue: 'Parc des Princes, Paris', league: 'Round of 16' },
          ],
          standings: [],
          standingsColumns: ['Team', 'W', 'L', 'PTS'],
        },
      },
    },
  };
  return sportsDataSets;
}

// ---------------------------------------------------------------------------
// Geo detection (mirrors getCountry() from the original)
// ---------------------------------------------------------------------------

async function getCountry(): Promise<string> {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const g = (await res.json()) as { country_code?: string };
      return g.country_code || 'US';
    }
  } catch {
    /* fall through to next provider */
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
    /* fall through to default */
  }
  return 'US';
}

// ---------------------------------------------------------------------------
// Presentational components
// ---------------------------------------------------------------------------

function MatchCard({ match }: { match: Match }) {
  const isUpcoming = match.type === 'upcoming';
  const statusClass =
    !isUpcoming && (match.status === 'Final' || match.status === 'Completed')
      ? styles.completed
      : isUpcoming
        ? styles.upcoming
        : styles.live;
  const statusText = isUpcoming ? 'Upcoming' : match.status;

  return (
    <div className={styles.matchCard}>
      <div className={styles.matchCardHeader}>
        <span className={styles.matchCardLeague}>{match.league || ''}</span>
        <span className={`${styles.matchCardStatus} ${statusClass}`}>{statusText}</span>
      </div>

      {isUpcoming ? (
        <div className={styles.matchCardBody}>
          <div className={styles.matchTeam}>
            <span className={styles.matchTeamFlag}>{match.team1.flag}</span>
            <div className={styles.matchTeamInfo}>
              <span className={styles.matchTeamName}>{match.team1.name}</span>
            </div>
          </div>
          <div className={styles.matchUpcomingCenter}>
            <div className={styles.matchUpcomingDate}>{match.date}</div>
            <div className={styles.matchUpcomingTime}>{match.time}</div>
            <div className={styles.matchUpcomingVenue}>{match.venue}</div>
          </div>
          <div className={`${styles.matchTeam} ${styles.right}`}>
            <span className={styles.matchTeamFlag}>{match.team2.flag}</span>
            <div className={styles.matchTeamInfo}>
              <span className={styles.matchTeamName}>{match.team2.name}</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.matchCardBody}>
            <div className={styles.matchTeam}>
              <span className={styles.matchTeamFlag}>{match.team1.flag}</span>
              <div className={styles.matchTeamInfo}>
                <span className={styles.matchTeamName}>{match.team1.name}</span>
                {match.team1.sub ? (
                  <span className={styles.matchTeamSub}>{match.team1.sub}</span>
                ) : null}
              </div>
            </div>
            <div className={styles.matchScoreArea}>
              <div className={styles.matchScores}>
                <span className={styles.matchScore}>{match.team1.score}</span>
                <span className={styles.matchVs}>vs</span>
                <span className={styles.matchScore}>{match.team2.score}</span>
              </div>
            </div>
            <div className={`${styles.matchTeam} ${styles.right}`}>
              <span className={styles.matchTeamFlag}>{match.team2.flag}</span>
              <div className={styles.matchTeamInfo}>
                <span className={styles.matchTeamName}>{match.team2.name}</span>
                {match.team2.sub ? (
                  <span className={styles.matchTeamSub}>{match.team2.sub}</span>
                ) : null}
              </div>
            </div>
          </div>
          {match.result ? <div className={styles.matchResult}>{match.result}</div> : null}
        </>
      )}
    </div>
  );
}

function StandingsTable({ league }: { league: League }) {
  if (!league.standings.length) return null;
  return (
    <div className={styles.standingsCard}>
      <div className={styles.standingsTitle}>Standings</div>
      <table className={styles.standingsTable}>
        <thead>
          <tr>
            {league.standingsColumns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {league.standings.map((row) => {
            const values = [row.w, row.l, row.pts ?? row.pct ?? ''];
            return (
              <tr key={row.pos}>
                <td>
                  <div className={styles.standingsTeam}>
                    <span className={styles.standingsPos}>{row.pos}</span>
                    <span className={styles.standingsFlag}>{row.flag}</span>
                    <span className={styles.standingsName}>{row.name}</span>
                  </div>
                </td>
                {values.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SportsPage() {
  const [loading, setLoading] = useState(true);
  // Region datasets live in a ref so the (possibly mutated) "Live" tab survives
  // re-renders without re-running init.
  const dataSetsRef = useRef<Record<string, RegionData>>(buildDataSets());
  const [country, setCountry] = useState('US');
  const [leagueId, setLeagueId] = useState('');
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      const sportsDataSets = dataSetsRef.current;
      let resolvedCountry = await getCountry();
      if (!sportsDataSets[resolvedCountry]) resolvedCountry = 'US';

      // Try to fetch live data and inject it as the first tab for the region.
      try {
        const liveData = await api.get<SportsApiResponse>('/api/sports', { auth: false });
        if (liveData.success && liveData.data) {
          const regionData = liveData.data[resolvedCountry] || liveData.data.DEFAULT;
          if (regionData && regionData.matches && regionData.matches.length > 0) {
            const region = sportsDataSets[resolvedCountry];
            if (!region.leagues.live) {
              const liveLeague: League = {
                name: regionData.league + ' (Live)',
                icon: regionData.icon || '⚽',
                matches: regionData.matches,
                standings: [],
                standingsColumns: ['Team', 'W', 'L', 'PTS'],
              };
              region.tabs.unshift({ id: 'live', label: 'Live ⚽', icon: '🔴' });
              region.leagues.live = liveLeague;
            }
            // eslint-disable-next-line no-console
            console.log('[Sports Page] Loaded live data, last updated:', regionData.lastUpdated);
          }
        }
      } catch {
        // eslint-disable-next-line no-console
        console.log('[Sports Page] Live data unavailable, using static data');
      }

      const data = sportsDataSets[resolvedCountry];
      setCountry(resolvedCountry);
      setLeagueId(data.tabs[0].id);
      setLoading(false);
    })();
  }, []);

  const switchLeague = useCallback((id: string) => {
    setLeagueId(id);
  }, []);

  if (loading) {
    return (
      <div className={styles.sportsPage}>
        <div className={styles.sportsLoading}>
          <div className={styles.sportsLoadingSpinner} />
          <div className={styles.sportsLoadingText}>Loading sports data...</div>
        </div>
      </div>
    );
  }

  const data = dataSetsRef.current[country] || dataSetsRef.current.US;
  const activeLeagueId = leagueId || data.tabs[0].id;
  const league = data.leagues[activeLeagueId];

  const results = league.matches.filter((m): m is ResultMatch => m.type === 'result');
  const upcoming = league.matches.filter((m): m is UpcomingMatch => m.type === 'upcoming');

  return (
    <div className={styles.sportsPage}>
      {/* League tabs */}
      <div className={styles.leagueTabs}>
        {data.tabs.map((t) => (
          <button
            key={t.id}
            className={`${styles.leagueTab} ${t.id === activeLeagueId ? styles.active : ''}`}
            onClick={() => switchLeague(t.id)}
          >
            <span className={styles.leagueTabIcon}>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Recent results */}
      {results.length > 0 ? (
        <>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionTitleIcon}>{league.icon}</span>
            Recent Results
            <span className={styles.sectionTitleBadge}>{results.length}</span>
          </div>
          <div className={styles.matchesGrid}>
            {results.map((m, i) => (
              <MatchCard key={i} match={m} />
            ))}
          </div>
        </>
      ) : null}

      {/* Upcoming matches */}
      {upcoming.length > 0 ? (
        <>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionTitleIcon}>📅</span>
            Upcoming Matches
            <span className={styles.sectionTitleBadge}>{upcoming.length}</span>
          </div>
          <div className={styles.matchesGrid}>
            {upcoming.map((m, i) => (
              <MatchCard key={i} match={m} />
            ))}
          </div>
        </>
      ) : null}

      {/* Standings */}
      <StandingsTable league={league} />

      {/* Quick links */}
      <div className={styles.sectionTitle}>
        <span className={styles.sectionTitleIcon}>🔗</span> Quick Links
      </div>
      <div className={styles.quickLinks}>
        {data.tabs.map((t) => (
          <a
            key={t.id}
            href="#"
            className={styles.quickLink}
            onClick={(e) => {
              e.preventDefault();
              switchLeague(t.id);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <span className={styles.quickLinkIcon}>{t.icon}</span>
            <div>
              <div className={styles.quickLinkText}>{t.label}</div>
              <div className={styles.quickLinkSub}>
                {(data.leagues[t.id].matches || []).length} matches
              </div>
            </div>
          </a>
        ))}
        <Link href="/" className={styles.quickLink}>
          <span className={styles.quickLinkIcon}>🏠</span>
          <div>
            <div className={styles.quickLinkText}>Back to Home</div>
            <div className={styles.quickLinkSub}>JubileeVerse.com</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
