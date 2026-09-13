import { createHash } from 'crypto';
import type { CollectedKeyword, CompetitionIdx, GenerationType, KeywordMaster, Portal } from '../types/keyword';

const COMPETITION_PENALTY: Record<CompetitionIdx, number> = {
  LOW: 0,
  MID: 10,
  HIGH: 25,
};

export function normalizeKeyword(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s+/&·.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildKeywordId(portal: Portal, keyword: string): string {
  return createHash('md5').update(`${portal}_${keyword}`, 'utf8').digest('hex');
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

/**
 * Opportunity Score (0~100)
 * Score = min(100, ln(monthly_vol + 1) * 6 + (TrendRate * 0.3) - CompPenalty)
 * 월간 검색량이 없으면 자동완성 순위 기반 Fallback: 100 - (Rank * 5)
 */
export function calculateOpportunityScore(params: {
  monthlyVol: number;
  trendRate?: number;
  competitionIdx: CompetitionIdx;
  rank: number;
}): number {
  const { monthlyVol, trendRate = 0, competitionIdx, rank } = params;
  const safeRank = Math.min(10, Math.max(1, rank));

  if (!monthlyVol || monthlyVol <= 0) {
    return clampScore(100 - safeRank * 5);
  }

  const penalty = COMPETITION_PENALTY[competitionIdx];
  const score = Math.log(monthlyVol + 1) * 6 + trendRate * 0.3 - penalty;
  return clampScore(score);
}

const FIFTY_PATTERNS = [
  /은퇴/,
  /퇴직/,
  /국민연금/,
  /임금피크/,
  /재취업/,
  /암보험/,
  /오십견/,
  /갱년기/,
  /노후/,
  /명퇴/,
];

const FORTY_PATTERNS = [
  /부동산/,
  /대출/,
  /내\s?집/,
  /자녀/,
  /학원/,
  /건강검진/,
  /중년/,
  /연봉\s?협상/,
  /다이어트/,
];

/** 40s/50s 시드에서 키워드 텍스트로 세대를 재분류. 그 외 세대는 시드 태그를 유지 */
export function inferTargetGeneration(keyword: string, fallback: GenerationType): GenerationType {
  if (fallback !== '40s' && fallback !== '50s') {
    return fallback;
  }

  const text = keyword.normalize('NFC');
  const looksFifty = FIFTY_PATTERNS.some((pattern) => pattern.test(text));
  const looksForty = FORTY_PATTERNS.some((pattern) => pattern.test(text));

  if (looksFifty) {
    return '50s';
  }
  if (looksForty) {
    return '40s';
  }

  return fallback;
}

export function toKeywordMaster(item: CollectedKeyword, collectedDate: string): KeywordMaster | null {
  const keyword = normalizeKeyword(item.keyword);
  if (keyword.length < 2) {
    return null;
  }

  const competitionIdx = item.competitionIdx ?? 'MID';
  const monthlyVol = item.monthlyVol ?? 0;

  return {
    keyword_id: buildKeywordId(item.portal, keyword),
    keyword,
    portal: item.portal,
    target_generation: inferTargetGeneration(keyword, item.targetGeneration),
    category: item.category || '일반',
    monthly_vol: monthlyVol,
    competition_idx: competitionIdx,
    opportunity_score: calculateOpportunityScore({
      monthlyVol,
      trendRate: item.trendRate ?? 0,
      competitionIdx,
      rank: item.rank,
    }),
    collected_date: collectedDate,
  };
}

/** 동일 portal+keyword 충돌 시 더 높은 기회 점수(동점이면 상위 순위)를 유지 */
export function dedupeKeywordMasters(rows: KeywordMaster[]): KeywordMaster[] {
  const byId = new Map<string, KeywordMaster>();

  for (const row of rows) {
    const existing = byId.get(row.keyword_id);
    if (!existing) {
      byId.set(row.keyword_id, row);
      continue;
    }

    const shouldReplace =
      row.opportunity_score > existing.opportunity_score ||
      (row.opportunity_score === existing.opportunity_score && row.monthly_vol > existing.monthly_vol);

    if (shouldReplace) {
      byId.set(row.keyword_id, row);
    }
  }

  return [...byId.values()];
}
