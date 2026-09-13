import { collectDaumKeywords } from './collectors/daum';
import { collectGoogleKeywords } from './collectors/google';
import { collectNaverKeywords } from './collectors/naver';
import { dedupeKeywordMasters, toKeywordMaster } from './scorer';
import { upsertKeywords } from './supabase';
import type { CollectedKeyword, KeywordMaster, Portal } from '../types/keyword';

export interface CollectorOutcome {
  portal: Portal;
  collected: number;
  upsertCandidates: number;
  error?: string;
}

export interface PipelineResult {
  collectedDate: string;
  durationMs: number;
  portals: CollectorOutcome[];
  uniqueRows: KeywordMaster[];
  upserted: number;
}

export function kstDateString(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function toRows(items: CollectedKeyword[], collectedDate: string): KeywordMaster[] {
  const rows: KeywordMaster[] = [];
  for (const item of items) {
    const row = toKeywordMaster(item, collectedDate);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

export async function collectAndScoreAll(collectedDate = kstDateString()): Promise<{
  portals: CollectorOutcome[];
  uniqueRows: KeywordMaster[];
}> {
  const settled = await Promise.allSettled([
    collectNaverKeywords(),
    collectDaumKeywords(),
    collectGoogleKeywords(),
  ]);

  const portals: Portal[] = ['naver', 'daum', 'google'];
  const outcomes: CollectorOutcome[] = [];
  const allRows: KeywordMaster[] = [];

  settled.forEach((result, index) => {
    const portal = portals[index] ?? 'naver';

    if (result.status === 'fulfilled') {
      const rows = toRows(result.value, collectedDate);
      allRows.push(...rows);
      outcomes.push({
        portal,
        collected: result.value.length,
        upsertCandidates: rows.length,
      });
      return;
    }

    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(`[pipeline] ${portal} collector rejected: ${message}`);
    outcomes.push({
      portal,
      collected: 0,
      upsertCandidates: 0,
      error: message,
    });
  });

  return {
    portals: outcomes,
    uniqueRows: dedupeKeywordMasters(allRows),
  };
}

export async function runCollectPipeline(): Promise<PipelineResult> {
  const collectedDate = kstDateString();
  const startedAt = Date.now();
  const { portals, uniqueRows } = await collectAndScoreAll(collectedDate);
  const upserted = await upsertKeywords(uniqueRows);

  return {
    collectedDate,
    durationMs: Date.now() - startedAt,
    portals,
    uniqueRows,
    upserted,
  };
}
