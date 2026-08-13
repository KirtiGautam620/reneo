import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createUser, cleanup, uniq } from './helpers.js';
import { codec } from 'zod';

const sellerEmail = uniq('conc.seller');
const buyerEmails = Array.from({ length: 10 }, (_, i) => uniq(`conc.buyer${i}`));

let sellerToken: string;
let buyerTokens: string[] = [];

beforeAll(async () => {
  sellerToken = (await createUser(sellerEmail, 'SELLER')).token;
  await request(app).post('/stores')
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ name: 'Concurrency Store' }).expect(201);

  for (const e of buyerEmails) {
    buyerTokens.push((await createUser(e, 'CUSTOMER')).token);
  }
});

afterAll(async () => { await cleanup([sellerEmail, ...buyerEmails]); });

describe('B1 — concurrent stock', () => {
  it('5. exactly one of ten simultaneous orders succeeds for the last unit', async () => {
    const create = await request(app).post('/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Last Unit', category: 'lighting', price_minor: 50000, quantity: 1 })
      .expect(201);

    const pid = create.body.id;

    // Fire all ten before awaiting any — this is what makes it a race.
    const inFlight = buyerTokens.map(token =>
      request(app).post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ product_id: pid, quantity: 1 }] })
    );

    const results = await Promise.all(inFlight);

    const created  = results.filter(r => r.status === 201);
    const rejected = results.filter(r => r.status === 409);

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    expect(rejected.every(r => r.body.error.code !== undefined || r.body.error.code === 'OUT_OF_STOCK')).toBe(true);

    // Stock must never go negative.
    const check = await request(app).get(`/products/${pid}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(check.body.inventory.quantity).toBe(0);
  });

  it('repeats the race five times', async () => {
    for (let round = 0; round < 5; round++) {
      const create = await request(app).post('/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ name: `Race ${round}`, category: 'lighting', price_minor: 1000, quantity: 1 })
        .expect(201);

      const results = await Promise.all(
        buyerTokens.map(token =>
          request(app).post('/orders')
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ product_id: create.body.id, quantity: 1 }] })
        )
      );

      expect(results.filter(r => r.status === 201)).toHaveLength(1);
    }
  }, 60000);
});