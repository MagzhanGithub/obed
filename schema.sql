-- Выполнить один раз в Supabase → SQL Editor
create table if not exists kv (
  col  text not null,            -- 'menu' | 'orders' | 'settings'
  id   text not null,
  data jsonb not null default '{}'::jsonb,
  primary key (col, id)
);
alter table kv enable row level security;   -- без политик: доступ только через сервер
create index if not exists kv_date on kv ((data->>'date'));
