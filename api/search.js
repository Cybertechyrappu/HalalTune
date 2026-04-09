import { getClient } from './_lib/innertube.js';
import { prepareQuery, filterResult } from './_lib/halal-filter.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing query parameter "q"' });

  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  try {
    const yt = await getClient();
    const preparedQuery = prepareQuery(query);
    const search = await yt.music.search(preparedQuery, { type: 'song' });

    const results = [];
    const items = search.contents?.contents || search.results || [];

    for (const item of items) {
      if (results.length >= limit) break;

      const title    = item.title?.text || item.name || '';
      const artists  = item.artists?.map(a => a.name).join(', ') || item.author?.name || '';
      const videoId  = item.id || item.video_id || '';
      const duration = item.duration?.text || '';
      const thumbnail = item.thumbnails?.[0]?.url ||
                        item.thumbnail?.contents?.[0]?.url || '';

      if (!videoId || !title) continue;

      const check = filterResult({ title, artist: artists, channel: artists });
      if (!check.pass) continue;

      results.push({
        id: `yt_${videoId}`,
        videoId,
        title,
        artist: artists,
        coverArt: thumbnail,
        duration,
        source: 'youtube',
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ results, query: preparedQuery });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Search failed', message: err.message });
  }
}
