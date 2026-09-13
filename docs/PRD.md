# PRODUCT REQUIREMENTS DOCUMENT (PRD)
# MULTI-PORTAL GENERATIONAL KEYWORD HARVESTER
### 포털 3사(네이버·다음·구글) 세대별 키워드 자동 수집 및 인텔리전스 시스템

---

* **VERSION:** v1.0
* **TARGET STACK:** TypeScript, Next.js / Vercel Serverless Functions, Supabase (PostgreSQL), Vercel Pro (Cron 300s), GitHub
* **STATUS:** Ready for Implementation

---

## 01 | 프로젝트 개요 (Overview)
* **목적:** 블로그 콘텐츠 기획 및 검색 유입 극대화를 위해 네이버, 다음, 구글의 세대별(10대~60대+) 검색 키워드 및 자동완성 데이터를 정기 수집하고, 기회 점수(Opportunity Score)를 산출하여 Supabase에 적재하는 자동화 파이프라인 구축.
* **배포 및 인프라 환경:**
  * **호스팅 & 스케줄러:** Vercel Pro (Serverless Functions `maxDuration: 300`, Vercel Cron)
  * **데이터베이스:** Supabase (PostgreSQL Table: `keywords_master`)
  * **형상 관리:** GitHub CI/CD 연동

---

## 02 | 기술 스택 및 라이브러리
* **런타임:** Node.js (TypeScript)
* **데이터베이스 클라이언트:** `@supabase/supabase-js`
* **HTTP 통신:** Native `fetch` (비동기 병렬 요청)
* **암호화/해싱:** Node.js 내장 `crypto` (MD5 해시 생성용)
* **스케줄러:** Vercel Cron (`vercel.json`)

---

## 03 | 데이터베이스 스키마 (`keywords_master`)

Supabase SQL Editor에서 실행할 DDL:

```sql
create table if not exists public.keywords_master (
    keyword_id text primary key,           -- md5(portal + '_' + keyword)
    keyword text not null,                 -- 정제된 검색어 키워드
    portal text not null,                  -- 'naver' | 'daum' | 'google'
    target_generation text not null,       -- '10s' | '2030' | '4050' | '60s+'
    category text default '일반',          -- 관심 카테고리 (IT, 재테크, 취미 등)
    monthly_vol integer default 0,         -- 월간 검색량 (추정치/API 수치)
    competition_idx text default 'MID',    -- 'LOW' | 'MID' | 'HIGH'
    opportunity_score numeric(5, 2),       -- 기회 점수 (0 ~ 100.0)
    collected_date date default current_date,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 빠른 조회를 위한 복합 인덱스
create index if not exists idx_keywords_gen_score 
on public.keywords_master (target_generation, opportunity_score desc);
```

---

## 04 | 데이터 소스 및 수집 전략

### 1. 네이버 (Naver)
* **엔드포인트:** `[https://ac.search.naver.com/nx/ac?q=](https://ac.search.naver.com/nx/ac?q=){SEED}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&t_koreng=1`
* **특징 및 수집 전략:** 국내 포털 중 검색 점유율 1위. DataLab 및 SearchAd API를 연계 확장할 수 있도록 인터페이스를 모듈화하며, 2030 직장·IT 트렌드 시드 키워드 위주로 자동완성을 수집한다.

### 2. 다음 (Daum / Kakao)
* **엔드포인트:** `[https://suggest-bar.daum.net/suggest?id=language&cate=ver&mod=json&code=utf_in_out&enc=utf&q=](https://suggest-bar.daum.net/suggest?id=language&cate=ver&mod=json&code=utf_in_out&enc=utf&q=){SEED}`
* **특징 및 수집 전략:** 40대~60대 중장년층 유입 비중이 높음. 연금, 은퇴, 재테크, 건강식품 등 시니어/중장년 관심 시드 검색어를 집중 배치하여 자동완성 롱테일 키워드를 확보한다.

### 3. 구글 (Google)
* **엔드포인트:** `[https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&q=](https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&q=){SEED}`
* **특징 및 수집 전략:** 개발, AI 도구, 글로벌 트렌드, 정보성 롱테일 키워드에 강점. 10대~30대 타깃의 신기술 및 생산성 시드 키워드를 중심으로 수집한다.

---

## 05 | 기회 점수(Opportunity Score) 산출 규칙

수집된 각 키워드는 검색량, 트렌드 증감률, 포털별 경쟁도를 기반으로 0 ~ 100점 사이의 점수를 계산하여 적재한다.

### 1. 기본 산출 공식
$$\text{Score} = \min\left(100, \; \ln(\text{monthly\_vol} + 1) \times 6 + (\text{TrendRate} \times 0.3) - \text{CompPenalty}\right)$$

### 2. 패널티 및 가중치 기준
* **경쟁도 패널티 (`CompPenalty`):**
  * `LOW`: -0점
  * `MID`: -10점
  * `HIGH`: -25점
* **기본값 보정 (Fallback):**
  * 월간 검색량 데이터가 없는 단순 자동완성 키워드의 경우, 자동완성 노출 순위(Rank 1~10)에 따라 $100 - (\text{Rank} \times 5)$ 형태로 초기 Opportunity Score를 부여한다.

---

## 06 | 아키텍처 및 디렉터리 구조

```text
├── api/
│   └── cron/
│       └── collect.ts          # Vercel Cron 수집 트리거 및 통합 파이프라인
├── lib/
│   ├── collectors/
│   │   ├── naver.ts            # 네이버 키워드 수집 모듈
│   │   ├── daum.ts             # 다음 키워드 수집 모듈
│   │   └── google.ts           # 구글 키워드 수집 모듈
│   ├── scorer.ts               # 텍스트 정제 및 기회 점수 계산 모듈
│   └── supabase.ts             # Supabase Service Role Client
├── types/
│   └── keyword.ts              # DB 및 키워드 데이터 인터페이스
├── vercel.json                 # Vercel Pro 설정 (maxDuration: 300, Cron 등록)
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 07 | 필수 환경 변수 (.env)

```env
# Supabase 환경 변수 (대시보드 Project Settings > API에서 확인)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Vercel Cron 보안 인증 토큰 (임의의 강력한 문자열)
CRON_SECRET=your-secure-cron-token
```