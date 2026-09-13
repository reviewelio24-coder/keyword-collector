import { config } from 'dotenv';
import postgres from 'postgres';
import { KEYWORDS_MASTER_DDL, KEYWORDS_MASTER_INDEX_SQL, KEYWORDS_MASTER_TABLE_SQL } from '../lib/schema';
import { getSupabaseAdmin, keywordsTableExists } from '../lib/supabase';

config();

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

function resolveDbUrl(): string | undefined {
  return (
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.DIRECT_URL
  );
}

function printMissingEnv(names: string[]): never {
  console.error(`[db:setup] 필수 환경 변수가 없습니다: ${names.join(', ')}`);
  console.error('[db:setup] .env.example을 복사해 .env를 만들고 값을 채워 주세요.');
  process.exit(1);
}

async function applyDdl(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, {
    max: 1,
    ssl: 'require',
    idle_timeout: 5,
    connect_timeout: 15,
  });

  try {
    await sql.unsafe(KEYWORDS_MASTER_TABLE_SQL);
    await sql.unsafe(KEYWORDS_MASTER_INDEX_SQL);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    printMissingEnv(missing);
  }

  getSupabaseAdmin();

  const existed = await keywordsTableExists();
  if (existed) {
    console.log('[db:setup] keywords_master 테이블이 이미 있습니다. DDL 적용을 건너뜁니다.');
    return;
  }

  console.log('[db:setup] keywords_master 테이블이 없습니다. 생성을 시도합니다.');

  const dbUrl = resolveDbUrl();
  if (!dbUrl) {
    console.error('[db:setup] 테이블을 자동 생성하려면 DATABASE_URL(또는 SUPABASE_DB_URL)이 필요합니다.');
    console.error('[db:setup] Supabase Dashboard > Project Settings > Database > URI 에서 연결 문자열을 복사하세요.');
    console.error('\n----- 수동 실행용 DDL -----\n');
    console.error(KEYWORDS_MASTER_DDL);
    console.error('\n---------------------------\n');
    process.exit(1);
  }

  await applyDdl(dbUrl);

  const created = await keywordsTableExists();
  if (!created) {
    throw new Error('DDL 실행 후에도 keywords_master 테이블이 조회되지 않습니다. schema cache 갱신을 잠시 기다린 뒤 다시 실행하세요.');
  }

  console.log('[db:setup] keywords_master 테이블과 idx_keywords_gen_score 인덱스를 생성했습니다.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db:setup] 실패: ${message}`);
  process.exit(1);
});
