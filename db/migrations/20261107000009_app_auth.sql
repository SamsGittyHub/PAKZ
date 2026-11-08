-- Password auth for admin accounts (replaces Supabase Auth). Only service_role may call these;
-- password hashing and verification happen in the app, never in SQL.

create or replace function public.auth_find_user(p_email text)
returns table (id uuid, email text, encrypted_password text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email, u.encrypted_password from auth.users u where lower(u.email) = lower(trim(p_email));
$$;

create or replace function public.auth_create_user(p_email text, p_password_hash text, p_full_name text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  insert into auth.users (email, encrypted_password, raw_user_meta_data)
  values (lower(trim(p_email)), p_password_hash, jsonb_build_object('full_name', p_full_name))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.auth_set_password(p_user_id uuid, p_password_hash text)
returns void language sql security definer set search_path = public, auth as $$
  update auth.users set encrypted_password = p_password_hash where id = p_user_id;
$$;

create or replace function public.auth_touch_login(p_user_id uuid)
returns void language sql security definer set search_path = public, auth as $$
  update auth.users set last_sign_in_at = now() where id = p_user_id;
$$;

do $$
declare f text;
begin
  foreach f in array array['auth_find_user(text)', 'auth_create_user(text, text, text)', 'auth_set_password(uuid, text)', 'auth_touch_login(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
