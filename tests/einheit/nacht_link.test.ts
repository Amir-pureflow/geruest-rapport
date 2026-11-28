/** Entscheide Amir 28.11.2026: Nachtarbeit zählt zum Starttag · Kunden-Link gilt 60 Tage nach Versand, 30 nach Bestätigung. */
import { describe, expect, it } from 'vitest';
import { bisMitNacht, spannenMinuten, spannenOffen, uhrzeit, uhrzeitFeld, zeitenText, zuSpalten } from '../../src/lib/zeiten';
import { linkAbgelaufen } from '../../supabase/functions/_shared/linkfrist';

const h = (s: number, m = 0) => s * 60 + m;

describe('Nachtarbeit', () => {
  it('22:00–02:00 = 4 h am Starttag, gespeichert als bis 1560', () => {
    const bis = bisMitNacht(h(22), h(2)); // 120 + 1440
    expect(bis).toBe(1560);
    expect(spannenMinuten([{ von: h(22), bis }])).toBe(240);
    expect(spannenOffen([{ von: h(22), bis }])).toBeNull();
    expect(zuSpalten([{ von: h(22), bis }])).toEqual({ von_min: 1320, bis_min: 1560, von2_min: null, bis2_min: null });
  });
  it('Anzeige: 2:00 mit «(+1)», Feld zeigt 02:00', () => {
    expect(uhrzeit(1560)).toBe('2:00');
    expect(uhrzeitFeld(1560)).toBe('02:00');
    expect(zeitenText({ von_min: 1320, bis_min: 1560 })).toBe('22:00–2:00 (+1)');
    expect(zeitenText({ von_min: 420, bis_min: 1020 })).toBe('7:00–17:00');
  });
  it('höchstens 14 h: 18:00–08:00 geht, 13:00–12:00 bleibt «verkehrt» (Tippfehler)', () => {
    expect(bisMitNacht(h(18), h(8))).toBe(h(8) + 1440); // 14 h
    expect(bisMitNacht(h(13), h(12))).toBe(h(12)); // 23 h → kein Nachtdienst
    expect(spannenOffen([{ von: h(13), bis: bisMitNacht(h(13), h(12)) }])).toBe('verkehrt');
  });
  it('normale Zeiten bleiben, wie sie sind', () => {
    expect(bisMitNacht(h(7), h(17))).toBe(h(17));
    expect(bisMitNacht(h(22), h(23, 30))).toBe(h(23, 30));
    expect(bisMitNacht(h(22), 1560)).toBe(1560); // schon umgerechnet: bleibt
  });
});

describe('Kunden-Link läuft ab', () => {
  const tag = 86_400_000;
  const jetzt = Date.parse('2026-11-28T12:00:00Z');
  const vor = (tage: number) => new Date(jetzt - tage * tag).toISOString();
  it('versendet: bis 60 Tage gültig, danach abgelaufen', () => {
    expect(linkAbgelaufen({ status: 'versendet', versendet_am: vor(59) }, jetzt)).toBe(false);
    expect(linkAbgelaufen({ status: 'frist_abgelaufen', versendet_am: vor(61) }, jetzt)).toBe(true);
  });
  it('bestätigt: noch 30 Tage ab Bestätigung', () => {
    expect(linkAbgelaufen({ status: 'bestaetigt', versendet_am: vor(90), bestaetigt_am: vor(29) }, jetzt)).toBe(false);
    expect(linkAbgelaufen({ status: 'bestaetigt', versendet_am: vor(40), bestaetigt_am: vor(31) }, jetzt)).toBe(true);
  });
  it('Entwurf und alte Datensätze ohne Versanddatum laufen nicht ab', () => {
    expect(linkAbgelaufen({ status: 'entwurf', versendet_am: vor(400) }, jetzt)).toBe(false);
    expect(linkAbgelaufen({ status: 'versendet', versendet_am: null }, jetzt)).toBe(false);
  });
});
