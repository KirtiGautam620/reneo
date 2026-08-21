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

/**
 * A VALIDATION_ERROR carries `details` as an array of `{ path, message }`, so
 * the API can say which field it rejected. Pulling them out by path lets a form
 * put each message beside the input that caused it instead of dumping one
 * combined string at the top.
 *
 * Returns an empty map for every other error shape, so callers can render field
 * errors and a general message from the same failure without branching twice.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  if (error.code !== 'VALIDATION_ERROR') return {};

  const details = error.details;
  if (!Array.isArray(details)) return {};

  const byField: Record<string, string> = {};
  for (const issue of details as ValidationIssue[]) {
    if (typeof issue?.path !== 'string' || typeof issue?.message !== 'string') continue;
    // Zod joins nested paths with dots; the first segment is the field.
    const field = issue.path.split('.')[0];
    if (field && !byField[field]) byField[field] = issue.message;
  }
  return byField;
}

/** True when the failure was field-level and is already shown beside the inputs. */
export function hasFieldErrors(error: unknown): boolean {
  return Object.keys(fieldErrors(error)).length > 0;
}
