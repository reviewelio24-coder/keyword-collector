import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../lib/supabase';
import type { Portal, TargetGeneration } from '../types/keyword';

const GENERATIONS = new Set<TargetGeneration>(['10s', '2030', '4050', '60s+']);
const PORTALS = new Set<Portal>(['naver', 'daum', 'google']);

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseLimit(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 20;
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.min(100, Math.max(1, parsed));
}

function parseMinScore(raw: string | undefined): number {
  const parsed = raw ? Number.parseFloat(raw) : 0;
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const generationRaw = firstQueryValue(req.query.generation);
  const portalRaw = firstQueryValue(req.query.portal);
  const limit = parseLimit(firstQueryValue(req.query.limit));
  const minScore = parseMinScore(firstQueryValue(req.query.min_score));

  if (generationRaw && !GENERATIONS.has(generationRaw as TargetGeneration)) {
    res.status(400).json({
      ok: false,
      error: `Invalid generation. Use one of: ${[...GENERATIONS].join(', ')}`,
    });
    return;
  }

  if (portalRaw && !PORTALS.has(portalRaw as Portal)) {
    res.status(400).json({
      ok: false,
      error: `Invalid portal. Use one of: ${[...PORTALS].join(', ')}`,
    });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('keywords_master')
      .select(
        'keyword_id, keyword, portal, target_generation, category, monthly_vol, competition_idx, opportunity_score, collected_date',
      )
      .gte('opportunity_score', minScore)
      .order('opportunity_score', { ascending: false })
      .limit(limit);

    if (generationRaw) {
      query = query.eq('target_generation', generationRaw);
    }

    if (portalRaw) {
      query = query.eq('portal', portalRaw);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }

    res.status(200).json({
      ok: true,
      count: data?.length ?? 0,
      filters: {
        generation: generationRaw ?? null,
        portal: portalRaw ?? null,
        min_score: minScore,
        limit,
      },
      items: data ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: message });
  }
}
