-- Platform objects the schema relies on (roles, auth schema), created here so it runs on plain
-- Postgres (Railway). PostgREST connects as `authenticator` and switches to `service_role` for the
-- app's server-side requests; `anon` / `authenticated` exist for RLS policies.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;

-- Admin accounts. Passwords are scrypt hashes produced by the app (src/lib/password.ts).
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique,
  encrypted_password  text,
  raw_user_meta_data  jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  last_sign_in_at     timestamptz
);

-- Requests from the app run as service_role (no user claim); policies only use this for direct reads.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    current_setting('request.jwt.claim.sub', true)
  ), '')::uuid;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Everything later migrations create in public is usable by service_role (RLS is bypassed for it).
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
