import { getPlayerClient } from './_lib/innertube.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const videoId = (req.query.id || '').trim();
  if (!videoId) return res.status(400).json({ error: 'Missing "id" parameter' });

  try {
    const yt = await getPlayerClient();
    const info = await yt.getBasicInfo(videoId);

    const format = info.chooseFormat({
      type: 'audio',
      quality: 'best',
    });

    if (!format || !format.decipher_url) {
      return res.status(404).json({ error: 'No audio stream available' });
    }

    const audioResponse = await fetch(format.decipher_url, {
      headers: {
        'Range': req.headers.range || '',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    res.status(audioResponse.status);
    res.setHeader('Content-Type', audioResponse.headers.get('content-type') || 'audio/webm');
    if (audioResponse.headers.get('content-length')) {
      res.setHeader('Content-Length', audioResponse.headers.get('content-length'));
    }
    if (audioResponse.headers.get('content-range')) {
      res.setHeader('Content-Range', audioResponse.headers.get('content-range'));
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const { Readable } = await import('stream');
    Readable.fromWeb(audioResponse.body).pipe(res);
  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Stream failed', message: err.message });
    }
  }
}
