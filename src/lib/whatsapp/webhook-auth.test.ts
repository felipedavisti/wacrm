import { describe, it, expect, vi } from 'vitest';
import { loadWebhookAppSecrets } from './webhook-auth';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => `dec:${s}`,
}));

// META_APP_SECRET is set by vitest.config.ts (env block).
const ENV = process.env.META_APP_SECRET!;

function db(opts: { rows?: { app_secret: string }[]; error?: boolean }) {
  return {
    from: () => ({
      select: () =>
        Promise.resolve({
          data: opts.error ? null : opts.rows ?? [],
          error: opts.error ? { message: 'relation does not exist' } : null,
        }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('loadWebhookAppSecrets', () => {
  it('returns decrypted meta_apps secrets plus the env fallback', async () => {
    const out = await loadWebhookAppSecrets(
      db({ rows: [{ app_secret: 's1' }, { app_secret: 's2' }] }),
    );
    expect(out).toContain('dec:s1');
    expect(out).toContain('dec:s2');
    expect(out).toContain(ENV);
    expect(out).toHaveLength(3);
  });

  it('degrades to the env secret when meta_apps is unavailable (pre-migration)', async () => {
    const out = await loadWebhookAppSecrets(db({ error: true }));
    expect(out).toEqual([ENV]);
  });

  it('dedupes identical secrets', async () => {
    const out = await loadWebhookAppSecrets(
      db({ rows: [{ app_secret: 's1' }, { app_secret: 's1' }] }),
    );
    expect(out).toEqual(['dec:s1', ENV]);
  });
});
