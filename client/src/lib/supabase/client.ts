import { createClient } from '@supabase/supabase-js';

/**
 * Auth only.
 *
 * This client is used for sign-in, sign-up, session handling and the single
 * profiles read in use-session.ts. It never touches a business table: products,
 * orders, stores and inventory are read and written through the Express API.
 * See the root README, "Why the frontend does not query Supabase directly".
 *
 * The anon key is public by design — it identifies the project, not a user.
 * Authorisation comes from RLS evaluating the signed-in user's JWT.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy client/.env.example to client/.env.local and fill it in.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);