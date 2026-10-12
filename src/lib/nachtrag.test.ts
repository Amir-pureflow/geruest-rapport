import { describe, it, expect } from 'vitest';
import { fruehesterNachtrag, nachtragMoeglich, tagAusAdresse } from './nachtrag';

// Dienstag, 13.10.2026, spät am Nachmittag — die Uhrzeit darf das Ergebnis nicht ändern
const heute = new Date('2026-10-13T17:45:00');

describe('Nachtrag — eine Grenze für Startseite und Erfassung', () => {
  it('sieben Tage zurück, als Tag verglichen (nicht als Zeitpunkt)', () => {
    expect(fruehesterNachtrag(heute)).toBe('2026-10-06');
    expect(nachtragMoeglich('2026-10-06', heute)).toBe(true);
    expect(nachtragMoeglich('2026-10-05', heute)).toBe(false);
    expect(nachtragMoeglich('2026-10-13', heute)).toBe(true);
    expect(nachtragMoeglich('2026-10-14', heute)).toBe(false);
  });

  it('?tag= innerhalb der Grenze wird genommen', () => {
    expect(tagAusAdresse('2026-10-06', heute)).toEqual({ tag: '2026-10-06', hinweis: null });
    expect(tagAusAdresse(null, heute)).toEqual({ tag: null, hinweis: null });
  });

  it('zu alter Tag: kein stiller Sprung auf heute, sondern ein Satz dazu', () => {
    const r = tagAusAdresse('2026-09-28', heute);
    expect(r.tag).toBeNull();
    expect(r.hinweis).toContain('28.09.');
    expect(r.hinweis).toContain('mehr als 7 Tage');
  });

  it('Zukunft und Unsinn werden ebenfalls erklärt', () => {
    expect(tagAusAdresse('2026-10-20', heute).hinweis).toContain('Zukunft');
    expect(tagAusAdresse('gestern', heute).hinweis).toContain('ungültig');
  });
});
