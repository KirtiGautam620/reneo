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

### D1. Scaling to 10 million users

#### Where it stands today

One Express instance, one Supabase Postgres instance, one polling outbox worker. Order creation is a single `SECURITY DEFINER` plpgsql function, so correctness under concurrency does not depend on how many API instances are running — the guarantee lives in the database.

Three measurements from the current build inform everything below:

- On a 100k-row table, `Planning Time` (11 ms) exceeded `Execution Time` (0.09 ms) on a fast query. Six indexes on `products` give the planner more candidates to evaluate. Indexes are not free.
- The original ordering index left `Rows Removed by Filter: 117` — it served the sort, not the filter. That is cheap for a common category and expensive for a selective one.
- Test 5 fires ten concurrent orders for one unit of stock; exactly one succeeds. The other nine block on the same inventory row and are then correctly rejected.

That third number is the one that scales badly, and it is where the first failure comes from.

#### What breaks first

Not the API servers, and not read throughput. **Lock contention on a hot product**, which then cascades:

```
one popular product, many simultaneous buyers
        ↓
all transactions queue on the same inventory row
        ↓
transactions stay open longer
        ↓
each open transaction holds a database connection
        ↓
connection pool exhausted
        ↓
the entire API degrades — including requests
that have nothing to do with that product
```

This is the important part: the blast radius is not limited to the contended product. A single hot item can take down unrelated endpoints, because connections are a shared, finite resource. Everything else on this page fails more gracefully.

#### How I would know

| Symptom | Metric that moves first |
|---|---|
| API slow | p99 request latency (p50 hides the worst requests) |
| Database overloaded | CPU %, active connection count |
| Queries slow | `pg_stat_statements`, ranked by total time |
| Hot-product contention | lock wait time in `pg_locks`; p99 on `POST /orders` specifically |
| Transactions open too long | age of the oldest transaction in `pg_stat_activity` |
| Connection pool saturated | pool wait time and queue depth |
| Replica behind | replication lag in seconds |
| Outbox falling behind | count and age of undelivered events |

The last one is a single query against the schema as it already exists:

```sql
select count(*), min(created_at)
from events
where delivered_at is null;
```

A rising count means delivery is slower than order creation. A rising `min(created_at)` means something is stuck rather than merely slow — a different problem with a different fix.

#### How the architecture evolves

**Read replicas.** Product browsing, search and listings move to replicas — that is the bulk of traffic and it tolerates being slightly stale.

Two reads stay on the primary, and the reasons differ:

1. **Any read that a write depends on.** The stock check inside `create_order` must see committed truth. Reading stock from a replica would reintroduce exactly the read-modify-write race the function exists to eliminate.
2. **A user's reads immediately after their own writes.** A seller who creates a product and then opens their product list would not see it if the replica is 200 ms behind, and would reasonably assume the create failed and do it again. This is *read-your-own-writes* consistency; the fix is to pin that user's reads to the primary for a few seconds after a write.

**Caching (Redis).** Product detail and search results, which are read constantly and change rarely.

Caching deliberately does **not** touch stock. A cached stock value cannot replace the transaction as the source of truth: two requests would read the same cached quantity, both pass the availability check, and both decrement — the same race as before, relocated from Postgres into Redis. Redis also cannot insert `order_items` inside the same transaction, so atomicity is lost regardless.

This is where the existing design already pays off: `create_order` resolves price from the products table inside the transaction, so a stale cached price can never become the price a customer is charged. The cache is a display layer only.

**Hot products.** Since caching does not help, the contention has to be addressed directly. Serialisation on that row is the price of correctness, not a bug. Two options:

- *Stock buckets* — split one product's inventory across N rows; each order takes a random bucket, cutting contention roughly N-fold. Cost: "total stock" is no longer a single-row read, and the last unit may appear unavailable while it sits in a bucket the request did not pick.
- *Queue the hot product's orders* — serialise them outside the request path, returning "order received" immediately and confirming asynchronously. Cost: order confirmation stops being synchronous, which is a product decision, not just a technical one.

I would choose buckets. Queueing changes what an order *means* to the customer; bucketing keeps the guarantee and the semantics intact and only trades away exact stock visibility.

**Workers and queues.** The transactional outbox is already in place, so this is a scaling change rather than a redesign: replace the single polling worker with several claiming batches via `FOR UPDATE SKIP LOCKED`, and add exponential backoff through a `next_attempt_at` column. The order path itself does not change — notification work must stay outside the transaction, because every millisecond a transaction stays open is a millisecond the lock is held.

**Partitioning.** `orders` and `events` grow without bound and are almost always queried by recent date. Range partitioning by month keeps indexes small and makes archival a detach rather than a mass delete.

**Storage and monitoring.** Product images to object storage with a CDN, never the database. Metrics, structured logs and tracing on `POST /orders` in particular, since that is the path with the lock.

#### What I would not do yet

**Sharding.** A single well-indexed Postgres instance handles tens of millions of rows. Sharding multiplies operational cost — cross-shard joins, distributed transactions, rebalancing, and a much harder failure story. Indexing, pooling, replicas and partitioning come first.

There is also a schema-specific objection. `seller_id` looks like the obvious shard key for a marketplace, but **an order deliberately spans multiple sellers** — that is why `orders` has no `seller_id` and the seller lives on `order_items`. Sharding by seller would turn ordinary multi-seller orders into distributed transactions, which is a worse problem than the one being solved. Sharding by customer keeps orders intact but scatters a seller's own catalogue. Neither is obviously right, which is itself a reason to defer the decision until real query patterns exist.

**Microservices.** The bottleneck is a database row, and splitting the application into services does not move that row. It would add network hops to a path that currently has none.

**Indexing every filter combination.** Each index costs writes, storage and planning time — already visible at 100k rows. Which indexes to add should come from query logs, not from anticipating every combination.

**Replacing Postgres for search.** Elasticsearch is the eventual answer for large-scale relevance ranking, but GIN full-text search returned matches from 100k rows in 1.4 ms. Adding a second datastore means keeping it in sync, which is a real source of bugs. Not yet.

#### Target architecture

```
                        Client
                          │
                    ┌─────┴─────┐
                    │    API    │  (horizontally scaled, stateless)
                    └─────┬─────┘
          ┌───────────────┼───────────────┐
          │               │               │
      writes +      read-heavy       hot product
   consistency-       queries          reads
    critical reads       │               │
          │              ▼               ▼
          │        Read replicas    Redis cache
          │        (browse, search)  (display only,
          │                           never stock)
          ▼
   Postgres primary
   ├─ create_order()  — atomic stock, one transaction
   └─ events          — transactional outbox
          │
          ▼
    Outbox workers  (FOR UPDATE SKIP LOCKED, backoff)
          │
          ▼
     Notifications
```

Routing rules: writes and consistency-critical reads to the primary; read-heavy browsing to replicas, with a user pinned to the primary briefly after their own writes; frequently-read product data cached, stock never cached; order events through the outbox to workers.

### D2. What I did not have time to do

_TODO._

### D3. Where I used a library or an AI assistant for something I could not have written myself

_TODO. The brief says an honest answer costs nothing — be specific about what you didn't know, and what you understood afterwards._

---