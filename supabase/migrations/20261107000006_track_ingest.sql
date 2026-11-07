-- Atomic ingestion for /api/track: upsert the session (first-touch attribution is never overwritten),
-- insert the batch, update counters, and apply behavioural bot filtering.

create or replace function public.track_ingest(p_session jsonb, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id text := p_session ->> 'id';
  v_visitor text := nullif(p_session ->> 'visitor_id', '');
  v_sess public.sessions;
  v_n int;
  v_pv int;
begin
  if v_id is null or length(v_id) > 64 then raise exception 'invalid session id'; end if;

  insert into public.sessions as s (id, visitor_id, user_id, landing_page, referrer, source, medium, campaign,
                                    device, country, consent, is_returning)
  values (v_id, v_visitor, nullif(p_session ->> 'user_id', '')::uuid,
          left(p_session ->> 'landing_page', 500), left(p_session ->> 'referrer', 200),
          coalesce(p_session ->> 'source', 'direct'), p_session ->> 'medium', left(p_session ->> 'campaign', 200),
          p_session ->> 'device', p_session ->> 'country', coalesce((p_session ->> 'consent')::boolean, false),
          v_visitor is not null and exists (select 1 from public.sessions where visitor_id = v_visitor))
  on conflict (id) do update
    set last_seen = now(),
        user_id = coalesce(s.user_id, excluded.user_id)
  returning * into v_sess;

  if v_sess.is_bot then
    return jsonb_build_object('accepted', 0, 'bot', true);
  end if;

  insert into public.events (session_id, user_id, event_type, product_id, variant_id, category, brand, value, query,
                             props, path, referrer, utm_source, utm_medium, utm_campaign, device, country, created_at)
  select v_id, v_sess.user_id, e.type, e.product_id, e.variant_id, left(e.category, 100), left(e.brand, 100), e.value,
         lower(left(trim(e.query), 120)), e.props, left(e.path, 500), v_sess.referrer,
         case when v_sess.source <> 'direct' then v_sess.source end, v_sess.medium, v_sess.campaign,
         v_sess.device, v_sess.country,
         now() - make_interval(secs => least(greatest(coalesce(e.age_ms, 0), 0), 600000) / 1000.0)
  from jsonb_to_recordset(p_events) as e(type text, product_id uuid, variant_id uuid, category text, brand text,
                                          value numeric, query text, props jsonb, path text, age_ms numeric)
  where e.type in ('page_view', 'product_view', 'search', 'filter_used', 'add_to_cart', 'remove_from_cart',
                   'checkout_started', 'waitlist_signup', 'offer_made', 'engagement');
  get diagnostics v_n = row_count;

  -- Client batches never carry purchases; those come from the Stripe webhook via track_purchase().
  select count(*) filter (where e ->> 'type' = 'page_view') into v_pv
  from jsonb_array_elements(p_events) e;

  update public.sessions
     set page_views = page_views + v_pv,
         events_count = events_count + v_n,
         last_seen = now(),
         -- Behavioural filter: absurd volume, or 20+ page views faster than one every 1.5s.
         is_bot = events_count + v_n > 1000
               or page_views + v_pv > 300
               or (page_views + v_pv >= 20 and extract(epoch from (now() - first_seen)) < (page_views + v_pv) * 1.5)
   where id = v_id
  returning * into v_sess;

  -- A session flagged as bot drops out of every report (they all filter not is_bot); purge its events too.
  if v_sess.is_bot then
    delete from public.events where session_id = v_id;
  end if;

  return jsonb_build_object('accepted', v_n, 'bot', v_sess.is_bot);
end $$;

-- Server-side purchase events (Stripe webhook): one event per line, and mark the session converted.
create or replace function public.track_purchase(p_session_id text, p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_session_id is null or not exists (select 1 from public.sessions where id = p_session_id) then
    return;
  end if;
  insert into public.events (session_id, event_type, product_id, variant_id, category, brand, value, props,
                             utm_source, utm_medium, utm_campaign, device, country)
  select p_session_id, 'purchase', oi.product_id, oi.variant_id, c.name, b.name, oi.quantity * oi.unit_price,
         jsonb_build_object('order_id', p_order_id), case when s.source <> 'direct' then s.source end, s.medium, s.campaign, s.device, s.country
  from public.order_items oi
  join public.sessions s on s.id = p_session_id
  left join public.products p on p.id = oi.product_id
  left join public.categories c on c.id = p.category_id
  left join public.brands b on b.id = p.brand_id
  where oi.order_id = p_order_id;
  update public.sessions set converted = true, last_seen = now() where id = p_session_id;
end $$;

revoke execute on function public.track_ingest(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.track_purchase(text, uuid) from public, anon, authenticated;
grant execute on function public.track_ingest(jsonb, jsonb) to service_role;
grant execute on function public.track_purchase(text, uuid) to service_role;
