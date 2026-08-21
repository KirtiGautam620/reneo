import { ApiError } from './api-client';
import type { ValidationIssue } from '@/types/api';

/**
 * Seller-side failures, branched on `code` rather than message text.
 */
export function describeSellerError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Could not reach the server. Nothing was saved.';
  }

  switch (error.code) {
    case 'CONFLICT':
      return 'You already have a store. A seller may own exactly one.';

    /**
     * The API returns 403 for "does not exist" and "not yours" alike — RLS
     * matches zero rows either way, and distinguishing them would leak which
     * product ids exist.
     */
    case 'FORBIDDEN':
      return 'This product does not exist, or is not yours to change.';

    case 'OUT_OF_STOCK':
      return 'That would take stock below zero. An order may have taken some while you were editing.';

    case 'NOT_FOUND':
      return 'This product no longer exists.';

    case 'UNAUTHENTICATED':
      return 'Your session expired. Log in again.';

    case 'VALIDATION_ERROR': {
      const details = error.details;
      if (Array.isArray(details) && details.length > 0) {
        return details
          .map((issue: ValidationIssue) => `${issue.path}: ${issue.message}`)
          .join('; ');
      }
      return error.message;
    }

    default:
      return error.message;
  }
}
