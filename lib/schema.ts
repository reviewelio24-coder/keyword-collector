/** PRD `keywords_master` DDL (테이블 + 복합 인덱스) */
export const KEYWORDS_MASTER_TABLE_SQL = `
create table if not exists public.keywords_master (
    keyword_id text primary key,
    keyword text not null,
    portal text not null,
    target_generation text not null,
    category text default '일반',
    monthly_vol integer default 0,
    competition_idx text default 'MID',
    opportunity_score numeric(5, 2),
    collected_date date default current_date,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
)
`.trim();

export const KEYWORDS_MASTER_INDEX_SQL = `
create index if not exists idx_keywords_gen_score
on public.keywords_master (target_generation, opportunity_score desc)
`.trim();

export const KEYWORDS_MASTER_DDL = `${KEYWORDS_MASTER_TABLE_SQL};\n\n${KEYWORDS_MASTER_INDEX_SQL};`;
