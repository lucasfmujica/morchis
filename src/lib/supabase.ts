import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

// Reuse a single browser client across the app. Every component that calls
// createClient() in its render body would otherwise build a fresh client on
// each render; the client is stateless config-wise, so one shared instance is
// both correct and avoids that per-render churn.
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}
