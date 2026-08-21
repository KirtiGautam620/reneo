-- Restocking.
--
-- PATCH /products/{id} deliberately refuses `quantity`, because an absolute
-- write races a concurrent order: create_order's decrement could be read,
-- overwritten and lost. A *relative* adjustment has no such hazard — the read
-- and the write are one statement holding the row lock, so it composes with the
-- decrement rather than clobbering it.
--
-- supabase-js cannot express `quantity = quantity + n`, so this lives in SQL.

create or replace function adjust_inventory(
  p_product_id uuid,
  p_delta      integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := current_user_store_id();
  v_owned boolean;
  v_qty   integer;
begin
  if v_store is null then
    raise exception 'NOT_A_SELLER' using errcode = 'P0010';
  end if;

  if p_delta = 0 then
    raise exception 'INVALID_DELTA' using errcode = 'P0011';
  end if;

  select exists (
    select 1 from products p
    where p.id = p_product_id and p.store_id = v_store
  ) into v_owned;

  -- Same rule as PATCH: "not yours" and "does not exist" are indistinguishable,
  -- so that probing this endpoint cannot enumerate product ids.
  if not v_owned then
    raise exception 'FORBIDDEN' using errcode = 'P0013';
  end if;

  -- ***** THE ATOMIC RELATIVE ADJUSTMENT *****
  -- The guard is inside the same UPDATE, so a concurrent order that takes stock
  -- between the check and the write cannot drive the result negative.
  update inventory
  set quantity   = quantity + p_delta,
      updated_at = now()
  where product_id = p_product_id
    and quantity + p_delta >= 0
  returning quantity into v_qty;

  if not found then
    -- Either the row would go negative, or the product has no inventory row at
    -- all (POST /products is not atomic, so that gap is reachable).
    if exists (select 1 from inventory where product_id = p_product_id) then
      raise exception 'INSUFFICIENT_STOCK:%', p_product_id using errcode = 'P0012';
    end if;

    if p_delta < 0 then
      raise exception 'INSUFFICIENT_STOCK:%', p_product_id using errcode = 'P0012';
    end if;

    insert into inventory (product_id, quantity)
    values (p_product_id, p_delta)
    returning quantity into v_qty;
  end if;

  return jsonb_build_object('product_id', p_product_id, 'quantity', v_qty);
end;
$$;

revoke all on function adjust_inventory(uuid, integer) from public;
grant execute on function adjust_inventory(uuid, integer) to authenticated;
