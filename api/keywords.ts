import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../lib/supabase';
import type { Portal } from '../types/keyword';

const GENERATIONS = new Set(['10s', '2030', '40s', '50s', '60s+', '4050']);
const GENERATION_40_50 = ['40s', '50s', '4050'] as const;
const PORTALS = new Set<Portal>(['naver', 'daum', 'google']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  return Math.min(1000, Math.max(1, parsed));
}

function parseMinScore(raw: string | undefined): number {
  const parsed = raw ? Number.parseFloat(raw) : 0;
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  return value.slice(0, 10);
}

async function listCollectedDates(): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('keywords_master')
    .select('collected_date')
    .order('collected_date', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const unique = new Set<string>();
  for (const row of data ?? []) {
    const date = normalizeDate(row.collected_date);
    if (date) {
      unique.add(date);
    }
  }

  return [...unique].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
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

  const typeRaw = firstQueryValue(req.query.type);
  const dateRaw = firstQueryValue(req.query.date);
  const generationRaw = firstQueryValue(req.query.generation);
  const portalRaw = firstQueryValue(req.query.portal);
  const limit = parseLimit(firstQueryValue(req.query.limit));
  const minScore = parseMinScore(firstQueryValue(req.query.min_score));

  if (dateRaw && !DATE_RE.test(dateRaw)) {
    res.status(400).json({ ok: false, error: 'Invalid date. Use YYYY-MM-DD.' });
    return;
  }

  if (generationRaw && !GENERATIONS.has(generationRaw)) {
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
    const dates = await listCollectedDates();

    if (typeRaw === 'dates') {
      res.status(200).json({ ok: true, dates, latest: dates[0] ?? null });
      return;
    }

    const date = dateRaw ?? dates[0];
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('keywords_master')
      .select(
        'keyword_id, keyword, portal, target_generation, category, monthly_vol, competition_idx, opportunity_score, collected_date',
      )
      .gte('opportunity_score', minScore)
      .order('opportunity_score', { ascending: false })
      .limit(limit);

    if (date) {
      query = query.eq('collected_date', date);
    }

    if (generationRaw === '4050') {
      query = query.in('target_generation', [...GENERATION_40_50]);
    } else if (generationRaw) {
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
      dates,
      filters: {
        date: date ?? null,
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
