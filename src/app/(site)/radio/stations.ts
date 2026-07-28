/**
 * Radio station directory — ported verbatim from the original static radio.html.
 * Names, stream URLs, logos (Unsplash demo images), categories, descriptions,
 * "now playing" shows and schedules are preserved EXACTLY.
 *
 * Station IDs follow the original convention: `station-<index>` where the index
 * is the position in this array (used by the favorites/follows API).
 */

export type StationCategory = 'live' | 'podcast' | 'music' | 'religious';

export interface ScheduleItem {
  time: string;
  show: string;
  host: string;
  desc: string;
}

export interface CurrentShow {
  name: string;
  host: string;
  time: string;
}

export interface Station {
  name: string;
  category: StationCategory;
  image: string;
  description: string;
  listeners: string;
  streamUrl: string;
  currentShow: CurrentShow;
  schedule: ScheduleItem[];
}

/** Station id used by the favorites/follows API (`station-0`, `station-1`, ...). */
export function getStationId(stationIdx: number): string {
  return `station-${stationIdx}`;
}

export const stations: Station[] = [
  // Live Radio (real streams)
  {
    name: 'K-LOVE',
    category: 'live',
    image: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=400&h=400&fit=crop',
    description:
      "America's largest Christian radio network — positive & encouraging contemporary Christian music. Non-profit, listener-supported, broadcasting on 520+ FM stations across 48 states.",
    listeners: '20M weekly listeners',
    streamUrl: 'https://maestro.emfcdn.com/stream_for/k-love/radiodns/aac',
    currentShow: { name: 'K-LOVE Live', host: 'K-LOVE Team', time: '24/7 Live' },
    schedule: [
      { time: '6:00 AM', show: 'Morning Show', host: 'Carlos Aguiar & Amy Baumann', desc: 'Start your day with faith and encouragement' },
      { time: '11:00 AM', show: 'Middays with Scott', host: 'Scott Smith', desc: 'The best in contemporary Christian hits' },
      { time: '2:00 PM', show: 'Afternoons with Lauree', host: 'Lauree Austin', desc: 'Uplifting music for your afternoon' },
      { time: '6:00 PM', show: 'Evenings with Christina', host: 'Christina James', desc: 'Evening Christian music and encouragement' },
      { time: '10:00 PM', show: 'Late Nights with Careth', host: 'Careth Beard', desc: 'Late-night worship and music' },
      { time: '2:00 AM', show: 'Overnight Worship', host: 'Auto DJ', desc: 'Non-stop worship through the night' },
    ],
  },
  {
    name: 'BBN Radio',
    category: 'live',
    image: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=400&h=400&fit=crop',
    description:
      'Bible Broadcasting Network — Bible teaching, hymns, and gospel music reaching every continent. Non-commercial, listener-supported since 1971.',
    listeners: 'Global broadcast',
    streamUrl: 'https://streams.radiomast.io/844b0a81-f4b9-485e-adaa-aab8d3ea9f7f',
    currentShow: { name: 'BBN Live', host: 'BBN Team', time: '24/7 Live' },
    schedule: [
      { time: '6:00 AM', show: 'Morning Hymns', host: 'Auto DJ', desc: 'Classic hymns to start the day' },
      { time: '9:00 AM', show: 'Through the Bible', host: 'Dr. J. Vernon McGee', desc: 'Verse-by-verse Bible teaching' },
      { time: '12:00 PM', show: 'Noonday Prayer', host: 'Community', desc: 'Midday prayer and reflection' },
      { time: '3:00 PM', show: 'Gospel Classics', host: 'BBN Team', desc: 'Timeless gospel favorites' },
      { time: '6:00 PM', show: 'Evening Teaching', host: 'Various', desc: 'Bible teaching programs' },
      { time: '9:00 PM', show: 'Night Hymns', host: 'Auto DJ', desc: 'Peaceful hymns for the evening' },
    ],
  },
  {
    name: 'Moody Radio (WMBI 90.1)',
    category: 'live',
    image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=400&fit=crop',
    description:
      "One of America's largest Christian radio networks from Moody Bible Institute, est. 1926. Bible teaching, music, and live call-in programming. 58 owned stations plus hundreds of affiliates.",
    listeners: '58 stations + affiliates',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/WMBIFM_SC',
    currentShow: { name: 'Moody Radio Live', host: 'Moody Team', time: '24/7 Live' },
    schedule: [
      { time: 'Morning', show: 'Equipped', host: 'Chris Brooks', desc: 'Morning Bible teaching' },
      { time: '10:00 AM', show: 'In the Market', host: 'Janet Parshall', desc: 'Current events and faith' },
      { time: '12:00 PM', show: 'Chris Fabry Live!', host: 'Chris Fabry', desc: 'Live call-in discussions' },
      { time: '2:00 PM', show: 'Open Line', host: 'Dr. Michael Rydelnik', desc: 'Bible Q&A from Jewish studies professor' },
      { time: '4:00 PM', show: 'Grace to You', host: 'John MacArthur', desc: 'Partner program on Moody' },
      { time: '7:00 PM', show: 'Focus on the Family', host: 'Jim Daly', desc: 'Partner program on Moody' },
    ],
  },
  {
    name: 'RefNet.fm (Ligonier)',
    category: 'live',
    image: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=400&h=400&fit=crop',
    description:
      'Reformed Christian internet radio from Ligonier Ministries founded by R.C. Sproul. 24/7 Bible teaching, theology, and Reformed programming.',
    listeners: 'Global streaming',
    streamUrl: 'https://icecast.refnet.fm/utc/-0500',
    currentShow: { name: 'RefNet Live', host: 'Ligonier Team', time: '24/7 Live' },
    schedule: [
      { time: 'Morning', show: 'Renewing Your Mind', host: 'R.C. Sproul', desc: 'Classic Reformed theology teaching' },
      { time: 'Midday', show: 'The Briefing', host: 'Albert Mohler', desc: 'Daily news analysis' },
      { time: 'Afternoon', show: 'Grace to You', host: 'John MacArthur', desc: 'Verse-by-verse Bible teaching' },
      { time: 'Evening', show: 'Ligonier Teaching', host: 'Various Professors', desc: 'In-depth theological education' },
      { time: 'Night', show: 'Westminster Shorter Catechism', host: 'Ligonier Team', desc: 'Catechism readings and teaching' },
      { time: 'Overnight', show: 'Continuous Teaching', host: 'Auto DJ', desc: 'Non-stop Reformed teaching' },
    ],
  },
  {
    name: 'Spirit 105.3 (KCMS Seattle)',
    category: 'live',
    image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=400&fit=crop',
    description:
      "Crista Media's Christian radio station serving the Seattle/Pacific Northwest area. Contemporary Christian music and encouraging talk programming.",
    listeners: 'Seattle market',
    streamUrl: 'https://crista-kcms.streamguys1.com/test1',
    currentShow: { name: 'Spirit 105.3 Live', host: 'KCMS Team', time: '24/7 Live' },
    schedule: [
      { time: '6:00 AM', show: 'Morning Show', host: 'KCMS Team', desc: "Seattle's morning Christian radio" },
      { time: '10:00 AM', show: 'Midday Music', host: 'KCMS Team', desc: 'Contemporary Christian hits' },
      { time: '2:00 PM', show: 'Afternoon Praise', host: 'KCMS Team', desc: 'Afternoon encouragement' },
      { time: '6:00 PM', show: 'Evening Drive', host: 'KCMS Team', desc: 'Drive-time Christian music' },
      { time: '9:00 PM', show: 'Night Worship', host: 'Auto DJ', desc: 'Peaceful evening music' },
      { time: '12:00 AM', show: 'Overnight', host: 'Auto DJ', desc: 'Non-stop Christian music' },
    ],
  },

  // Talk & Teaching (real streams)
  {
    name: 'KHCB 105.7 FM Houston',
    category: 'podcast',
    image: 'https://images.unsplash.com/photo-1491438590914-bc09fcaaf77a?w=400&h=400&fit=crop',
    description:
      'Houston Christian Broadcasters — Bible teaching and Christian talk radio serving the Houston metro area. Non-commercial, listener-supported since 1962.',
    listeners: 'Houston metro',
    streamUrl: 'http://khcb.streamguys1.com/live-128k-mp3',
    currentShow: { name: 'KHCB Live', host: 'KHCB Team', time: '24/7 Live' },
    schedule: [
      { time: '6:00 AM', show: 'Morning Devotion', host: 'KHCB Team', desc: 'Start the day with Scripture' },
      { time: '9:00 AM', show: 'In Touch', host: 'Dr. Charles Stanley', desc: 'Daily Bible teaching' },
      { time: '11:00 AM', show: 'Insight for Living', host: 'Chuck Swindoll', desc: 'Practical Bible teaching' },
      { time: '1:00 PM', show: 'Grace to You', host: 'John MacArthur', desc: 'Verse-by-verse teaching' },
      { time: '4:00 PM', show: 'Focus on the Family', host: 'Jim Daly', desc: 'Family ministry broadcast' },
      { time: '7:00 PM', show: 'Turning Point', host: 'Dr. David Jeremiah', desc: 'Evening Bible teaching' },
    ],
  },
  {
    name: '3ABN Radio',
    category: 'podcast',
    image: 'https://images.unsplash.com/photo-1529070538774-1843cb3265df?w=400&h=400&fit=crop',
    description:
      'Three Angels Broadcasting Network radio — Christian teaching, health programming, and inspirational content reaching viewers and listeners worldwide via satellite and internet.',
    listeners: 'Global satellite',
    streamUrl: 'http://war.str3am.com:7180/MC01',
    currentShow: { name: '3ABN Live', host: '3ABN Team', time: '24/7 Live' },
    schedule: [
      { time: 'Morning', show: 'Morning Worship', host: '3ABN Team', desc: 'Morning devotions and music' },
      { time: 'Midday', show: 'Bible Study Hour', host: 'Various Pastors', desc: 'In-depth Bible study' },
      { time: 'Afternoon', show: 'Health & Lifestyle', host: '3ABN Health Team', desc: 'Christian health programming' },
      { time: 'Evening', show: 'Evening Teaching', host: 'Various', desc: 'Evening Bible teaching' },
      { time: 'Night', show: 'Inspirational Music', host: 'Auto DJ', desc: 'Christian music programming' },
      { time: 'Weekend', show: 'Weekend Special', host: '3ABN Team', desc: 'Special weekend programming' },
    ],
  },
  {
    name: 'Hope 103.2 Sydney',
    category: 'podcast',
    image: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=400&h=400&fit=crop',
    description:
      "Sydney, Australia's Christian radio station. Contemporary Christian music, talk shows, news, and community programming for the greater Sydney area.",
    listeners: 'Sydney metro',
    streamUrl: 'https://23093.live.streamtheworld.com/2CBAAAC.aac',
    currentShow: { name: 'Hope 103.2 Live', host: 'Hope Team', time: '24/7 Live (AEST)' },
    schedule: [
      { time: '6:00 AM', show: 'Breakfast Show', host: 'Hope Team', desc: "Sydney's Christian morning show" },
      { time: '10:00 AM', show: 'Open House', host: 'Hope Team', desc: 'Music and conversation' },
      { time: '2:00 PM', show: 'Afternoons', host: 'Hope Team', desc: 'Afternoon programming' },
      { time: '6:00 PM', show: 'Drive Show', host: 'Hope Team', desc: 'Evening drive-time' },
      { time: '9:00 PM', show: 'Evening Music', host: 'Auto DJ', desc: 'Christian music and reflection' },
      { time: '12:00 AM', show: 'Overnight', host: 'Auto DJ', desc: 'Non-stop Christian music' },
    ],
  },
  {
    name: 'Moody Urban Praise',
    category: 'podcast',
    image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
    description:
      "Moody Radio's internet channel featuring urban gospel, praise & worship, and inspirational music celebrating the diversity of Christian worship styles.",
    listeners: 'Online streaming',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/IM_3.mp3',
    currentShow: { name: 'Urban Praise Live', host: 'Moody Team', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Urban Gospel Mix', host: 'Auto DJ', desc: 'Contemporary urban gospel music' },
      { time: 'Featured', show: 'Praise & Worship Hits', host: 'Auto DJ', desc: 'Top praise and worship songs' },
      { time: 'Featured', show: 'Gospel Classics', host: 'Auto DJ', desc: 'Classic gospel favorites' },
      { time: 'Featured', show: 'Inspirational R&B', host: 'Auto DJ', desc: 'Inspirational R&B and soul' },
      { time: 'Featured', show: 'Sunday Best', host: 'Auto DJ', desc: 'Sunday morning gospel feel' },
      { time: 'Featured', show: 'Worship Experience', host: 'Auto DJ', desc: 'Deep worship music' },
    ],
  },
  {
    name: 'Life 102.5 Wisconsin',
    category: 'podcast',
    image: 'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?w=400&h=400&fit=crop',
    description:
      'WNWC 102.5 FM — Christian radio station serving Madison, Wisconsin and surrounding areas. Contemporary Christian music, teaching, and community programming.',
    listeners: 'Madison, WI market',
    streamUrl: 'http://nwmedia-wnwc-fm.streamguys.com:80/wnwc-fm',
    currentShow: { name: 'Life 102.5 Live', host: 'WNWC Team', time: '24/7 Live' },
    schedule: [
      { time: '6:00 AM', show: 'Morning Show', host: 'WNWC Team', desc: "Wisconsin's Christian morning show" },
      { time: '10:00 AM', show: 'Midday Music', host: 'WNWC Team', desc: 'Contemporary Christian music' },
      { time: '2:00 PM', show: 'Afternoon Praise', host: 'WNWC Team', desc: 'Afternoon encouragement' },
      { time: '6:00 PM', show: 'Evening Drive', host: 'WNWC Team', desc: 'Drive-time programming' },
      { time: '9:00 PM', show: 'Night Music', host: 'Auto DJ', desc: 'Evening Christian music' },
      { time: '12:00 AM', show: 'Overnight', host: 'Auto DJ', desc: 'Non-stop worship' },
    ],
  },

  // Music Radio (real streams)
  {
    name: 'ChristianHits.Net',
    category: 'music',
    image: 'https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=400&h=400&fit=crop',
    description:
      "Free internet radio playing today's best contemporary Christian hits — CCM pop, worship favorites, and new releases 24/7. Part of the ChristianRock.Net radio network.",
    listeners: 'Free streaming',
    streamUrl: 'https://listen.christianrock.net/stream/5/',
    currentShow: { name: 'Contemporary Christian Hits', host: 'Auto DJ', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'CCM Hits Mix', host: 'Auto DJ', desc: "Today's top Christian pop and rock" },
      { time: 'Featured', show: 'New Releases', host: 'Auto DJ', desc: 'Latest CCM releases' },
      { time: 'Featured', show: 'Worship Favorites', host: 'Auto DJ', desc: 'Most-loved worship songs' },
      { time: 'Featured', show: 'Christian Pop', host: 'Auto DJ', desc: 'Upbeat Christian pop music' },
      { time: 'Featured', show: 'Artist Spotlight', host: 'Auto DJ', desc: 'Deep cuts and fan favorites' },
      { time: 'Featured', show: 'Inspirational Mix', host: 'Auto DJ', desc: 'Encouraging and uplifting tracks' },
    ],
  },
  {
    name: 'ChristianRock.Net',
    category: 'music',
    image: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400&h=400&fit=crop',
    description:
      'Free internet radio dedicated to Christian rock music — Skillet, Switchfoot, RED, Thousand Foot Krutch, and more. Streaming 24/7 without commercials.',
    listeners: 'Free streaming',
    streamUrl: 'https://listen.christianrock.net/stream/1/',
    currentShow: { name: 'Christian Rock Radio', host: 'Auto DJ', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Christian Rock Mix', host: 'Auto DJ', desc: 'Non-stop Christian rock music' },
      { time: 'Featured', show: 'Hard Rock Hour', host: 'Auto DJ', desc: 'Heavier Christian rock' },
      { time: 'Featured', show: 'Alternative Christian', host: 'Auto DJ', desc: 'Christian alternative rock' },
      { time: 'Featured', show: 'Rock Classics', host: 'Auto DJ', desc: 'Classic Christian rock favorites' },
      { time: 'Featured', show: 'New Rock Releases', host: 'Auto DJ', desc: 'Latest Christian rock releases' },
      { time: 'Featured', show: 'Underground', host: 'Auto DJ', desc: 'Indie Christian rock bands' },
    ],
  },
  {
    name: 'ChristianPowerPraise.Net',
    category: 'music',
    image: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=400&h=400&fit=crop',
    description:
      'Free internet radio for praise & worship music — Hillsong, Elevation Worship, Bethel Music, Maverick City Music, and more. Commercial-free streaming 24/7.',
    listeners: 'Free streaming',
    streamUrl: 'https://listen.christianrock.net/stream/7/',
    currentShow: { name: 'Power Praise & Worship', host: 'Auto DJ', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Praise & Worship Mix', host: 'Auto DJ', desc: 'Non-stop praise and worship' },
      { time: 'Featured', show: 'Hillsong Collection', host: 'Auto DJ', desc: 'Best of Hillsong Worship' },
      { time: 'Featured', show: 'Elevation Worship', host: 'Auto DJ', desc: 'Elevation Church worship' },
      { time: 'Featured', show: 'Bethel Music', host: 'Auto DJ', desc: 'Bethel Music favorites' },
      { time: 'Featured', show: 'Maverick City Music', host: 'Auto DJ', desc: 'Maverick City collection' },
      { time: 'Featured', show: 'Soaking Worship', host: 'Auto DJ', desc: 'Extended worship for prayer' },
    ],
  },
  {
    name: 'Abiding Radio Sacred',
    category: 'music',
    image: 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=400&h=400&fit=crop',
    description:
      'Streaming sacred worship music 24/7 — peaceful hymns, choral arrangements, and classic worship songs. Perfect for prayer, meditation, and devotion time.',
    listeners: 'Free streaming',
    streamUrl: 'https://streams.abidingradio.com:7820/1',
    currentShow: { name: 'Sacred Worship Music', host: 'Abiding Radio', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Sacred Worship', host: 'Abiding Radio', desc: 'Peaceful sacred worship music' },
      { time: 'Featured', show: 'Hymns of Faith', host: 'Abiding Radio', desc: 'Traditional hymns of the faith' },
      { time: 'Featured', show: 'Choral Worship', host: 'Abiding Radio', desc: 'Beautiful choral arrangements' },
      { time: 'Featured', show: 'Classic Worship', host: 'Abiding Radio', desc: 'Classic worship songs' },
      { time: 'Featured', show: 'Prayer Music', host: 'Abiding Radio', desc: 'Music for prayer time' },
      { time: 'Featured', show: 'Evening Vespers', host: 'Abiding Radio', desc: 'Peaceful evening selections' },
    ],
  },
  {
    name: 'Abiding Radio Instrumental',
    category: 'music',
    image: 'https://images.unsplash.com/photo-1477233534935-f5e6fe7c1159?w=400&h=400&fit=crop',
    description:
      'Commercial-free instrumental hymns and worship music — piano, strings, and orchestra arrangements. Ideal for Bible study, work, prayer, and relaxation.',
    listeners: 'Free streaming',
    streamUrl: 'https://streams.abidingradio.com:7800/1',
    currentShow: { name: 'Instrumental Worship', host: 'Abiding Radio', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Instrumental Hymns', host: 'Abiding Radio', desc: 'Piano and strings worship' },
      { time: 'Featured', show: 'Piano Worship', host: 'Abiding Radio', desc: 'Solo piano hymn arrangements' },
      { time: 'Featured', show: 'Orchestra Hymns', host: 'Abiding Radio', desc: 'Full orchestra arrangements' },
      { time: 'Featured', show: 'Guitar Worship', host: 'Abiding Radio', desc: 'Acoustic guitar hymns' },
      { time: 'Featured', show: 'Strings & Cello', host: 'Abiding Radio', desc: 'String quartet arrangements' },
      { time: 'Featured', show: 'Peaceful Ambiance', host: 'Abiding Radio', desc: 'Ambient instrumental worship' },
    ],
  },

  // Religious/Hymns (real streams)
  {
    name: 'Abiding Radio Bluegrass Hymns',
    category: 'religious',
    image: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=400&h=400&fit=crop',
    description:
      'Bluegrass-style renditions of classic Christian hymns — banjo, fiddle, mandolin, and guitar arrangements of beloved hymns. Commercial-free streaming 24/7.',
    listeners: 'Free streaming',
    streamUrl: 'https://streams.abidingradio.com:7840/1',
    currentShow: { name: 'Bluegrass Hymns', host: 'Abiding Radio', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Bluegrass Hymns', host: 'Abiding Radio', desc: 'Bluegrass-style worship music' },
      { time: 'Featured', show: 'Mountain Gospel', host: 'Abiding Radio', desc: 'Mountain gospel favorites' },
      { time: 'Featured', show: 'Fiddle Hymns', host: 'Abiding Radio', desc: 'Fiddle-led hymn arrangements' },
      { time: 'Featured', show: 'Banjo & Mandolin', host: 'Abiding Radio', desc: 'Banjo and mandolin worship' },
      { time: 'Featured', show: 'Country Hymns', host: 'Abiding Radio', desc: 'Country-style classic hymns' },
      { time: 'Featured', show: 'Porch Swing Praise', host: 'Abiding Radio', desc: 'Relaxed bluegrass worship' },
    ],
  },
  {
    name: 'ChristianClassicRock.Net',
    category: 'religious',
    image: 'https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=400&h=400&fit=crop',
    description:
      'Classic Christian rock from the 80s, 90s and 2000s — Petra, DC Talk, Newsboys, Audio Adrenaline, and more. Free, commercial-free internet radio streaming.',
    listeners: 'Free streaming',
    streamUrl: 'https://listen.christianrock.net/stream/9/',
    currentShow: { name: 'Classic Christian Rock', host: 'Auto DJ', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Classic Christian Rock Mix', host: 'Auto DJ', desc: 'Best of classic Christian rock' },
      { time: 'Featured', show: 'Petra Hour', host: 'Auto DJ', desc: 'Best of Petra' },
      { time: 'Featured', show: 'DC Talk Collection', host: 'Auto DJ', desc: 'DC Talk favorites' },
      { time: 'Featured', show: '90s Christian Rock', host: 'Auto DJ', desc: '90s Christian rock hits' },
      { time: 'Featured', show: '80s Christian Rock', host: 'Auto DJ', desc: '80s Christian rock pioneers' },
      { time: 'Featured', show: 'Early 2000s', host: 'Auto DJ', desc: '2000s Christian rock favorites' },
    ],
  },
  {
    name: 'RadioMv English',
    category: 'religious',
    image: 'https://images.unsplash.com/photo-1509021436665-8f07dbf5bf1d?w=400&h=400&fit=crop',
    description:
      'International Christian music radio broadcasting in multiple languages. English channel featuring worship music from around the world — connecting believers globally through music.',
    listeners: 'Global streaming',
    streamUrl: 'http://stream.radiomv.com/english/stream.mp3',
    currentShow: { name: 'RadioMv English', host: 'RadioMv', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'International Worship', host: 'RadioMv', desc: 'Christian music from around the world' },
      { time: 'Featured', show: 'Global Praise', host: 'RadioMv', desc: 'Praise music from every continent' },
      { time: 'Featured', show: 'Worship Anthems', host: 'RadioMv', desc: 'Major worship anthems' },
      { time: 'Featured', show: 'Contemporary Mix', host: 'RadioMv', desc: 'Modern Christian music' },
      { time: 'Featured', show: 'Acoustic Worship', host: 'RadioMv', desc: 'Acoustic worship selections' },
      { time: 'Featured', show: 'World Music', host: 'RadioMv', desc: 'Christian world music' },
    ],
  },
  {
    name: 'Word of Truth Radio',
    category: 'religious',
    image: 'https://images.unsplash.com/photo-1560758656-1e045c06d757?w=400&h=400&fit=crop',
    description:
      'Instrumental hymns streaming 24/7 — peaceful piano and orchestral renditions of beloved Christian hymns. Perfect for prayer, meditation, Bible study, and quiet devotion.',
    listeners: 'Free streaming',
    streamUrl: 'http://wotrstream.com:8025/hymns',
    currentShow: { name: 'Instrumental Hymns', host: 'Word of Truth', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Instrumental Hymns', host: 'Word of Truth', desc: 'Peaceful piano hymn arrangements' },
      { time: 'Featured', show: 'Amazing Grace Collection', host: 'Word of Truth', desc: 'Arrangements of Amazing Grace' },
      { time: 'Featured', show: 'How Great Thou Art', host: 'Word of Truth', desc: 'Renditions of classic hymns' },
      { time: 'Featured', show: 'Be Thou My Vision', host: 'Word of Truth', desc: 'Celtic and traditional hymns' },
      { time: 'Featured', show: 'It Is Well', host: 'Word of Truth', desc: 'Comforting hymn arrangements' },
      { time: 'Featured', show: 'Blessed Assurance', host: 'Word of Truth', desc: 'Assurance and peace hymns' },
    ],
  },
  {
    name: 'DWG Radio English',
    category: 'religious',
    image: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&h=400&fit=crop',
    description:
      'Das Wort Gottes (The Word of God) radio — Bible teaching and Christian programming in multiple languages. English channel featuring expository preaching and hymns.',
    listeners: 'Global streaming',
    streamUrl: 'https://server23644.streamplus.de/stream/1/',
    currentShow: { name: 'DWG Radio Live', host: 'DWG Team', time: '24/7 Streaming' },
    schedule: [
      { time: 'All Day', show: 'Bible Teaching', host: 'Various Teachers', desc: 'Expository Bible teaching' },
      { time: 'Featured', show: 'Sermon of the Day', host: 'Various Pastors', desc: 'Daily sermon broadcast' },
      { time: 'Featured', show: 'Hymns & Music', host: 'DWG Team', desc: 'Classic hymns and worship' },
      { time: 'Featured', show: 'Scripture Reading', host: 'DWG Team', desc: 'Bible reading and devotion' },
      { time: 'Featured', show: 'Prayer Time', host: 'DWG Team', desc: 'Prayer and intercession' },
      { time: 'Featured', show: 'Evening Devotions', host: 'DWG Team', desc: 'Evening Bible devotions' },
    ],
  },
];

/** Curated lists used by the Discover sidebar and mobile accordion (original indices). */
export const TRENDING_INDICES = [0, 2, 10, 13]; // K-LOVE, Moody Radio, ChristianHits, Abiding Sacred
export const RECOMMENDED_INDICES = [1, 3, 12, 15]; // BBN Radio, RefNet, ChristianPowerPraise, Bluegrass Hymns

/** Category labels used on the badges (note: `religious` displays as TEACHING). */
export const CATEGORY_BADGE_LABEL: Record<StationCategory, string> = {
  live: 'LIVE',
  podcast: 'PODCAST',
  music: 'MUSIC',
  religious: 'TEACHING',
};
