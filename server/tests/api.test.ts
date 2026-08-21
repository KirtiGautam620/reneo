import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createUser, cleanup, uniq } from './helpers.js';

const emailA = uniq('seller.a');
const emailB = uniq('seller.b');
const emailC = uniq('customer');

let tokenA: string, tokenB: string, tokenC: string;
let productId: string;

beforeAll(async () => {
  tokenA = (await createUser(emailA, 'SELLER')).token;
  tokenB = (await createUser(emailB, 'SELLER')).token;
  tokenC = (await createUser(emailC, 'CUSTOMER')).token;

  await request(app).post('/stores')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ name: 'Store A' }).expect(201);

  await request(app).post('/stores')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ name: 'Store B' }).expect(201);
});

afterAll(async () => { await cleanup([emailA, emailB, emailC]); });

describe('Part C', () => {
  it('1. Seller A creates a product', async () => {
    const res = await request(app).post('/products')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Solar Lamp', category: 'lighting', price_minor: 50000, quantity: 5 });

    expect(res.status).toBe(201);
    expect(res.body.price_minor).toBe(50000);
    productId = res.body.id;
  });

  it('2. Seller B cannot modify it', async () => {
    const res = await request(app).patch(`/products/${productId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ price_minor: 1 });

    expect(res.status).toBe(403);

    const check = await request(app).get(`/products/${productId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(check.body.price_minor).toBe(50000);   // unchanged
  });

  it('3. Customer orders an available product', async () => {
    const res = await request(app).post('/orders')
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ items: [{ product_id: productId, quantity: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.total_minor).toBe(100000);   // server-resolved, 2 × 50000
  });

  it('4. Customer cannot order more than stock', async () => {
    const res = await request(app).post('/orders')
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ items: [{ product_id: productId, quantity: 999 }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
  });

  it('rejects a client-supplied price', async () => {
    const res = await request(app).post('/orders')
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ items: [{ product_id: productId, quantity: 1, price_minor: 1 }] });

    expect(res.status).toBe(400);
  });
});