create policy inventory_insert_own on inventory
  for insert with check (
    exists (
      select 1 from products p
      where p.id = inventory.product_id
        and p.store_id = current_user_store_id()
    )
  );