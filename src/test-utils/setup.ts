/**
 * Jest `setupFiles` entry. Unit and regression tests run offline: any real
 * HTTP request fails loudly so a missing mock cannot reach Supabase, Gemini,
 * WhatsApp or Zoho.
 */
import * as http from 'node:http';
import * as https from 'node:https';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'https://supabase.test.invalid';
process.env.SUPABASE_KEY ||= 'test-anon-key';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const blocked = (target: unknown) => {
  const label =
    typeof target === 'string'
      ? target
      : target instanceof URL
        ? target.href
        : ((target as any)?.url ?? (target as any)?.hostname ?? 'unknown');
  throw new Error(
    `Network access is blocked in tests (attempted: ${label}). Mock the dependency instead.`,
  );
};

(globalThis as any).fetch = async (input: unknown) => blocked(input);
for (const mod of [http, https] as any[]) {
  mod.request = (input: unknown) => blocked(input);
  mod.get = (input: unknown) => blocked(input);
}
