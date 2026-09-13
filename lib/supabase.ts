import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { KeywordMaster } from '../types/keyword';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let client: SupabaseClient | null = null;

/** Service Role Key 기반 Supabase 클라이언트 (서버 전용, RLS 우회) */
export function getSupabaseAdmin(): SupabaseClient {
  if (client) {
    return client;
  }

  client = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

const TABLE_MISSING_RE = /could not find the table|does not exist|schema cache|PGRST205|42P01/i;

export async function keywordsTableExists(): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('keywords_master').select('keyword_id').limit(1);

  if (!error) {
    return true;
  }

  if (TABLE_MISSING_RE.test(`${error.code ?? ''} ${error.message}`)) {
    return false;
  }

  throw new Error(`keywords_master probe failed: ${error.message}`);
}

const UPSERT_CHUNK_SIZE = 500;

export async function upsertKeywords(rows: KeywordMaster[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const supabase = getSupabaseAdmin();
  let upserted = 0;

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    const { error, count } = await supabase.from('keywords_master').upsert(chunk, {
      onConflict: 'keyword_id',
      count: 'exact',
    });

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }

    upserted += count ?? chunk.length;
  }

  return upserted;
}
