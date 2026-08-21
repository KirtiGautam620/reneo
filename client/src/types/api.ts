/**
 * Types mirroring openapi.yaml. The spec is the source of truth — every field
 * here exists there, and nothing here is invented.
 */

/** Every value in the spec's error code enum. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_A_CUSTOMER'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OUT_OF_STOCK'
  | 'PRODUCT_UNAVAILABLE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INTERNAL_ERROR';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** `details` on an order error that concerns one line item. */
export interface ProductErrorDetails {
  product_id: string;
}

export type ErrorDetails = ValidationIssue[] | ProductErrorDetails | null;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ErrorDetails;
  };
}

export type ProductStatus = 'ACTIVE' | 'ARCHIVED';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface Inventory {
  quantity: number;
}

/**
 * Returned by POST /products, PATCH /products/{id}. Products belong to a
 * *store*, not directly to a seller — there is no `seller_id` here, and stock
 * lives on the separate inventory relation, so there is no `stock` either.
 */
export interface Product {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  category: string;
  price_minor: number;
  currency: string;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

/** Returned by GET /products/{id} — `allOf` adds only the inventory relation. */
export interface ProductWithInventory extends Product {
  inventory: Inventory;
}

/**
 * Returned by GET /products. Deliberately narrower than Product: the list
 * projection omits store_id, status and updated_at, and adds inventory.
 */
export interface ProductListItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price_minor: number;
  currency: string;
  /** Always ACTIVE on the marketplace listing; ARCHIVED appears only when mine=true. */
  status: ProductStatus;
  created_at: string;
  inventory: Inventory;
}

export interface Store {
  id: string;
  seller_id: string;
  name: string;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  seller_id: string;
  /** Snapshot taken at purchase time; later catalogue edits do not rewrite it. */
  product_name: string;
  unit_price_minor: number;
  quantity: number;
  /** Generated column: unit_price_minor × quantity. */
  subtotal_minor: number;
}

/** An order may span several sellers, so the seller lives on each line item. */
export interface Order {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total_minor: number;
  currency: string;
  created_at: string;
  order_items: OrderItem[];
}

export interface OrderResult {
  order_id: string;
  /** Present on 201. A 200 idempotency replay returns order_id and replayed only. */
  total_minor?: number;
  replayed: boolean;
}

export interface CreateOrderItem {
  product_id: string;
  quantity: number;
}

export interface CreateOrderRequest {
  items: CreateOrderItem[];
}

/**
 * Keyset pagination. There is no page number or total count — the cursor
 * encodes the sort key of the last row, and is only valid for the `sort` it
 * was issued with.
 */
export interface Paginated<T> {
  data: T[];
  next_cursor: string | null;
  limit: number;
}

/** GET /orders returns a bare envelope with no cursor. */
export interface Collection<T> {
  data: T[];
}

export type ProductSort = 'newest' | 'price_asc' | 'price_desc';

export interface ProductListQuery {
  q?: string;
  category?: string;
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  /** Seller view: the caller's own store, archived products included. */
  mine?: boolean;
  sort?: ProductSort;
  limit?: number;
  cursor?: string;
}

export interface CreateStoreRequest {
  name: string;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  category: string;
  price_minor: number;
  /** Initial stock only. Changed afterwards through PATCH /products/{id}/inventory. */
  quantity?: number;
}

/** PATCH /products/{id} — at least one field, and never `quantity`. */
export interface UpdateProductRequest {
  name?: string;
  description?: string;
  category?: string;
  price_minor?: number;
}

/** PATCH /products/{id}/inventory — a signed, relative change. */
export interface AdjustInventoryRequest {
  delta: number;
}

export interface AdjustInventoryResult {
  product_id: string;
  quantity: number;
}

export interface ArchiveProductResult {
  id: string;
  status: 'ARCHIVED';
}
