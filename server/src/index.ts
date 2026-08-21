import express from 'express';
import 'dotenv/config';
import { errorHandler } from './middleware/errorHandler.js';
import productRoutes from './routes/products.js';
import storeRoutes   from './routes/stores.js';
import orderRoutes from './routes/orders.js';
import { startOutboxWorker } from './lib/outbox.js';

export const app=express();
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