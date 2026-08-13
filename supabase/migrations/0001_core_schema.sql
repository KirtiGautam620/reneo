-- Identity,stores,products,inventory

create extension if not exists "pgcrypto"; -- generate random uuid

-- enums
create type user_role as enum('SELLER','CUSTOMER');
create type product_status as enum('ACTIVE','ARCHIVED');

-- profiles
create table profiles(
    id uuid primary key references auth.users(id) on delete cascade,
    role user_role not null,
    full_name text not null check(length(trim(full_name))>0),
    created_at timestamptz not null default now()
);

-- stores
create table stores(
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null unique references profiles(id) on delete cascade,
    name text not null check(length(trim(name))>0),
    created_at timestamptz not null default now()
);

-- products
create table products(
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references stores(id) on delete cascade,
    name text not null check(length(trim(name))>0),
    description text,
    category text not null,
    price_minor bigint not null check(price_minor>=0),
    currency char(3) not null default 'XOF',
    status product_status not null default 'ACTIVE',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    search_vector tsvector generated always as(
        to_tsvector('simple',coalesce(name,'')||''||coalesce(description,''))
    ) stored
);

create index products_store_id_idx on products(store_id);

-- inventory
create table inventory(
    product_id uuid primary key references products(id) on delete cascade,
    quantity integer not null default 0 check(quantity>=0),
    updated_at timestamptz not null default now()
)