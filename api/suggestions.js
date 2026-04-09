import { getClient } from './_lib/innertube.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.q || '').trim();
  if (!query) return res.status(200).json({ suggestions: [] });

  try {
    const yt = await getClient();
    const suggestions = await yt.music.getSearchSuggestions(query);
    const items = (suggestions || []).map(s => s.text || s).filter(Boolean).slice(0, 8);
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    return res.status(200).json({ suggestions: items });
  } catch (err) {
    console.error('Suggestions error:', err);
    return res.status(200).json({ suggestions: [] });
  }
}
