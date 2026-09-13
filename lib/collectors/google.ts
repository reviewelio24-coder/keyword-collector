import type { CollectedKeyword, SeedKeyword } from '../../types/keyword';

const GOOGLE_SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';
const FETCH_TIMEOUT_MS = 8_000;
const SEED_GAP_MS = 180;
const MAX_SUGGESTIONS = 10;

const BROWSER_HEADERS = {
  Accept: 'application/json, text/javascript, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  Referer: 'https://www.google.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

/** 구글: 10대~30대 신기술·생산성·글로벌 트렌드 중심 */
const GOOGLE_SEEDS: SeedKeyword[] = [
  { seed: '수능 공부법', targetGeneration: '10s', category: '교육' },
  { seed: '코딩 배우기', targetGeneration: '10s', category: 'IT' },
  { seed: '유튜브 쇼츠', targetGeneration: '10s', category: '엔터' },
  { seed: 'AI 도구', targetGeneration: '2030', category: 'IT' },
  { seed: 'ChatGPT', targetGeneration: '2030', category: 'IT' },
  { seed: '생산성 앱', targetGeneration: '2030', category: 'IT' },
  { seed: '노션 템플릿', targetGeneration: '2030', category: 'IT' },
  { seed: '사이드프로젝트', targetGeneration: '2030', category: 'IT' },
  { seed: '개발 로드맵', targetGeneration: '2030', category: 'IT' },
  { seed: '리모트 워크', targetGeneration: '2030', category: '직장' },
  { seed: '영어 공부', targetGeneration: '2030', category: '교육' },
  { seed: '디지털 노마드', targetGeneration: '2030', category: '라이프' },
  { seed: '은퇴 설계', targetGeneration: '4050', category: '재테크' },
  { seed: '건강 관리', targetGeneration: '4050', category: '건강' },
  { seed: '유튜브 시작', targetGeneration: '4050', category: '취미' },
  { seed: '스마트폰 사용법', targetGeneration: '60s+', category: 'IT' },
  { seed: '유튜브 보는 법', targetGeneration: '60s+', category: 'IT' },
  { seed: '건강 정보', targetGeneration: '60s+', category: '건강' },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSuggestions(payload: unknown): string[] {
  if (!Array.isArray(payload) || payload.length < 2) {
    return [];
  }

  const list = payload[1];
  if (!Array.isArray(list)) {
    return [];
  }

  const suggestions: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) {
      suggestions.push(entry);
      continue;
    }

    if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].trim()) {
      suggestions.push(entry[0]);
    }
  }

  return suggestions;
}

async function fetchGoogleSuggestions(seed: string): Promise<string[]> {
  const url = new URL(GOOGLE_SUGGEST_URL);
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('hl', 'ko');
  url.searchParams.set('q', seed);

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Google suggest HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  return extractSuggestions(payload).slice(0, MAX_SUGGESTIONS);
}

export async function collectGoogleKeywords(): Promise<CollectedKeyword[]> {
  const collected: CollectedKeyword[] = [];

  for (const [index, seed] of GOOGLE_SEEDS.entries()) {
    try {
      const suggestions = await fetchGoogleSuggestions(seed.seed);

      suggestions.forEach((keyword, rankIndex) => {
        collected.push({
          keyword,
          portal: 'google',
          targetGeneration: seed.targetGeneration,
          category: seed.category,
          rank: rankIndex + 1,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[google] seed="${seed.seed}" failed: ${message}`);
    }

    if (index < GOOGLE_SEEDS.length - 1) {
      await sleep(SEED_GAP_MS);
    }
  }

  return collected;
}
