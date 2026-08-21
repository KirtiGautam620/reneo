# Reneo

A multi-seller commerce platform. Customers browse one marketplace and buy from
several independent sellers in a single order; sellers run their own store,
catalogue and stock.

Two halves in one repository:

| | | |
|---|---|---|
| [`server/`](server/) | Express + TypeScript + Supabase (PostgreSQL) | the API and the database |
| [`client/`](client/) | Next.js App Router + React Query + CSS Modules | the storefront and seller console |
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 | the contract between them, and the source of truth |

> **Status:** working end to end locally — signup, browse, cart, checkout,
> order history, seller onboarding, catalogue management and incoming orders
> have all been exercised against the real API in a browser. It is not
> production-ready. [Not implemented](#not-implemented) is an honest list of
> what is missing.

---

## Architecture

```
Browser
  │
  │  ① Supabase Auth (sign-in/up, session, one profiles read)
  │     └────────────────────────────────────────────► Supabase Auth
  │
  │  ② everything else — products, orders, stores, inventory
  │     Authorization: Bearer <user JWT>
  ▼
Express  (server/)
  ├─ authenticate      → verifies the JWT, loads the profile, builds a
  │                      per-request Supabase client carrying the caller's token
  ├─ requireRole       → defence in depth (RLS is the real control)
  ├─ zod .strict()     → rejects unknown keys, e.g. a client-supplied price
  └─ errorHandler      → one error shape for every response
  │
  ▼
PostgreSQL (Supabase)
  ├─ Row Level Security on every table — the actual authorization layer
  ├─ create_order()      SECURITY DEFINER, one transaction, atomic stock
  ├─ adjust_inventory()  SECURITY DEFINER, relative restock
  └─ events              transactional outbox
```

The security boundary is **the database, not the API**. Express does not decide
who may see what; it forwards the caller's JWT to PostgreSQL, and RLS policies
evaluate `auth.uid()` against every row. If the API layer had a bug that
dropped a `WHERE` clause, the database would still refuse.

### The one architectural decision everything follows from

`supabase-js` has no transaction API. Every `.from().select()` is a separate
HTTP request in its own transaction. Multi-step logic that must be atomic
therefore **cannot** live in Node — it has to be a PostgreSQL function invoked
via `rpc()`, whose body is an implicit transaction.

This is why `create_order` is written in plpgsql rather than TypeScript, and it
is the reason the concurrency guarantee holds.

### Key/role model

| Key | Used for | RLS |
|---|---|---|
| publishable (`sb_publishable_…`) + caller JWT | every application request | **applies** |
| secret (`sb_secret_…`) | JWT verification, test fixtures, outbox worker | bypassed |

Application code never uses the secret key to read or write business data.
`req.db` is built per request from the caller's token, so `auth.uid()` resolves
correctly and RLS is in force by default rather than by remembering.

**The secret key exists only in `server/`.** It is never sent to the browser,
and `client/` has no variable that could carry it — see
[Environment variables](#environment-variables).

---

## Why the frontend does not query Supabase directly

`@supabase/supabase-js` is in the client, and it would be entirely possible to
call `supabase.from('products').select()` from a React component. The project
deliberately does not, with one narrow exception.

**The only permitted direct Supabase use in the browser is authentication** —
sign-in, sign-up, session handling — **plus a single `profiles` read** in
[`use-session.ts`](client/src/hooks/use-session.ts) to learn the caller's role.
Everything else goes through [`api-client.ts`](client/src/lib/api-client.ts) to
Express.

The reasons, in order of weight:

1. **Server-owned pricing.** `POST /orders` accepts only product IDs and
   quantities. Price, seller and availability are resolved server-side inside
   the order transaction. If the browser could write to the tables, the price
   would become a client input — and a client input is an attacker input.
   `orders` and `order_items` have **no INSERT policy at all**: not even the
   customer who owns the order can create one through the table API. The only
   path is `create_order()`.

2. **Atomicity.** Reserving stock, pricing lines, writing the order and emitting
   the outbox event must happen in one transaction. PostgREST cannot express
   that, so it has to be one RPC — and once it is an RPC, having half the app
   speak to tables and half to functions is a needless second data path.

3. **One contract.** `openapi.yaml` describes what the frontend may rely on.
   Reading tables directly would couple React components to the physical schema,
   so a column rename becomes a frontend outage.

4. **Validation.** `zod .strict()` rejects unknown keys at the boundary. A
   payload containing a price is a 400, not a silently ignored field.

RLS is still the backstop, not the plan: even if this rule were violated, the
database would refuse to serve another seller's rows.

---

## Concurrent stock reservation

**Guarantee:** stock 1, two simultaneous orders — exactly one succeeds, the
other receives `409 OUT_OF_STOCK`.

The mechanism is described in full under [Concurrency](#concurrency-b1) below.
In short: a conditional decrement (`UPDATE … WHERE quantity >= requested`)
performs lock acquisition, predicate evaluation and write as one indivisible
operation, so there is no gap between the check and the write — the check *is*
the write.

### How the UI surfaces a conflict

This is the moment the database's guarantee becomes visible to a person, so the
frontend treats it as a first-class path rather than a generic failure.

- The client branches on `error.code`, **never on message text**
  ([`checkout-errors.ts`](client/src/lib/checkout-errors.ts)). The API contract
  guarantees the code; the prose is not stable.
- `OUT_OF_STOCK` and `PRODUCT_UNAVAILABLE` carry the failing `product_id` in
  `error.details`, so the cart can **name the item** without parsing a string.
- On conflict the cart invalidates every product query, because the stock
  numbers on screen have just been proven stale. The offending line re-renders
  with the real remaining quantity and a "Only N left" warning, and is
  highlighted.
- The message says plainly that **nothing was charged and no order was
  created** — true, because the whole plpgsql function rolls back.
- Checkout is blocked until the quantity is lowered or the line removed. The
  error is not dismissible into a retry loop that would fail identically.

---

## Idempotency on order creation

`POST /orders` accepts an `Idempotency-Key` header. The server side is
described under [Idempotency](#idempotency-b2).

**What the client does with it** matters as much as the header itself
([`use-checkout.ts`](client/src/hooks/use-checkout.ts)):

- A key is generated with `crypto.randomUUID()` **once per checkout attempt**
  and held stable across retries of that attempt. A fresh key per retry would
  defeat the entire mechanism — every retry would create another order.
- The key alone is not sufficient. The server matches a replay on a hash of the
  `items` array *as well as* the key, so a retry must resend a **byte-identical
  payload**. The client therefore pins the key to the exact payload it was
  issued for, and sorts items by `product_id` before serialising so that two
  submissions of the same cart are identical regardless of the order things
  were added in.
- If the cart changes, the attempt is abandoned and a new key issued — reusing
  the old one against a changed payload is a `409 IDEMPOTENCY_KEY_REUSED` by
  design.
- A lost response is therefore safe to retry: the same key and payload replay
  the original order rather than placing a second one.

---

## Transactional outbox

`ORDER_CREATED` is written to `events` inside the same transaction as the
order, so the two commit or roll back together. Detail under
[Events](#events-b3).

**The UI does not surface event status.** Nothing in `openapi.yaml` exposes it:
`Order` carries no event field, there is no events endpoint, and RLS is enabled
on `events` with no policies at all — so no authenticated user can read a row,
only the service-role worker. Showing a "pending → processed" indicator would
have meant inventing an endpoint, so it was left out rather than faked. See
[Not implemented](#not-implemented).

---

## Local setup

**Requirements:** Node.js 22+, a Supabase project.

`@supabase/supabase-js` requires native `WebSocket`, available from Node 22. On
Node 20 the server fails at boot.

### 1. Database

Apply everything in [`server/supabase/migrations/`](server/supabase/migrations/)
in numerical order (`0001` … `0009`) via the Supabase SQL Editor, or
`supabase db push`. They rebuild the database from scratch.

Email confirmation is disabled in the Supabase project for local testing. In
production it would be required.

### 2. API — `server/`

```bash
cd server
npm install
cp .env.example .env      # fill in the Supabase URL and keys
npm run dev               # listens on PORT, default 4000
```

### 3. Frontend — `client/`

```bash
cd client
npm install
cp .env.example .env.local   # fill in the Supabase URL and anon key
npm run dev                  # http://localhost:3000
```

The two must be on different ports. The API defaults to `4000` and the
frontend to `3000`; CORS on the API allows `localhost:3000` and `localhost:3001`
out of the box, and is configurable via `CORS_ORIGINS`.

### Deploying

Two variables decide whether the halves can talk to each other, and both are
build- or boot-time:

- **Frontend host** (e.g. Vercel): `NEXT_PUBLIC_API_URL` must be the API's public
  origin. It is inlined at build time, so changing it requires a redeploy, not
  just a restart.
- **API host** (e.g. Render): the frontend's origin must be in the CORS
  allow-list, or every browser request fails its preflight with *"No
  'Access-Control-Allow-Origin' header is present"*. Known origins are compiled
  in as defaults so this works without configuration; `CORS_ORIGINS` adds more.
  The API logs its allow-list at boot and logs every refused origin, so a
  mismatch is one log line rather than a console hunt.

Sign up one **seller** and one **customer** account. The seller creates a store,
adds a product with stock; the customer can then browse and buy it.

### Environment variables

**`server/.env`** — secret. Never committed.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | project URL |
| `SUPABASE_PUBLISHABLE_KEY` | anon key, used for per-request clients that carry the caller's JWT |
| `SUPABASE_SECRET_KEY` | **service role.** JWT verification, outbox worker, test fixtures. Bypasses RLS — server only |
| `SUPABASE_JWKS_URL` | JWT verification |
| `PORT` | API port, default 4000 |
| `CORS_ORIGINS` | *optional.* Extra browser origins allowed to call the API, **added to** the built-in defaults rather than replacing them. `*` matches within a hostname segment. The defaults already cover local development and the deployed frontend, and the allow-list is logged at boot |

**`client/.env.local`** — see [`client/.env.example`](client/.env.example).

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | base URL of the Express API. Defaults to `http://localhost:4000` for a fresh clone; **a production build must be given the production origin**, since `NEXT_PUBLIC_` values are inlined at build time |
| `NEXT_PUBLIC_SUPABASE_URL` | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key — public by design |

Every client variable is `NEXT_PUBLIC_`, which means **every one of them is
compiled into the JavaScript bundle and readable by anyone**. That is acceptable
only because none of them grants anything: the anon key identifies the project,
not a user, and RLS decides what the signed-in user may touch. The service-role
key is absent from `client/` entirely — verified against both the source and the
built output.

---

## Frontend

```
client/src/
  app/                  App Router pages, each with a co-located *.module.css
    (auth)/             login, signup
    products/[id]/      product detail
    cart/               cart and checkout
    orders/             customer order history
    seller/             store onboarding, catalogue, incoming orders
  components/           Header, Skeleton
  hooks/                use-products, use-orders, use-cart, use-checkout, use-store, use-session
  lib/                  api-client, endpoints, format, checkout-errors, seller-errors, motion
  types/api.ts          types mirroring openapi.yaml
```

**Rules the code holds to**

- Every API call goes through `api-client.ts`. No raw `fetch` to Express
  anywhere else.
- Every path lives in `endpoints.ts`. No URLs assembled inline.
- React Query key factories per resource (`productKeys`, `orderKeys`,
  `storeKeys`); a mutation invalidates the whole affected tree, because a price
  or stock change is visible from the marketplace, the seller list and the
  detail view at once.
- **Money is never divided inline.** Amounts are integer minor units, and the
  exponent is asked of `Intl.NumberFormat` rather than assumed to be 2 — XOF is
  zero-decimal, so a hardcoded `/100` would render a 50 000 franc product as
  500. All rendering goes through [`format.ts`](client/src/lib/format.ts).
- CSS Modules only, referencing design tokens defined in
  [`globals.css`](client/src/app/globals.css). No hardcoded colours or spacing
  outside that file.
- TypeScript strict, no `any`.

**Pagination.** The marketplace uses keyset pagination through
`useInfiniteQuery`. A cursor is only valid for the sort it was issued with, so
`sort` is part of the query key — changing it starts a fresh chain rather than
replaying a stale cursor. A rejected cursor (`400`) resets to the first page
instead of showing an error.

---

## Backend detail

The reasoning behind the database design, and the guarantees it provides.

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

---

## API documentation

[`openapi.yaml`](openapi.yaml) — OpenAPI 3.1, and the source of truth for the
frontend. Field names and endpoint paths in `client/src/types/api.ts` and
`client/src/lib/endpoints.ts` mirror it.

---

## Tests

```bash
cd server && npm test
```

`server/tests/` contains an API suite and a concurrency suite (Vitest +
Supertest), including the last-unit race fired with `Promise.all` so the
requests genuinely race — sequential `await`s would not test concurrency at all.

| # | Scenario | Expected |
|---|---|---|
| 1 | Seller A creates a product | 201 |
| 2 | Seller B attempts to modify it | 403 |
| 3 | Customer orders an available product | 201 |
| 4 | Customer orders more than stock | 409 |
| 5 | N simultaneous orders for the last item | exactly one 201 |

These run against a live Supabase project and create real auth users, so they
are not hermetic. **There is no frontend test suite** — the client has been
verified by driving a real browser against the running stack, not by automated
tests checked into the repo. See [Not implemented](#not-implemented).

---

## Trade-offs

Choices that are defensible but genuinely cost something.

**Client-side auth, not `@supabase/ssr` cookie sessions.** The session lives in
browser storage and is read by client components; route guards are `useEffect`
redirects in layouts. Consequences, honestly:

- Protected pages render a loading state and then redirect, rather than never
  being served. A determined user sees the shell of `/seller` briefly.
- There is no middleware or server-side session, so no server component can
  render personalised content, and no page is protected before it reaches the
  browser.
- This is **not** a security hole — every request still carries a JWT and RLS
  still decides — but it is worse UX and worse SEO than cookie-based sessions.

The correct fix is `@supabase/ssr` with cookie storage plus a Next middleware
that refreshes the session and gates routes server-side. It was not done.

**Client-side cart.** The cart is `localStorage`, holding only
`{ product_id, quantity }`. Price and name are deliberately never stored — the
server resolves them at checkout, so a cached price could only ever be stale or
forged. Consequences: the cart does not follow a user between devices or
survive clearing site data, and it cannot be recovered for abandoned-cart
analysis. A `carts` table would fix it at the cost of a write on every quantity
change.

**Order detail is filtered from the list.** There is no `GET /orders/{id}`, so
`/orders/[id]` finds the order within `GET /orders`, which is unpaginated and
capped at the 50 most recent. An older order cannot be opened by URL.

**Seller grouping shows no store name.** `OrderItem` carries `seller_id` and
nothing else, and no endpoint maps a seller to a store name, so an order
spanning several sellers labels the groups "Seller 1", "Seller 2". Putting a
store name on `OrderItem` is the fix; a lookup endpoint was not invented.

**Category filter is derived, not authoritative.** There is no categories
endpoint, so the marketplace filter is built from one unfiltered 100-product
page. A category appearing only beyond that page is not offered.

**`POST /products` is not atomic.** The product row and its inventory row are
two separate round trips. If the second fails, a product exists with no
inventory row. Reads tolerate it — a missing inventory row is reported as
quantity 0 — but the write path should be a plpgsql function, as order creation
is. Not fixed.

**Restocking is relative, not absolute.** `PATCH /products/{id}/inventory`
takes a signed delta rather than a new quantity, precisely so it cannot
overwrite a concurrent order's decrement. It is a slightly less obvious API in
exchange for being safe under contention.

---

## Not implemented

Stated plainly, rather than left to be discovered.

**Product and catalogue**
- No product images or media of any kind.
- No reviews, ratings or seller profiles.
- Search uses the `simple` text configuration — no stemming and no accent
  folding, so "lampe" will not match "lampes".
- The `EXPLAIN` outputs referenced under [Search and pagination](#search-and-pagination-a4)
  were never pasted into this file; the surrounding analysis was written against
  runs that are not reproduced here.

**Orders and payment**
- **No payment of any kind.** An order is placed and stock is reserved; nothing
  is charged.
- No cancellation, refund or returns.
- Order status is effectively decorative: `orders.status` defaults to
  `CONFIRMED` and nothing ever transitions it. `PENDING` and `CANCELLED` exist
  in the enum and are unused.
- No `GET /orders/{id}`, and `GET /orders` is unpaginated and server-capped at
  50 rows.
- No shipping, delivery, addresses or fulfilment tracking.

**Outbox**
- Event state is not exposed through the API, so no UI shows delivery status.
- Single-instance worker only — two workers would claim the same rows and
  deliver duplicates. The fix is `FOR UPDATE SKIP LOCKED` in a claim function.
- Fixed 5-second poll, no exponential backoff. At-least-once delivery.
- No cleanup job for `idempotency_keys`; the 24-hour retention is documented but
  nothing deletes expired rows.

**Frontend**
- No automated frontend tests — no unit, component or end-to-end suite in the
  repository. Verification was manual, by driving a browser against the running
  stack.
- No accessibility audit. Semantic markup, focus-visible styling, `aria-live`
  regions on async results and reduced-motion support are in place, but nothing
  has been checked against WCAG or a screen reader.
- No internationalisation. Copy is English-only, while the target market is
  francophone.
- No error monitoring or analytics.

**Operations**
- No CI, no deployment configuration, no container image. Nothing is deployed.
- No rate limiting, request logging or observability beyond `console.error`.
- No admin role or moderation tooling.
- Email confirmation is disabled in the Supabase project.

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

Within the 8-hour scope I prioritised the areas the brief weights most heavily — transactional order creation, concurrency safety, RLS, idempotency and automated tests. The following were left deliberately rather than overlooked, and each is listed with the risk it carries.

**1. Atomic product creation**

`POST /products` inserts the product row and its inventory row as two separate round trips. `supabase-js` has no transaction API, so these cannot be made atomic from Node.

*Risk:* if the second insert fails, a product exists with no inventory row. I observed exactly this during development, when the `inventory` INSERT policy was missing — the product was created, the inventory insert was denied by RLS, and the result was a product that appears in search but has no stock record behind it.

*Fix:* move both inserts into a `create_product` plpgsql function, the same pattern already used for `create_order`. This is a 30-minute change and is the first thing I would do.

**2. Multiple outbox workers**

The outbox worker is a single polling instance.

*Risk:* a single point of failure. If the worker dies, orders continue to be created correctly but no seller is ever notified — the events accumulate silently. Running a second instance is not a fix as things stand: both would claim the same rows and deliver duplicates.

*Fix:* claim batches inside a plpgsql function using `FOR UPDATE SKIP LOCKED`, so concurrent workers take disjoint sets of events. Consumers must also be idempotent, since the outbox guarantees at-least-once and not exactly-once delivery.

**3. Retry backoff**

Failed deliveries are retried on a fixed 5-second interval up to `MAX_ATTEMPTS`.

*Risk:* a permanently failing downstream endpoint is hammered every 5 seconds, adding load to a service that is likely already struggling.

*Fix:* a `next_attempt_at` column with exponential backoff, and an explicit terminal dead-letter state rather than relying on rows silently dropping out of the worker's query.

**4. Idempotency key cleanup**

Keys are written but never removed.

*Risk:* the table grows monotonically. Nothing breaks soon, but after a year it holds millions of rows that serve no purpose and slow down maintenance operations.

*Fix:* a scheduled job (pg_cron) deleting keys older than the 24-hour retention window. `idempotency_keys_created_at_idx` already supports the query.

**5. Two smaller issues I would also address**

- `create_order` hashes the request payload with `md5`. There is no attack surface here — the key column already has a unique constraint, so a collision cannot create or replay an order that a different key would not have created anyway — but `sha256` is the correct default and costs nothing.
- The test suite runs against the same database as development. Tests create and delete their own users with unique emails and clean up afterwards, but an isolated test database would be the correct arrangement; as it stands a failed run can leave fixtures behind.

### D3. Where I used a library or an AI assistant for something I could not have written myself

I used AI assistance primarily as a learning and review tool rather than treating generated code as a black box.

The main area where I used AI-generated code was the PL/pgSQL create_order function, since this was my first time writing a database function for transactional order creation. Initially I did not fully understand why the conditional inventory update was safe under concurrency. After tracing two concurrent transactions, I understood that the update combines the stock condition and decrement into one database operation. A transaction modifying the same inventory row holds the relevant lock, while the competing transaction waits and subsequently evaluates the condition against the current value. This helped me understand why this is safer than a separate read-then-write implementation.

I also used AI while learning PostgreSQL RLS policies. In particular, I learned the distinction between USING and WITH CHECK: USING controls which existing rows a role can access, while WITH CHECK validates the resulting row for inserts or updates. This made me understand why ownership must be enforced not only when selecting a row but also when changing its ownership-related fields.

I also learned why SECURITY DEFINER functions need a controlled search_path. Since such a function executes with the function owner's privileges, predictable object resolution is important to avoid security problems caused by relying on an uncontrolled search path.

For pagination, I used AI to clarify the tradeoff between offset pagination and keyset pagination and learned why keyset pagination is more suitable for large datasets when a stable ordering/cursor is available.

I also used AI to help organize my scaling discussion in Part D1. I then related the suggestions back to the actual architecture rather than adding technologies without a specific problem to solve.

The main lesson from using AI was that generated code is not enough. For example, I initially accepted the PL/pgSQL function without fully understanding its concurrency properties. I had to trace the database behavior myself before I could explain why it was correct. I would therefore consider understanding and being able to explain the generated implementation more important than the fact that AI helped produce the initial version.

One thing I understand in principle but have not verified experimentally is deadlock avoidance. I sort product IDs before locking so that concurrent multi-item orders acquire locks in the same order, but I have not constructed a test that actually reproduces a deadlock without it.

---
