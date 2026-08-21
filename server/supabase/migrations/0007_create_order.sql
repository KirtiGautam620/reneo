create or replace function create_order(
  p_items jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id  uuid := auth.uid();
  v_order_id     uuid;
  v_total        bigint := 0;
  v_currency     char(3);
  v_item         jsonb;
  v_pid          uuid;
  v_qty          integer;
  v_product      record;
  v_remaining    integer;
  v_hash         text;
  v_existing     record;
begin
  if v_customer_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from profiles
    where id = v_customer_id and role = 'CUSTOMER'
  ) then
    raise exception 'NOT_A_CUSTOMER' using errcode = 'P0002';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0003';
  end if;

  -- ---------- idempotency (B2) ----------
  v_hash := md5(p_items::text);

  if p_idempotency_key is not null then
    select * into v_existing
    from idempotency_keys
    where key = p_idempotency_key;

    if found then
      if v_existing.request_hash <> v_hash then
        raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0004';
      end if;
      return jsonb_build_object('order_id', v_existing.order_id, 'replayed', true);
    end if;
  end if;

  insert into orders (customer_id, total_minor, currency)
  values (v_customer_id, 0, 'XOF')
  returning id into v_order_id;

  -- ---------- items, LOCKED IN DETERMINISTIC ORDER ----------
  for v_item in
    select value from jsonb_array_elements(p_items)
    order by (value ->> 'product_id')
  loop
    v_pid := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0005';
    end if;

    -- server resolves price, seller, status. Client sends neither. (A5)
    select p.id, p.name, p.price_minor, p.currency, p.status, s.seller_id
    into v_product
    from products p
    join stores s on s.id = p.store_id
    where p.id = v_pid;

    if not found then
      raise exception 'PRODUCT_NOT_FOUND:%', v_pid using errcode = 'P0006';
    end if;

    if v_product.status <> 'ACTIVE' then
      raise exception 'PRODUCT_UNAVAILABLE:%', v_pid using errcode = 'P0007';
    end if;

    -- ***** THE ATOMIC DECREMENT *****
    update inventory
    set quantity = quantity - v_qty,
        updated_at = now()
    where product_id = v_pid
      and quantity  >= v_qty
    returning quantity into v_remaining;

    if not found then
      raise exception 'OUT_OF_STOCK:%', v_pid using errcode = 'P0008';
    end if;

    insert into order_items (
      order_id, product_id, seller_id, product_name, unit_price_minor, quantity
    ) values (
      v_order_id, v_pid, v_product.seller_id, v_product.name,
      v_product.price_minor, v_qty
    );

    v_total    := v_total + (v_product.price_minor * v_qty);
    v_currency := v_product.currency;
  end loop;

  update orders
  set total_minor = v_total,
      currency    = coalesce(v_currency, 'XOF')
  where id = v_order_id;

  -- ---------- outbox event (B3) ----------
  insert into events (type, payload)
  values ('ORDER_CREATED', jsonb_build_object(
    'order_id',    v_order_id,
    'customer_id', v_customer_id,
    'total_minor', v_total,
    'sellers',     (select jsonb_agg(distinct seller_id)
                    from order_items where order_id = v_order_id)
  ));

  if p_idempotency_key is not null then
    insert into idempotency_keys (key, customer_id, request_hash, order_id)
    values (p_idempotency_key, v_customer_id, v_hash, v_order_id);
  end if;

  return jsonb_build_object('order_id', v_order_id, 'total_minor', v_total, 'replayed', false);
end;
$$;

revoke all on function create_order(jsonb, text) from public;
grant execute on function create_order(jsonb, text) to authenticated;