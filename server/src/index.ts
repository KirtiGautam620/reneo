import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { errorHandler } from './middleware/errorHandler.js';
import productRoutes from './routes/products.js';
import storeRoutes   from './routes/stores.js';
import orderRoutes from './routes/orders.js';
import { startOutboxWorker } from './lib/outbox.js';

export const app=express();

// The browser client is served from a different origin, and the
// Idempotency-Key header on POST /orders is non-simple, so every write is
// preceded by a preflight that must be answered explicitly.
//
// CORS_ORIGINS is a comma-separated allow-list. Entries may contain `*` as a
// wildcard for one or more characters, which is what makes Vercel preview
// deployments (whose hostname changes per branch) workable:
//
//   CORS_ORIGINS=https://reneo-delta.vercel.app,https://reneo-*.vercel.app
//
// Defaults cover local development *and* this project's own deployed
// frontend, so the API works without configuration. Relying on an env var
// alone made a forgotten setting look like a broken app, with the only symptom
// a CORS message in the browser console.
//
// These stay an explicit allow-list rather than a reflect-everything wildcard.
// CORS is weak protection for a bearer-token API — an attacker's page cannot
// read another origin's token — but a named list documents who the client is,
// and costs nothing.
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://reneo-delta.vercel.app',   // production frontend
  'https://reneo-*.vercel.app',       // Vercel preview deployments
];

// CORS_ORIGINS, when set, is *added* to the defaults rather than replacing
// them: the previous behaviour meant setting it for a new environment silently
// cut off the existing one.
const allowedOrigins = [
  ...DEFAULT_ORIGINS,
  ...(process.env.CORS_ORIGINS ?? '').split(','),
]
  .map(o => o.trim().replace(/\/+$/, ''))   // tolerate a trailing slash in config
  .filter(Boolean)
  .filter((origin, index, all) => all.indexOf(origin) === index);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function originAllowed(origin: string): boolean {
  return allowedOrigins.some(pattern => {
    if (!pattern.includes('*')) return pattern === origin;
    const source = pattern.split('*').map(escapeRegExp).join('[^/]*');
    return new RegExp(`^${source}$`).test(origin);
  });
}

app.use(cors({
  origin(origin, callback) {
    // No Origin header at all: curl, server-to-server, same-origin. Not a
    // browser cross-origin request, so there is nothing to authorise.
    if (!origin) return callback(null, true);

    if (originAllowed(origin)) return callback(null, true);

    // Passing an Error here would surface as a 500 and hide the real cause.
    // Returning false omits Access-Control-Allow-Origin, which is what the
    // browser is actually asking about — and the log says why.
    console.warn(
      `CORS: refused origin ${origin}. Allowed: ${allowedOrigins.join(', ') || '(none configured)'}. ` +
      'Set CORS_ORIGINS on the API to include this origin.'
    );
    return callback(null, false);
  },
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
  app.listen(port,()=>{
    console.log(`Listening on ${port}`);
    // Printed at boot so a CORS misconfiguration is one log line away.
    console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
  });
  startOutboxWorker();
}
