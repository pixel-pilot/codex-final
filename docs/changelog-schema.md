# Supabase `app_updates` Table Schema

```sql
create table if not exists app_updates (
  id uuid primary key,
  timestamp timestamptz not null default now(),
  title text not null,
  description text not null,
  category text not null check (category in ('Feature','Fix','Improvement','UI','System','Note')),
  version text,
  author text,
  fts tsvector generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
  ) stored
);

create index if not exists app_updates_timestamp_idx on app_updates (timestamp desc);
create index if not exists app_updates_category_idx on app_updates (category);
create index if not exists app_updates_fts_idx on app_updates using gin (fts);
```

This schema supports chronological queries, category filtering, and full-text search over titles and descriptions.
