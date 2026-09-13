import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runCollectPipeline } from '../../lib/pipeline';

export const config = {
  maxDuration: 300,
};

function isAuthorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const header = req.headers.authorization;
  return header === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  try {
    const result = await runCollectPipeline();
    res.status(200).json({
      ok: true,
      collected_date: result.collectedDate,
      duration_ms: result.durationMs,
      portals: result.portals,
      unique_keywords: result.uniqueRows.length,
      upserted: result.upserted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[collect] pipeline failed: ${message}`);
    res.status(500).json({ ok: false, error: message });
  }
}
