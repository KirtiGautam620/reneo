import { adminClient } from '../config/supabase.js';

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

async function deliver(event: any): Promise<void> {
  // Real system: webhook POST, push notification, email.
  // Here: broadcast on a Supabase Realtime channel per seller.
  const sellers: string[] = event.payload.sellers ?? [];

  await Promise.all(sellers.map(async (sellerId) => {
    const channel = adminClient.channel(`seller:${sellerId}`);
    await channel.send({
      type: 'broadcast',
      event: 'ORDER_CREATED',
      payload: event.payload,
    });
  }));
}

export async function processOutbox(): Promise<void> {
  const { data: events, error } = await adminClient
    .from('events')
    .select('*')
    .is('delivered_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('id', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) { console.error('outbox: fetch failed', error); return; }
  if (!events?.length) return;

  for (const event of events) {
    try {
      await deliver(event);
      await adminClient
        .from('events')
        .update({ delivered_at: new Date().toISOString(), attempts: event.attempts + 1 })
        .eq('id', event.id);
    } catch (err) {
      console.error(`outbox: delivery failed for event ${event.id}`, err);
      await adminClient
        .from('events')
        .update({ attempts: event.attempts + 1 })
        .eq('id', event.id);
    }
  }
}

export function startOutboxWorker(intervalMs = 5000) {
  setInterval(() => { processOutbox().catch(console.error); }, intervalMs);
}