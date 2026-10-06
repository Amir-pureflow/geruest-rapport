import { describe, expect, it } from 'vitest';
import { arbeitstage, ausschnitt, spuren, tageZwischen, ueberschneiden, zeitraumVorschlag } from './planung';
import { ausIso } from './datum';

describe('planung', () => {
  it('zählt Tage über die Sommerzeit hinweg ganz', () => {
    expect(tageZwischen('2026-10-24', '2026-10-26')).toBe(2);
    expect(tageZwischen('2026-10-06', '2026-10-06')).toBe(0);
  });

  it('schneidet Einsätze auf das sichtbare Fenster zu', () => {
    // Fenster Mo 5.10. bis So 11.10.
    expect(ausschnitt({ von: '2026-10-06', bis: '2026-10-08' }, '2026-10-05', 7)).toEqual({ ab: 1, bis: 3, links: false, rechts: false });
    expect(ausschnitt({ von: '2026-09-28', bis: '2026-10-20' }, '2026-10-05', 7)).toEqual({ ab: 0, bis: 6, links: true, rechts: true });
    expect(ausschnitt({ von: '2026-10-12', bis: '2026-10-14' }, '2026-10-05', 7)).toBeNull();
    expect(ausschnitt({ von: '2026-09-01', bis: '2026-10-04' }, '2026-10-05', 7)).toBeNull();
  });

  it('legt Überschneidungen in eigene Spuren, sonst bleibt alles in Spur 0', () => {
    const r = spuren(
      [
        { id: 'a', von: '2026-10-05', bis: '2026-10-07' },
        { id: 'b', von: '2026-10-08', bis: '2026-10-09' },
        { id: 'c', von: '2026-10-07', bis: '2026-10-07' },
      ],
      '2026-10-05',
      7,
    );
    const spurVon = Object.fromEntries(r.map((x) => [x.plan.id, x.spur]));
    expect(spurVon).toEqual({ a: 0, c: 1, b: 0 });
  });

  it('schlägt Zeiträume bis Freitag vor', () => {
    const di = ausIso('2026-10-06');
    expect(zeitraumVorschlag('tag', di)).toEqual({ von: '2026-10-06', bis: '2026-10-06' });
    expect(zeitraumVorschlag('woche', di)).toEqual({ von: '2026-10-06', bis: '2026-10-09' });
    expect(zeitraumVorschlag('zwei', di)).toEqual({ von: '2026-10-06', bis: '2026-10-16' });
    expect(zeitraumVorschlag('vier', di)).toEqual({ von: '2026-10-06', bis: '2026-10-30' });
    // Samstag: «bis Freitag» wäre rückwärts — dann nur der Tag selbst
    expect(zeitraumVorschlag('woche', ausIso('2026-10-10'))).toEqual({ von: '2026-10-10', bis: '2026-10-10' });
  });

  it('zählt nur Montag bis Freitag als Arbeitstage', () => {
    expect(arbeitstage({ von: '2026-10-05', bis: '2026-10-11' })).toBe(5);
    expect(arbeitstage({ von: '2026-10-09', bis: '2026-10-12' })).toBe(2);
  });

  it('erkennt Überschneidungen inklusive Randtag', () => {
    expect(ueberschneiden({ von: '2026-10-05', bis: '2026-10-07' }, { von: '2026-10-07', bis: '2026-10-09' })).toBe(true);
    expect(ueberschneiden({ von: '2026-10-05', bis: '2026-10-06' }, { von: '2026-10-07', bis: '2026-10-09' })).toBe(false);
  });
});
