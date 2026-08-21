create index products_search_idx on products using gin (search_vector);

create index products_category_price_idx
  on products (category, price_minor)
  where status = 'ACTIVE';

create index products_created_at_id_idx
  on products (created_at desc, id desc)
  where status = 'ACTIVE';

create index products_price_idx
  on products (price_minor, id)
  where status = 'ACTIVE';