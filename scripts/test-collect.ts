import { config } from 'dotenv';
import { runCollectPipeline } from '../lib/pipeline';
import { getSupabaseAdmin, keywordsTableExists } from '../lib/supabase';
import type { KeywordMaster } from '../types/keyword';

config();

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

function printMissingEnv(names: string[]): never {
  console.error(`[test:collect] 필수 환경 변수가 없습니다: ${names.join(', ')}`);
  console.error('[test:collect] .env.example을 복사해 .env를 만들고 값을 채워 주세요.');
  process.exit(1);
}

function topScoreRows(rows: KeywordMaster[], limit = 5): Array<{
  keyword: string;
  portal: string;
  generation: string;
  category: string;
  opportunity_score: number;
}> {
  return [...rows]
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, limit)
    .map((row) => ({
      keyword: row.keyword,
      portal: row.portal,
      generation: row.target_generation,
      category: row.category,
      opportunity_score: row.opportunity_score,
    }));
}

async function fetchTopFromDb(limit = 5): Promise<
  Array<{
    keyword: string;
    portal: string;
    generation: string;
    category: string;
    opportunity_score: number;
  }>
> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('keywords_master')
    .select('keyword, portal, target_generation, category, opportunity_score')
    .order('opportunity_score', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`조회 검증 실패: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    keyword: String(row.keyword),
    portal: String(row.portal),
    generation: String(row.target_generation),
    category: String(row.category ?? '일반'),
    opportunity_score: Number(row.opportunity_score),
  }));
}

async function main(): Promise<void> {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    printMissingEnv(missing);
  }

  const tableReady = await keywordsTableExists();
  if (!tableReady) {
    console.error('[test:collect] keywords_master 테이블이 없습니다. 먼저 `npm run db:setup`을 실행하세요.');
    process.exit(1);
  }

  console.log('[test:collect] 3사 포털 수집을 병렬 실행합니다...');
  const result = await runCollectPipeline();

  const totalCollected = result.portals.reduce((sum, item) => sum + item.collected, 0);
  const scoredCount = result.portals.reduce((sum, item) => sum + item.upsertCandidates, 0);

  console.log('\n=== 수집 파이프라인 결과 ===');
  console.log(`수집일(KST)     : ${result.collectedDate}`);
  console.log(`소요 시간        : ${result.durationMs}ms`);
  console.log(`원천 수집 총건수 : ${totalCollected}`);
  console.log(`정제/스코어링    : ${scoredCount} → 중복 제거 ${result.uniqueRows.length}건`);
  console.log(`Supabase Upsert  : ${result.upserted}건`);

  console.log('\n[포털별 수량]');
  console.table(
    result.portals.map((item) => ({
      portal: item.portal,
      collected: item.collected,
      scored: item.upsertCandidates,
      error: item.error ?? '',
    })),
  );

  console.log('\n[세대별 수량]');
  const generationOrder = ['10s', '2030', '40s', '50s', '60s+'] as const;
  const generationCounts = Object.fromEntries(generationOrder.map((key) => [key, 0])) as Record<
    (typeof generationOrder)[number],
    number
  >;
  for (const row of result.uniqueRows) {
    if (row.target_generation in generationCounts) {
      generationCounts[row.target_generation as (typeof generationOrder)[number]] += 1;
    }
  }
  console.table(
    generationOrder.map((generation) => ({
      generation,
      count: generationCounts[generation],
    })),
  );

  console.log('\n[상위 기회 점수 키워드 5개 — 적재 직후 메모리]');
  console.table(topScoreRows(result.uniqueRows));

  console.log('\n[상위 기회 점수 키워드 5개 — Supabase 재조회]');
  console.table(await fetchTopFromDb());

  const failedPortals = result.portals.filter((item) => item.error);
  if (result.uniqueRows.length === 0) {
    console.error('[test:collect] 적재된 키워드가 없습니다. 포털 응답을 확인하세요.');
    process.exit(1);
  }

  if (failedPortals.length === result.portals.length) {
    console.error('[test:collect] 모든 포털 수집이 실패했습니다.');
    process.exit(1);
  }

  if (generationCounts['40s'] === 0 || generationCounts['50s'] === 0) {
    console.error('[test:collect] 40s/50s 분류 적재가 비어 있습니다.');
    process.exit(1);
  }

  console.log('\n[test:collect] 파이프라인 검증이 완료되었습니다.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[test:collect] 실패: ${message}`);
  process.exit(1);
});
