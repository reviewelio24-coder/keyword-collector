import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { getSupabaseAdmin } from '../lib/supabase';

config();

const PORT = Number(process.env.PORT || 3000);
const INDEX_PATH = join(process.cwd(), 'public', 'index.html');

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function handleKeywords(reqUrl: URL, res: ServerResponse): Promise<void> {
  const supabase = getSupabaseAdmin();
  const type = reqUrl.searchParams.get('type');
  const dateRaw = reqUrl.searchParams.get('date');
  const limitRaw = Number.parseInt(reqUrl.searchParams.get('limit') || '20', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, limitRaw)) : 20;
  const minScore = Number.parseFloat(reqUrl.searchParams.get('min_score') || '0') || 0;
  const generation = reqUrl.searchParams.get('generation');
  const portal = reqUrl.searchParams.get('portal');

  const { data: dateRows, error: dateError } = await supabase
    .from('keywords_master')
    .select('collected_date')
    .order('collected_date', { ascending: false });

  if (dateError) {
    send(res, 500, JSON.stringify({ ok: false, error: dateError.message }), 'application/json; charset=utf-8');
    return;
  }

  const dates = [
    ...new Set(
      (dateRows ?? [])
        .map((row) => (typeof row.collected_date === 'string' ? row.collected_date.slice(0, 10) : ''))
        .filter(Boolean),
    ),
  ];

  if (type === 'dates') {
    send(
      res,
      200,
      JSON.stringify({ ok: true, dates, latest: dates[0] ?? null }),
      'application/json; charset=utf-8',
    );
    return;
  }

  const date = dateRaw || dates[0];
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
  if (generation) {
    query = query.eq('target_generation', generation);
  }
  if (portal) {
    query = query.eq('portal', portal);
  }

  const { data, error } = await query;
  if (error) {
    send(res, 500, JSON.stringify({ ok: false, error: error.message }), 'application/json; charset=utf-8');
    return;
  }

  send(
    res,
    200,
    JSON.stringify({
      ok: true,
      count: data?.length ?? 0,
      dates,
      filters: { date: date ?? null },
      items: data ?? [],
    }),
    'application/json; charset=utf-8',
  );
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    if (reqUrl.pathname === '/api/keywords') {
      await handleKeywords(reqUrl, res);
      return;
    }

    if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
      send(res, 200, readFileSync(INDEX_PATH, 'utf8'), 'text/html; charset=utf-8');
      return;
    }

    send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(res, 500, JSON.stringify({ ok: false, error: message }), 'application/json; charset=utf-8');
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard ready: http://localhost:${PORT}`);
});
