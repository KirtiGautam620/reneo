import { supabase } from './supabase/client';
import type { ApiErrorCode, ErrorDetails, ProductErrorDetails } from '@/types/api';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL!;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode | 'UNKNOWN',
    message: string,
    public details: ErrorDetails = null
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isConflict() {
    return this.status === 409;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isUnauthorized() {
    return this.status === 401;
  }

  /**
   * Order errors that concern a single line item carry `{ product_id }` in
   * details, so the offending product can be named without reading `message`.
   */
  get productId(): string | null {
    const details = this.details;
    if (!details || Array.isArray(details)) return null;
    const { product_id } = details as ProductErrorDetails;
    return typeof product_id === 'string' ? product_id : null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed with ${res.status}`,
      err?.details ?? null
    );
  }

  return body as T;
}

/**
 * `init` exists so callers can add request-specific headers — POST /orders
 * needs an Idempotency-Key. Body and method stay owned by the helper.
 */
type RequestOptions = Omit<RequestInit, 'method' | 'body'>;

export const api = {
  get: <T>(path: string, init?: RequestOptions) => request<T>(path, init),
  post: <T>(path: string, body: unknown, init?: RequestOptions) =>
    request<T>(path, { ...init, method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown, init?: RequestOptions) =>
    request<T>(path, { ...init, method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string, init?: RequestOptions) =>
    request<T>(path, { ...init, method: 'DELETE' }),
};
