-- Fix: "infinite recursion detected in policy for relation order_items".
--
-- GET /orders selects orders with their line items embedded. That touches both
-- tables, and the two SELECT policies referenced each other:
--
--   orders_select_as_seller   reads order_items  (does this order contain my line?)
--   order_items_select_own    reads orders       (is this order mine?)
--
-- Each policy's subquery is itself subject to the other table's policies, so the
-- pair cycles and Postgres aborts with 42P17. The effect was that GET /orders
-- returned 500 for every caller, even with no orders in the table.
--
-- The remedy is the pattern already used by current_user_store_id(): move each
-- lookup into a SECURITY DEFINER function. The function body runs as the owner
-- with RLS bypassed, so the cycle is broken. Both helpers return only a boolean
-- derived from auth.uid(), so nothing is exposed that the policy did not already
-- decide.

create or replace function order_belongs_to_customer(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from orders o
    where o.id = p_order_id and o.customer_id = auth.uid()
  );
$$;

create or replace function order_has_item_from_seller(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from order_items oi
    where oi.order_id = p_order_id and oi.seller_id = auth.uid()
  );
$$;

revoke all on function order_belongs_to_customer(uuid)   from public;
revoke all on function order_has_item_from_seller(uuid)  from public;
grant execute on function order_belongs_to_customer(uuid)  to authenticated;
grant execute on function order_has_item_from_seller(uuid) to authenticated;

-- Same visibility rules as before, expressed without the cycle.
drop policy if exists orders_select_as_seller on orders;
create policy orders_select_as_seller on orders
  for select using (order_has_item_from_seller(orders.id));

drop policy if exists order_items_select_own on order_items;
create policy order_items_select_own on order_items
  for select using (order_belongs_to_customer(order_items.order_id));
