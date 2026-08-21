'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { endpoints } from '@/lib/endpoints';
import { productKeys, useProducts } from './use-products';
import type {
  AdjustInventoryRequest,
  AdjustInventoryResult,
  ArchiveProductResult,
  CreateProductRequest,
  Product,
  ProductListQuery,
  UpdateProductRequest,
} from '@/types/api';

/**
 * The seller's own catalogue. `mine: true` is part of the query key, so this
 * shares the factory with the marketplace list while keeping a separate cache
 * entry — the two return different rows for the same account.
 */
export function useSellerProducts(query: Omit<ProductListQuery, 'mine'> = {}) {
  return useProducts({ ...query, mine: true });
}

/** Every write invalidates the whole products tree: lists and details alike. */
function useProductInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: productKeys.all });
}

export function useCreateProduct() {
  const invalidate = useProductInvalidation();

  return useMutation({
    mutationFn: (body: CreateProductRequest) =>
      api.post<Product>(endpoints.products.root, body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateProduct(id: string) {
  const invalidate = useProductInvalidation();

  return useMutation({
    mutationFn: (body: UpdateProductRequest) =>
      api.patch<Product>(endpoints.products.detail(id), body),
    onSuccess: () => invalidate(),
  });
}

export function useArchiveProduct() {
  const invalidate = useProductInvalidation();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete<ArchiveProductResult>(endpoints.products.detail(id)),
    onSuccess: () => invalidate(),
  });
}

/**
 * Restock. The API takes a signed, relative delta rather than an absolute
 * quantity, so an order that decrements stock while this is in flight is added
 * to rather than overwritten.
 */
export function useAdjustInventory(id: string) {
  const invalidate = useProductInvalidation();

  return useMutation({
    mutationFn: (body: AdjustInventoryRequest) =>
      api.patch<AdjustInventoryResult>(endpoints.products.inventory(id), body),
    onSuccess: () => invalidate(),
  });
}
