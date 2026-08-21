import { ApiError } from './api-client';
import type { ApiErrorCode } from '@/types/api';

/**
 * Checkout failures are classified by `error.code` only. The message text is
 * never matched against — the API contract guarantees the code, not the prose.
 */
export interface CheckoutProblem {
  code: ApiErrorCode | 'UNKNOWN' | 'OFFLINE';
  title: string;
  detail: string;
  /** The line item at fault, when the error names one. */
  productId: string | null;
  /** Whether resubmitting the same cart could plausibly succeed. */
  retryable: boolean;
  /** Whether the user must change the cart before retrying. */
  needsCartChange: boolean;
  /** Whether stock counts on screen are known to be stale. */
  refreshStock: boolean;
}

export function describeCheckoutError(
  error: unknown,
  productName: (id: string) => string | undefined
): CheckoutProblem {
  if (!(error instanceof ApiError)) {
    return {
      code: 'OFFLINE',
      title: 'Could not reach the server',
      detail:
        'The order was not placed. Check your connection and try again — retrying is safe, the same order cannot be created twice.',
      productId: null,
      retryable: true,
      needsCartChange: false,
      refreshStock: false,
    };
  }

  const productId = error.productId;
  const name = productId ? productName(productId) : undefined;
  // Fall back to the id only when the cart no longer holds the product.
  const label = name ? `“${name}”` : 'One of the items in your cart';

  switch (error.code) {
    /**
     * The concurrency case. Between loading the cart and submitting it, another
     * customer's order took the stock: create_order's conditional decrement
     * (UPDATE ... WHERE quantity >= requested) matched zero rows, so nothing was
     * reserved and no order exists.
     */
    case 'OUT_OF_STOCK':
      return {
        code: error.code,
        title: `${name ? `${name} just sold out` : 'An item just sold out'}`,
        detail: `${label} no longer has enough stock for the quantity you asked for — someone else checked out first. Your cart has been refreshed with the stock that is left. Lower the quantity or remove the item, then order again. Nothing was charged and no order was created.`,
        productId,
        retryable: false,
        needsCartChange: true,
        refreshStock: true,
      };

    case 'PRODUCT_UNAVAILABLE':
      return {
        code: error.code,
        title: `${name ?? 'An item'} is no longer for sale`,
        detail: `${label} was withdrawn by its seller while it sat in your cart. Remove it to place the rest of your order.`,
        productId,
        retryable: false,
        needsCartChange: true,
        refreshStock: true,
      };

    case 'NOT_FOUND':
      return {
        code: error.code,
        title: `${name ?? 'An item'} no longer exists`,
        detail: `${label} could not be found in the catalogue. Remove it to continue.`,
        productId,
        retryable: false,
        needsCartChange: true,
        refreshStock: true,
      };

    /**
     * The key was already used for a *different* payload. The cart changed
     * mid-attempt; a fresh key is issued on the next submit.
     */
    case 'IDEMPOTENCY_KEY_REUSED':
      return {
        code: error.code,
        title: 'Your cart changed during checkout',
        detail:
          'The order was not placed. Press “Place order” again to submit the cart as it stands now.',
        productId: null,
        retryable: true,
        needsCartChange: false,
        refreshStock: false,
      };

    case 'NOT_A_CUSTOMER':
      return {
        code: error.code,
        title: 'Seller accounts cannot place orders',
        detail:
          'Only customer accounts can check out. Sign in with a customer account to order these items.',
        productId: null,
        retryable: false,
        needsCartChange: false,
        refreshStock: false,
      };

    case 'UNAUTHENTICATED':
      return {
        code: error.code,
        title: 'Your session expired',
        detail: 'Log in again — your cart is kept on this device and will still be here.',
        productId: null,
        retryable: false,
        needsCartChange: false,
        refreshStock: false,
      };

    case 'FORBIDDEN':
      return {
        code: error.code,
        title: 'Not allowed',
        detail: 'This account is not permitted to place this order.',
        productId: null,
        retryable: false,
        needsCartChange: false,
        refreshStock: false,
      };

    case 'VALIDATION_ERROR':
      return {
        code: error.code,
        title: 'The order could not be submitted',
        detail: `${error.message} Adjust the quantities in your cart and try again.`,
        productId: null,
        retryable: false,
        needsCartChange: true,
        refreshStock: false,
      };

    case 'INTERNAL_ERROR':
      return {
        code: error.code,
        title: 'Something went wrong on our side',
        detail:
          'The order was not placed. Retrying is safe — the same order cannot be created twice.',
        productId: null,
        retryable: true,
        needsCartChange: false,
        refreshStock: true,
      };

    default:
      return {
        code: error.code,
        title: 'The order could not be placed',
        detail: `${error.message} Nothing was charged.`,
        productId: null,
        retryable: true,
        needsCartChange: false,
        refreshStock: true,
      };
  }
}
