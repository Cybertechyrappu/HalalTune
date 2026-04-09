// --- ISLAMIC KEYWORD PREFIXES ---
export const ISLAMIC_TERMS = [
  'nasheed', 'naat', 'hamd', 'islamic', 'quran', 'salawat', 'anasheed',
  'dhikr', 'zikr', 'mawlid', 'madh', 'muslim', 'allah', 'muhammad',
  'prophet', 'recitation', 'tilawat', 'dua', 'tawasul', 'munshid',
  'sholawat', 'ilahi', 'maher zain', 'sami yusuf', 'omar esa',
  'siedd', 'muqit', 'halal', 'deen', 'ummah', 'ramadan', 'eid',
];

export const CHANNEL_WHITELIST = [
  'maher zain', 'sami yusuf', 'omar esa', 'siedd',
  'muhammad al muqit', 'ahmed bukhatir', 'mesut kurtis',
  'raef', 'safe adam', 'muslim belal', 'abdulrahman mohammed',
  'mishary rashid', 'harris j', 'humood', 'humood alkhudher',
  'zain bhikha', 'dawud wharnsby', 'native deen', 'outlandish',
  'labbayk', 'omar offendum', 'deen squad', 'kamal uddin',
  'muad', 'muhammed muhassin', 'ibrahim khan',
  'one path network', 'mercifulservant', 'freequraneducation',
  'al jazeera quran', 'quran recitation', 'nasheed',
  'islamic nasheed', 'vocals only', 'no music nasheed',
];

export const BLOCKED_TERMS = [
  'explicit', 'uncensored', 'remix dj', 'club mix', 'twerk',
  'strip', 'drugs', 'alcohol', 'beer', 'wine', 'vodka', 'whiskey',
  'casino', 'gambling', 'hookah', 'weed', 'marijuana',
  'sexy', 'xxx', 'nsfw', 'onlyfans', 'hot girl',
  'parody', 'diss track',
];

export const POSITIVE_KEYWORDS = [
  'nasheed', 'naat', 'hamd', 'islamic', 'quran', 'allah',
  'muhammad', 'prophet', 'salawat', 'sholawat', 'dhikr', 'zikr',
  'muslim', 'islam', 'ramadan', 'eid', 'deen', 'halal',
  'recitation', 'tilawat', 'mawlid', 'madh', 'ilahi', 'dua',
  'vocal only', 'vocals only', 'no music', 'a cappella',
  'anasheed', 'munshid', 'tawasul', 'haram', 'ummah', 'masjid',
  'mosque', 'jannah', 'tawheed', 'sunnah', 'hadith', 'surah',
  'ayah', 'bismillah', 'alhamdulillah', 'subhanallah',
  'astaghfirullah', 'insha allah', 'masha allah',
];

export function prepareQuery(query) {
  const lower = query.toLowerCase();
  const hasIslamicTerm = ISLAMIC_TERMS.some(term => lower.includes(term));
  if (hasIslamicTerm) return query;
  return `${query} nasheed`;
}

export function filterResult(item) {
  const title   = (item.title   || '').toLowerCase();
  const artist  = (item.artist  || '').toLowerCase();
  const channel = (item.channel || '').toLowerCase();
  const combined = `${title} ${artist} ${channel}`;

  for (const term of BLOCKED_TERMS) {
    if (combined.includes(term)) {
      return { pass: false, reason: `blocked term: ${term}` };
    }
  }

  for (const ch of CHANNEL_WHITELIST) {
    if (channel.includes(ch) || artist.includes(ch)) {
      return { pass: true, reason: `whitelisted channel: ${ch}` };
    }
  }

  for (const kw of POSITIVE_KEYWORDS) {
    if (combined.includes(kw)) {
      return { pass: true, reason: `positive keyword: ${kw}` };
    }
  }

  return { pass: false, reason: 'no Islamic indicators found' };
}
