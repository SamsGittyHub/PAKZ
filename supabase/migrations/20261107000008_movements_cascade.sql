-- inventory_movements stays append-only, except when its variant is being deleted (FK cascade from
-- deleting an unsold product/variant). Updates are always rejected.
create or replace function public.inventory_movements_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.product_variants where id = old.variant_id) then
    return old; -- parent variant already gone: cascade delete
  end if;
  raise exception 'inventory_movements is append-only';
end $$;
