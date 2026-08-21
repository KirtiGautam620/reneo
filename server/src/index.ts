import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { errorHandler } from './middleware/errorHandler.js';
import productRoutes from './routes/products.js';
import storeRoutes   from './routes/stores.js';
import orderRoutes from './routes/orders.js';
import { startOutboxWorker } from './lib/outbox.js';

export const app=express();

// The browser client is a different origin (Next dev server), and the
// Idempotency-Key header on POST /orders is non-simple, so it triggers a
// preflight that must be answered explicitly.
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 600,
}));

app.use(express.json({limit:'100kb'}));
app.get('/health',(_req,res)=>res.json({status:"ok"}));
app.use('/stores',   storeRoutes);
app.use('/products', productRoutes);
app.use('/orders', orderRoutes);
app.use(errorHandler);
const port=Number(process.env.PORT)||3000;
if(process.env.NODE_ENV!=='test'){
  app.listen(port,()=>console.log(`Listening on ${port}`));
  startOutboxWorker();
}
