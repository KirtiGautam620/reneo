-- orders,order items,idempotency,outbox events

create type order_status as enum('PENDING','CONFIRMED','CANCELLED');

-- orders
create table orders(
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references profiles(id),
    status order_status not null default 'CONFIRMED',
    total_minor bigint not null check(total_minor>=0),
    currency char(3) not null default 'XOF',
    created_at   timestamptz  not null default now()
);
create index orders_customer_id_created_at_idx
  on orders (customer_id, created_at desc);

-- order_items
create table order_items(
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id) on delete cascade,
    product_id uuid not null references products(id),
    seller_id uuid not null references profiles(id),
    product_name text not null,
    unit_price_minor bigint not null check(unit_price_minor>=0),
    quantity integer not null check(quantity>0),
    subtotal_minor bigint not null
    generated always as(unit_price_minor*quantity) stored,
    constraint order_items_unique_product_per_order unique(order_id,product_id)
);
create index order_items_order_id_idx  on order_items (order_id);
create index order_items_seller_id_idx on order_items (seller_id);

-- idempotency
create table idempotency_keys(
    key text primary key,
    customer_id uuid not null references profiles(id) on delete cascade,
    request_hash text not null,
    order_id uuid references orders(id) on delete set null,
    created_at    timestamptz not null default now()
);

create index idempotency_keys_created_at_idx on idempotency_keys (created_at);

-- outbox events
create table events(
    id bigserial primary key,
    type text not null,
    payload jsonb not null,
    delivered_at  timestamptz,
    attempts integer not null default 0,
    created_at    timestamptz not null default now()
);
create index events_undelivered_idx
  on events (created_at) where delivered_at is null;