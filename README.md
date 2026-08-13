# Reneo — Backend API

Backend for a multi-seller commerce platform. Node.js / TypeScript / Express / Supabase (PostgreSQL).

> **Status:** work in progress. See [Known limitations](#known-limitations) for an honest account of what is and isn't done.

---

## Setup

**Requirements:** Node.js 22+ (see note below), a Supabase project.

```bash
git clone <repo>
cd reneo-backend
npm install
cp .env.example .env
npm run dev
```

Apply the migrations in `supabase/migrations/` in numerical order via the Supabase SQL Editor (or `supabase db push`). They rebuild the database from scratch.

**Node version:** `@supabase/supabase-js` requires native `WebSocket`, available from Node 22. On Node 20 the server fails at boot. `engines` is set accordingly.

**Test users:** email confirmation is disabled in the Supabase project for local testing. In production it would be required.

---

## Architecture

```
Client
  │  JWT (Authorization: Bearer)
  ▼
Express
  ├─ authenticate      → verifies JWT, loads profile, builds a per-request
  │                      Supabase client carrying the caller's token
  ├─ requireRole       → defence in depth (RLS is the real control)
  ├─ zod .strict()     → rejects unknown keys, e.g. a client-supplied price
  └─ errorHandler      → single error shape for every response
  │
  ▼
PostgreSQL (Supabase)
  ├─ Row Level Security on every table — the actual authorization layer
  ├─ create_order()    — SECURITY DEFINER, one transaction, atomic stock
  └─ events            — transactional outbox
```

### The one architectural decision everything follows from

`supabase-js` has no transaction API. Every `.from().select()` is a separate HTTP request in its own transaction. Multi-step logic that must be atomic therefore **cannot** live in Node — it has to be a PostgreSQL function invoked via `rpc()`, whose body is an implicit transaction.

This is why `create_order` is written in plpgsql rather than TypeScript, and it is the reason the concurrency guarantee holds.

### Key/role model

| Key | Used for | RLS |
|---|---|---|
| publishable (`sb_publishable_…`) + caller JWT | every application request | **applies** |
| secret (`sb_secret_…`) | JWT verification, test fixtures, outbox worker | bypassed |

Application code never uses the secret key to read or write business data. `req.db` is built per request from the caller's token, so `auth.uid()` resolves correctly and RLS is in force by default rather than by remembering.

---

## Schema

`profiles · stores · products · inventory · orders · order_items · idempotency_keys · events`

### Money

Stored as `bigint` **minor units** with a separate `currency` column. Never floating point — `0.1 + 0.2 != 0.3` in binary floating point, and money that doesn't add up is disqualifying.

XOF (FCFA) is a zero-decimal currency, so one minor unit is one franc. Keeping minor units means the same column is correct whether the currency has 0 or 2 decimals; the currency code carries the exponent.

`numeric` would also be exact and is a defensible alternative. Integers were chosen because they cannot produce repeating decimals through accidental division.

### Where the seller lives

`orders` has **no** `seller_id`: one order spans several sellers, so there is no single correct value. The seller is per line item.

`order_items` stores `seller_id`, `unit_price_minor` and `product_name` as **snapshots** taken at purchase time. An order is an immutable financial record, not a live view of the catalogue — a seller renaming or repricing a product must not rewrite last month's invoices. It also makes the seller's RLS check a single-column comparison instead of a three-table join.

### Why `orders.total_minor` is stored, not summed on read

`SUM(order_items)` is what the lines add up to *now*; `orders.total_minor` is what the customer was **charged**. Those diverge the moment a refund, cancellation or correction touches the order. The total is computed inside the same transaction that creates the items — never by the client, never in a second round trip.

### Why inventory is a separate table

Stock and product data have opposite access patterns. Products are read constantly and written rarely; stock is written on every order.

More importantly for concurrency: locking a row to decrement stock blocks everyone else touching that row. If stock lived on `products`, two customers buying the last unit would lock the row that also holds name, description, price and the search vector — serialising the hottest read path behind the slowest write path. Split, the lock covers a tiny `(product_id, quantity)` row held for microseconds.

### Delete semantics

`products` is soft-deleted (`status = 'ARCHIVED'`). `order_items` references products, so a hard delete would either break foreign keys or destroy order history.

Cascade rules are deliberately asymmetric: `stores → products → inventory` cascade, but `orders.customer_id` and `order_items.product_id` do **not**. Financial records must not vanish because an account or a product was deleted; Postgres refuses the delete instead.

### Recorded assumptions

- **One store per seller**, enforced by `UNIQUE (stores.seller_id)`. Encoded as a constraint rather than an assumption in the code, and relaxable with a single `DROP CONSTRAINT`.
- Single currency per order (XOF).
- Text search uses the `simple` configuration, not `english` — Reneo serves francophone West Africa, and English stemming would be wrong for French product names.

---

## Security

RLS is enabled on **all eight tables**. Postgres denies by default, so anything without an explicit policy is blocked.

`current_user_store_id()` is `SECURITY DEFINER` with `SET search_path = public` — without the pinned search path a caller could redirect resolution to a malicious table.

`USING` controls which existing rows may be touched; `WITH CHECK` validates the row being written. Update policies specify both, otherwise a seller could move his own product into another seller's store.

### The test in the brief

Seller A signs in and attempts to modify Seller B's product:

```bash
curl -X PATCH "$SB_URL/rest/v1/products?id=eq.$PROD_B" \
  -H "apikey: $PUBLISHABLE" -H "Authorization: Bearer $TOKEN_A" \
  -d '{"price_minor":500}'
# → []   zero rows. Denial from the database, API not involved.
```

`orders` and `order_items` have **no INSERT policy at all**. Nobody can create an order through the table API — not even the customer who owns it. The only path is `create_order()`. There is therefore no route by which a client-supplied price could reach these tables.

`PATCH` on someone else's product returns **403, not 404**, for both "doesn't exist" and "not yours". The database deliberately doesn't distinguish them, and distinguishing them in the API would leak which product IDs exist.

---

## Concurrency (B1)

**Guarantee:** stock 1, two simultaneous orders — exactly one succeeds, the other receives `409 OUT_OF_STOCK`.

### What is atomic

The whole of `create_order()` — one plpgsql function, one implicit transaction. The decisive statement:

```sql
update inventory
set quantity = quantity - v_qty
where product_id = v_pid and quantity >= v_qty
returning quantity into v_remaining;

if not found then
  raise exception 'OUT_OF_STOCK:%', v_pid using errcode = 'P0008';
end if;
```

Lock acquisition, predicate evaluation and decrement happen as one indivisible operation.

### What happens to the second request while the first is in flight

1. T1 reaches the `UPDATE` and takes a row-level exclusive lock on that inventory row.
2. T2 reaches the same `UPDATE` and **blocks**, waiting on the lock.
3. T1 commits; `quantity` is now 0.
4. T2 unblocks and Postgres re-evaluates the `WHERE` against the **new** value: `0 >= 1` is false.
5. Zero rows match, `NOT FOUND` is true, the exception fires, the whole transaction rolls back — order row, items and event all disappear.

The read-modify-write race is eliminated because there is no gap between the check and the write: the check *is* the write.

`CHECK (quantity >= 0)` on the column is a database-level backstop that makes overselling structurally impossible even if the application logic is wrong.

### Deadlock avoidance

Items are locked in sorted `product_id` order. Without this, an order for [A, B] and a concurrent order for [B, A] would deadlock. A fixed global lock ordering makes that impossible.

### Approaches considered and rejected

| Approach | Why not |
|---|---|
| Application-level mutex | Dies with more than one server instance. Not a real guarantee. |
| Optimistic versioning (`version` column + retry) | Correct, but produces retry storms on hot items — exactly the last-unit case this test targets. |
| `SERIALIZABLE` isolation | Correct, but requires client-side retry on serialisation failure and costs more under normal load. Pessimistic row locking is the cheaper fit for a single hot row. |
| `SELECT … FOR UPDATE` then a separate `UPDATE` | Works, but the conditional `UPDATE` achieves the same in one statement with no window between the two. |

---

## Idempotency (B2)

`POST /orders` accepts an `Idempotency-Key` header.

- **Same key, same payload** → the original `order_id` is returned with `replayed: true` and HTTP 200. No second order.
- **Same key, different payload** → `409 IDEMPOTENCY_KEY_REUSED`. Detected by comparing a hash of the items array stored alongside the key; without the hash this case is undetectable.
- **Retention:** keys are kept for 24 hours. That covers client retries and network-level replays without growing the table indefinitely. No cleanup job is implemented — `idempotency_keys_created_at_idx` supports a `DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'` run as a scheduled job (pg_cron in production). This is a known gap.

The key is written inside the same transaction as the order, so a rolled-back order leaves no key behind.

---

## Events (B3)

Transactional outbox. `ORDER_CREATED` is inserted into `events` **inside the same transaction** as the order.

- The order and the event commit or roll back together — no phantom notifications, no lost events.
- A worker polls undelivered rows and delivers them, incrementing `attempts`.
- **If notification fails:** the order is never lost. The event stays undelivered and is retried with backoff; after repeated failures it remains visible for inspection rather than being dropped.

`events (created_at) WHERE delivered_at IS NULL` is a partial index — it contains only undelivered rows, so it stays small forever regardless of table size.

**Implementation.** A polling worker (`src/lib/outbox.ts`) runs every 5 seconds, claims up to 20 undelivered events ordered by `id`, and broadcasts on a per-seller Supabase Realtime channel. `attempts` is incremented on both success and failure, so a permanently failing event cannot block the queue — after 5 attempts it drops out of the worker's query and remains visible for inspection (dead letter).

**Limitations, deliberately not solved here:**
- Single-instance only. Two workers would claim the same rows and deliver duplicates. The fix is `FOR UPDATE SKIP LOCKED` inside a plpgsql claim function.
- Fixed 5-second interval, no exponential backoff. A production version would add a `next_attempt_at` column and space retries out.
- At-least-once delivery, not exactly-once. Consumers must be idempotent.

---

## Search and pagination (A4)

`GET /products` supports text search, category, min/max price, availability, sorting and cursor pagination.

### Keyset, not OFFSET

`OFFSET 100000` makes Postgres read 100,020 rows and discard 100,000 — queries get slower as users page deeper. Keyset pagination asks for "rows after this one", which is a direct index seek: **cost per page is constant** whether it's page 1 or page 50,000.

Trade-off: no jumping to an arbitrary page number, only next/previous. Correct for infinite scroll, wrong for numbered pagination. Every sort includes `id` as a tie-breaker, without which equal values would make the cursor skip or repeat rows.

### EXPLAIN

Seeded with 100,001 products.

**Filter + sort:**

```
TODO: paste the text-format EXPLAIN output here
```

Uses `products_created_at_id_idx`. Note `Rows Removed by Filter: 117` — the original index served only the ordering; category and price were residual filters. That is cheap for a common category but degrades badly for a selective one, where Postgres would scan far into the table to find 20 matches. `(category, created_at DESC, id DESC)` moves the filter inside the index (leftmost prefix rule).

Trade-off: each filter+sort combination wants its own index, which costs writes, storage and planning time. In production the choice would be driven by query logs rather than by indexing every combination.

**Full-text search:**

```
TODO: paste the text-format EXPLAIN output here
```

On a non-selective term the planner correctly chooses a sequential scan — the seed corpus contains the search terms in nearly every row, so with `LIMIT 20` reading the first heap blocks beats an index lookup. On a selective term the GIN index is used: `Bitmap Index Scan on products_search_idx`, 3 rows from 100,001, ~1.4 ms, 6 blocks touched. Both plans are correct; the planner is cost-based, not index-obsessed.

`search_vector` is a **generated stored column**, so Postgres maintains it automatically — no trigger to keep in sync.

Observed `Planning Time` exceeded `Execution Time` on the fast queries: with six indexes the planner has more candidates to evaluate. Another argument for indexing what the logs justify rather than everything.

---

## Error handling (A7)

Every error has the same shape:

```json
{ "error": { "code": "OUT_OF_STOCK", "message": "…", "details": null } }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | zod failure, including unknown keys |
| 401 | `UNAUTHENTICATED` | missing/invalid/expired JWT |
| 403 | `FORBIDDEN` / `NOT_A_CUSTOMER` | not yours, or wrong role |
| 404 | `NOT_FOUND` | product does not exist |
| 409 | `OUT_OF_STOCK` / `IDEMPOTENCY_KEY_REUSED` / `CONFLICT` | stock, key reuse, duplicate store |
| 500 | `INTERNAL_ERROR` | unexpected; details logged, never returned |

Clients branch on `code`, never on message text. Postgres error codes raised by `create_order` are mapped to HTTP statuses at the route boundary — `23505` (unique violation) becomes 409 rather than 500.

---

## API documentation

_TODO: OpenAPI spec or Postman collection, and where to find it._

---

## Tests

```bash
npm test
```

_TODO: fill in once written._

| # | Scenario | Expected |
|---|---|---|
| 1 | Seller A creates a product | 201 |
| 2 | Seller B attempts to modify it | 403 |
| 3 | Customer orders an available product | 201 |
| 4 | Customer orders more than stock | 409 |
| 5 | N simultaneous orders for the last item | exactly one 201 |

Test 5 fires requests with `Promise.all` so they actually race; sequential `await`s would not test concurrency at all.

---

## Known limitations

- **`POST /products` is not atomic.** The product row and its inventory row are two separate round trips. If the second fails, a product exists with no inventory. The fix is the same one used for orders — move it into a plpgsql function. _TODO: state whether you fixed it or left it._
- _TODO: add the rest as you find them. This section is worth more filled in honestly than left empty._

---

## Part D — written answers

### D1. Scaling to 10M users

_TODO. Include a diagram. Cover: what breaks first and how you'd know, the database, caching, queues, workers, storage, monitoring — and explicitly what you would **not** do yet, and why._

Points worth making, once you've thought them through yourself:
- Random UUID primary keys hurt B-tree insert locality at scale; UUIDv7 is the ordered alternative.
- Reads scale with replicas long before writes need sharding.
- The outbox already gives a clean seam for moving notification delivery to a queue.
- What you measure to know something is breaking: p99 latency, lock wait time, replication lag, outbox depth.

### D2. What I did not have time to do

_TODO._

### D3. Where I used a library or an AI assistant for something I could not have written myself

_TODO. The brief says an honest answer costs nothing — be specific about what you didn't know, and what you understood afterwards._

---

## Deliverables checklist

- [x] GitHub repository with real commit history
- [ ] README with architecture, setup, choices, limitations, Part D
- [x] SQL migrations that rebuild the database from scratch
- [x] RLS policies in the repository
- [ ] API documentation (OpenAPI or Postman)
- [ ] Automated tests with a documented command
- [x] `.env.example`, no real secrets anywhere including Git history
- [ ] 3–5 minute video including the concurrency test running