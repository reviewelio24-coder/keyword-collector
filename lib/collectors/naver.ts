import type { CollectedKeyword, SeedKeyword } from '../../types/keyword';
import { BROWSER_UA, getJsonOrText } from './http';

const FETCH_TIMEOUT_MS = 8_000;
const SEED_GAP_MS = 180;
const MAX_SUGGESTIONS = 10;

const BROWSER_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://www.naver.com/',
  'User-Agent': BROWSER_UA,
};

/** 네이버: 2030 직장·IT + 40s/50s 관심사 시드 */
const NAVER_SEEDS: SeedKeyword[] = [
  { seed: '수능', targetGeneration: '10s', category: '교육' },
  { seed: '입시', targetGeneration: '10s', category: '교육' },
  { seed: '고등학교', targetGeneration: '10s', category: '교육' },
  { seed: '아이돌', targetGeneration: '10s', category: '엔터' },
  { seed: '게임 공략', targetGeneration: '10s', category: '취미' },
  { seed: '이직', targetGeneration: '2030', category: '직장' },
  { seed: '연봉', targetGeneration: '2030', category: '직장' },
  { seed: '사이드프로젝트', targetGeneration: '2030', category: 'IT' },
  { seed: '개발자', targetGeneration: '2030', category: 'IT' },
  { seed: '인공지능', targetGeneration: '2030', category: 'IT' },
  { seed: '재테크', targetGeneration: '2030', category: '재테크' },
  { seed: '주식', targetGeneration: '2030', category: '재테크' },
  { seed: '워케이션', targetGeneration: '2030', category: '직장' },
  { seed: '부동산', targetGeneration: '40s', category: '재테크' },
  { seed: '대출', targetGeneration: '40s', category: '재테크' },
  { seed: '내 집 마련', targetGeneration: '40s', category: '재테크' },
  { seed: '자녀 학원', targetGeneration: '40s', category: '교육' },
  { seed: '건강검진', targetGeneration: '40s', category: '건강' },
  { seed: '중년 다이어트', targetGeneration: '40s', category: '건강' },
  { seed: '연봉 협상', targetGeneration: '40s', category: '직장' },
  { seed: '은퇴 준비', targetGeneration: '50s', category: '라이프' },
  { seed: '퇴직금', targetGeneration: '50s', category: '재테크' },
  { seed: '국민연금', targetGeneration: '50s', category: '재테크' },
  { seed: '임금피크제', targetGeneration: '50s', category: '직장' },
  { seed: '재취업', targetGeneration: '50s', category: '직장' },
  { seed: '암보험', targetGeneration: '50s', category: '건강' },
  { seed: '오십견', targetGeneration: '50s', category: '건강' },
  { seed: '갱년기', targetGeneration: '50s', category: '건강' },
  { seed: '연금', targetGeneration: '60s+', category: '재테크' },
  { seed: '은퇴', targetGeneration: '60s+', category: '라이프' },
  { seed: '건강식품', targetGeneration: '60s+', category: '건강' },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pushKeyword(target: string[], value: unknown): void {
  if (typeof value === 'string') {
    const trimmed = value.replace(/<[^>]+>/g, '').trim();
    if (trimmed) {
      target.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value) && value.length > 0) {
    pushKeyword(target, value[0]);
    return;
  }

  const rec = asRecord(value);
  if (!rec) {
    return;
  }

  for (const key of ['item', 'keyword', 'query', 'word', 'txt']) {
    if (key in rec) {
      pushKeyword(target, rec[key]);
      return;
    }
  }
}

/** data.items[0] 및 구버전 items[0] / 평면 배열을 모두 수용 */
function extractSuggestions(payload: unknown): string[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const items = data?.items ?? root?.items ?? root?.suggest ?? payload;

  const groups = Array.isArray(items) ? items : [];
  const firstGroup = groups[0];
  const rows = Array.isArray(firstGroup) ? firstGroup : groups;

  const suggestions: string[] = [];
  for (const entry of rows) {
    pushKeyword(suggestions, entry);
  }

  if (suggestions.length === 0) {
    for (const group of groups) {
      if (!Array.isArray(group)) {
        pushKeyword(suggestions, group);
        continue;
      }
      for (const entry of group) {
        pushKeyword(suggestions, entry);
      }
    }
  }

  return [...new Set(suggestions)];
}

function parseNaverBody(json: unknown, body: string): string[] {
  const fromJson = extractSuggestions(json);
  if (fromJson.length > 0) {
    return fromJson;
  }

  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return extractSuggestions(JSON.parse(trimmed) as unknown);
  } catch {
    const jsonp = trimmed.match(/^[a-zA-Z_]\w*\(([\s\S]*)\)\s*;?\s*$/);
    if (jsonp?.[1]) {
      try {
        return extractSuggestions(JSON.parse(jsonp[1]) as unknown);
      } catch {
        return [];
      }
    }
    return [];
  }
}

function buildNaverUrl(seed: string): string {
  const q = encodeURIComponent(seed);
  return (
    `https://ac.search.naver.com/nx/ac?q=${q}` +
    `&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&q_enc=UTF-8&st=100`
  );
}

async function fetchNaverSuggestions(seed: string): Promise<string[]> {
  const { status, body, json } = await getJsonOrText(buildNaverUrl(seed), BROWSER_HEADERS, FETCH_TIMEOUT_MS);

  if (status < 200 || status >= 300) {
    throw new Error(`Naver AC HTTP ${status}`);
  }

  return parseNaverBody(json, body).slice(0, MAX_SUGGESTIONS);
}

export async function collectNaverKeywords(): Promise<CollectedKeyword[]> {
  const collected: CollectedKeyword[] = [];

  for (const [index, seed] of NAVER_SEEDS.entries()) {
    try {
      const suggestions = await fetchNaverSuggestions(seed.seed);

      suggestions.forEach((keyword, rankIndex) => {
        collected.push({
          keyword,
          portal: 'naver',
          targetGeneration: seed.targetGeneration,
          category: seed.category,
          rank: rankIndex + 1,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[naver] seed="${seed.seed}" failed: ${message}`);
    }

    if (index < NAVER_SEEDS.length - 1) {
      await sleep(SEED_GAP_MS);
    }
  }

  return collected;
}
