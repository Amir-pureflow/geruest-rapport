import { describe, it, expect } from 'vitest';
import { mitJwtNochmals } from './supabase';

const antwort = (status: number, body: string) => new Response(body, { status });

describe('mitJwtNochmals — «JWT issued at future» (11.11.2026)', () => {
  it('wartet und schickt einmal nochmals', async () => {
    let n = 0;
    const f = mitJwtNochmals(async () => (++n === 1 ? antwort(401, '{"code":"PGRST303","message":"JWT issued at future"}') : antwort(200, '[]')), 1);
    const r = await f('https://x/rest/v1/zeiteintrag');
    expect(r.status).toBe(200);
    expect(n).toBe(2);
  });

  it('andere 401 gehen unverändert zurück', async () => {
    let n = 0;
    const f = mitJwtNochmals(async () => { n++; return antwort(401, '{"message":"JWT expired"}'); }, 1);
    const r = await f('https://x/rest/v1/zeiteintrag');
    expect(r.status).toBe(401);
    expect(await r.text()).toContain('expired');
    expect(n).toBe(1);
  });

  it('höchstens ein zweiter Versuch', async () => {
    let n = 0;
    const f = mitJwtNochmals(async () => { n++; return antwort(401, 'JWT issued at future'); }, 1);
    expect((await f('https://x/rest/v1/a')).status).toBe(401);
    expect(n).toBe(2);
  });
});
