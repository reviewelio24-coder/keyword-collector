import type { CollectedKeyword, SeedKeyword } from '../../types/keyword';
import { BROWSER_UA, httpsGetText } from './http';

const FETCH_TIMEOUT_MS = 8_000;
const SEED_GAP_MS = 180;
const MAX_SUGGESTIONS = 10;

const BROWSER_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://www.daum.net/',
  'User-Agent': BROWSER_UA,
};

/** 다음: 40~60대+ 연금·은퇴·재테크·건강 중심 */
const DAUM_SEEDS: SeedKeyword[] = [
  { seed: '수능 일정', targetGeneration: '10s', category: '교육' },
  { seed: '대학 입시', targetGeneration: '10s', category: '교육' },
  { seed: '연봉 협상', targetGeneration: '2030', category: '직장' },
  { seed: '적금', targetGeneration: '2030', category: '재테크' },
  { seed: '청약', targetGeneration: '2030', category: '재테크' },
  { seed: '연금', targetGeneration: '4050', category: '재테크' },
  { seed: '퇴직금', targetGeneration: '4050', category: '재테크' },
  { seed: '은퇴 준비', targetGeneration: '4050', category: '라이프' },
  { seed: '암보험', targetGeneration: '4050', category: '건강' },
  { seed: '건강검진', targetGeneration: '4050', category: '건강' },
  { seed: '중년 재테크', targetGeneration: '4050', category: '재테크' },
  { seed: '은퇴', targetGeneration: '60s+', category: '라이프' },
  { seed: '국민연금', targetGeneration: '60s+', category: '재테크' },
  { seed: '기초연금', targetGeneration: '60s+', category: '재테크' },
  { seed: '건강식품', targetGeneration: '60s+', category: '건강' },
  { seed: '관절', targetGeneration: '60s+', category: '건강' },
  { seed: '혈압', targetGeneration: '60s+', category: '건강' },
  { seed: '실버타운', targetGeneration: '60s+', category: '라이프' },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DaumSuggestResponse {
  q?: string;
  items?: unknown;
  subkeys?: unknown;
  sub?: unknown;
}

const DAUM_SUGGEST_URLS = [
  (seed: string) =>
    `https://suggest-bar.daum.net/suggest?id=language&cate=ver&mod=json&code=utf_in_out&enc=utf&q=${encodeURIComponent(seed)}`,
  (seed: string) =>
    `https://suggest.search.daum.net/sushi/opensearch/pc?q=${encodeURIComponent(seed)}&DA=JU6`,
] as const;

function parseJsonp(text: string): DaumSuggestResponse | null {
  const match = text.match(/^[a-zA-Z_]\w*\(([\s\S]*)\)\s*;?\s*$/);
  if (!match?.[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1]) as DaumSuggestResponse;
  } catch {
    return null;
  }
}

function normalizeDaumItem(raw: string): string {
  const primary = raw.split('|')[0] ?? raw;
  return primary.replace(/<[^>]+>/g, '').trim();
}

function extractOpenSearch(payload: unknown): string[] {
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[1])) {
    return [];
  }

  const suggestions: string[] = [];
  for (const entry of payload[1]) {
    if (typeof entry === 'string' && entry.trim()) {
      suggestions.push(normalizeDaumItem(entry));
    }
  }
  return suggestions;
}

function extractSuggestions(payload: DaumSuggestResponse): string[] {
  const sources = [payload.items, payload.subkeys, payload.sub];
  const suggestions: string[] = [];

  for (const source of sources) {
    if (!Array.isArray(source)) {
      continue;
    }

    for (const entry of source) {
      if (typeof entry === 'string' && entry.trim()) {
        const keyword = normalizeDaumItem(entry);
        if (keyword) {
          suggestions.push(keyword);
        }
        continue;
      }

      if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].trim()) {
        const keyword = normalizeDaumItem(entry[0]);
        if (keyword) {
          suggestions.push(keyword);
        }
        continue;
      }

      if (entry && typeof entry === 'object' && 'keyword' in entry) {
        const keyword = (entry as { keyword?: unknown }).keyword;
        if (typeof keyword === 'string' && keyword.trim()) {
          suggestions.push(normalizeDaumItem(keyword));
        }
      }
    }
  }

  return [...new Set(suggestions)];
}

function parseDaumBody(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }

  try {
    if (trimmed.startsWith('[')) {
      return extractOpenSearch(JSON.parse(trimmed) as unknown);
    }

    let payload: DaumSuggestResponse | null = null;
    if (trimmed.startsWith('{')) {
      payload = JSON.parse(trimmed) as DaumSuggestResponse;
    } else {
      payload = parseJsonp(trimmed);
    }

    if (!payload) {
      throw new Error('unparseable payload');
    }

    const fromObject = extractSuggestions(payload);
    if (fromObject.length > 0) {
      return fromObject;
    }

    return extractOpenSearch(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Daum suggest JSON parse failed: ${message}`);
  }
}

async function fetchDaumSuggestions(seed: string): Promise<string[]> {
  const errors: string[] = [];

  for (const buildUrl of DAUM_SUGGEST_URLS) {
    const url = buildUrl(seed);
    try {
      const { status, body } = await httpsGetText(url, BROWSER_HEADERS, FETCH_TIMEOUT_MS);

      if (status < 200 || status >= 300) {
        errors.push(`${new URL(url).hostname} HTTP ${status}`);
        continue;
      }

      const suggestions = parseDaumBody(body).slice(0, MAX_SUGGESTIONS);
      if (suggestions.length > 0) {
        return suggestions;
      }

      errors.push(`${new URL(url).hostname} empty suggestions`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${new URL(url).hostname}: ${message}`);
    }
  }

  throw new Error(`Daum fetch failed (${seed}): ${errors.join(' | ')}`);
}

export async function collectDaumKeywords(): Promise<CollectedKeyword[]> {
  const collected: CollectedKeyword[] = [];

  for (const [index, seed] of DAUM_SEEDS.entries()) {
    try {
      const suggestions = await fetchDaumSuggestions(seed.seed);

      suggestions.forEach((keyword, rankIndex) => {
        collected.push({
          keyword,
          portal: 'daum',
          targetGeneration: seed.targetGeneration,
          category: seed.category,
          rank: rankIndex + 1,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[daum] seed="${seed.seed}" failed: ${message}`);
    }

    if (index < DAUM_SEEDS.length - 1) {
      await sleep(SEED_GAP_MS);
    }
  }

  return collected;
}
