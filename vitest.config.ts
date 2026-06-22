import { defineConfig } from 'vitest/config';

// Tests cover the pure money-math extracted from the Deno edge functions
// (supabase/functions/*/math.ts). That logic has no Deno/npm/jsr imports, so it
// runs identically under Node — no Deno toolchain needed.
export default defineConfig({
  test: {
    include: ['supabase/functions/**/*.test.ts'],
    environment: 'node',
  },
});
