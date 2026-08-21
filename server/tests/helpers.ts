import { adminClient } from '../src/config/supabase.js';
import 'dotenv/config';

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;

export async function createUser(
  email: string,
  role: 'SELLER' | 'CUSTOMER'
): Promise<{ id: string; token: string }> {
  const password = 'TestPassword123!';

  const { data: existing } = await adminClient.auth.admin.listUsers();
  const found = existing?.users.find(u => u.email === email);
  if (found) await adminClient.auth.admin.deleteUser(found.id);

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, full_name: email },
  });
  if (error) throw error;

  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Login failed: ${JSON.stringify(json)}`);

  return { id: data.user.id, token: json.access_token };
}

export async function cleanup(emails: string[]) {
  const { data } = await adminClient.auth.admin.listUsers();
  for (const email of emails) {
    const u = data?.users.find(x => x.email === email);
    if (u) await adminClient.auth.admin.deleteUser(u.id);
  }
}

export const uniq = (p: string) => `${p}.${Date.now()}@example.com`;