import { describe, expect, it } from 'vitest';
import { supabaseUrl } from '../../src/lib/supabase';

describe('Sperre gegen die echte Datenbank', () => {
  it('die App-Verbindung zeigt im Test auf die lokale Supabase', () => {
    expect(supabaseUrl).toBe('http://127.0.0.1:54321');
  });
  it('Anfragen an Supabase-Cloud, Live-App und bezahlte Dienste scheitern', async () => {
    for (const url of [
      'https://rilknynqwzamgpimniyz.supabase.co/rest/v1/firma',
      'https://geruest-rapport.vercel.app/',
      'https://api.mistral.ai/v1/chat/completions',
      'https://api.resend.com/emails',
      'https://germanywestcentral.api.cognitive.microsoft.com/',
    ]) {
      await expect(fetch(url)).rejects.toThrow(/GESPERRT/);
    }
  });
});
