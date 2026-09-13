export type Portal = 'naver' | 'daum' | 'google';

/** 타깃 세대 (5그룹). 구버전 `4050`은 API에서 40s+50s 하위 호환 */
export type GenerationType = '10s' | '2030' | '40s' | '50s' | '60s+';
export type TargetGeneration = GenerationType;

export type CompetitionIdx = 'LOW' | 'MID' | 'HIGH';

/** 시드 키워드와 세대·카테고리 메타데이터 */
export interface SeedKeyword {
  seed: string;
  targetGeneration: TargetGeneration;
  category: string;
}

/** 포털 자동완성에서 수집된 원천 키워드 (적재 전) */
export interface CollectedKeyword {
  keyword: string;
  portal: Portal;
  targetGeneration: TargetGeneration;
  category: string;
  /** 자동완성 노출 순위 (1~10) */
  rank: number;
  monthlyVol?: number;
  competitionIdx?: CompetitionIdx;
  /** 트렌드 증감률 (%). 미확보 시 0 */
  trendRate?: number;
}

/** `keywords_master` 테이블 행 */
export interface KeywordMaster {
  keyword_id: string;
  keyword: string;
  portal: Portal;
  target_generation: TargetGeneration;
  category: string;
  monthly_vol: number;
  competition_idx: CompetitionIdx;
  opportunity_score: number;
  collected_date: string;
  created_at?: string;
}
