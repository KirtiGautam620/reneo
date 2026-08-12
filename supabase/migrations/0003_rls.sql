-- rls
-- returns the rows owned by current user or null

create or replace function current_user_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select id from stores where seller_id=auth.uid();
$$;

alter table profiles         enable row level security;
alter table stores           enable row level security;
alter table products         enable row level security;
alter table inventory        enable row level security;
alter table orders           enable row level security;
alter table order_items      enable row level security;
alter table idempotency_keys enable row level security;
alter table events           enable row level security;

-- profiles
create policy profiles_select_own on profiles
    for select using(id=auth.uid());

create policy profiles_update_own on profiles
    for update using(id=auth.uid()) with check(id=auth.uid());

-- stores
create policy stores_select_own on stores
    for select using(seller_id=auth.uid());

create policy stores_insert_own on stores
    for insert with check(seller_id=auth.uid() 
    and exists(select 1 from profiles p where p.id=auth.uid() and p.role='SELLER'));

create policy stores_update_own on stores
  for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());

-- products

-- anyone signed in can browse active products
create policy products_select_active on products
    for select using(status='ACTIVE');

-- seller additionally see his own archived products
create policy products_select_own on products
    for select using(store_id=current_user_store_id());

create policy products_insert_own on products
    for insert with check(store_id=current_user_store_id());

create policy profiles_update_own on products
    for update
    using (store_id=current_user_store_id())
    with check(store_id=current_user_store_id());

create policy products_delete_own on products
    for delete using(store_id=current_user_store_id());

-- inventory
create policy inventory_select_all on inventory
    for select using(true);

create policy inventory_update_own on inventory
    for update 
    using(exists(
        select 1 from products p
        where p.id=inventory.product_id
        and p.store_id=current_user_store_id()
    ))
    with check(exists(
        select 1 from products p
        where p.id=inventory.product_id
        and p.store_id=current_user_store_id()
    ))
    ;

-- orders and order_items
create policy orders_select_own on orders
  for select using (customer_id=auth.uid());

-- a seller sees an order only if one of his lines is his
create policy orders_select_as_seller on orders
    for select using(
        exists(select 1 from order_items oi
        where oi.order_id=orders.id and oi.seller_id=auth.uid())
    );

create policy order_items_select_own on order_items
    for select using(
        exists(select 1 from orders o
        where o.id=order_items.order_id and o.customer_id=auth.uid())
    );

create policy order_items_select_as_seller on order_items
  for select using (seller_id = auth.uid());