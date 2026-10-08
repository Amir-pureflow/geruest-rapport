import { describe, it, expect } from 'vitest';
import { einladungsLink, waNummer, waLink, einladungsText, stand, restText, geraeteName, GUELTIG_STUNDEN } from './einladung';

describe('einladungsLink', () => {
  it('hängt den Token an die Adresse', () => {
    expect(einladungsLink('https://rapporto.app', 'abc')).toBe('https://rapporto.app/e/abc');
  });
  it('verträgt einen Schrägstrich am Ende — sonst gäbe es //e/', () => {
    expect(einladungsLink('https://rapporto.app/', 'abc')).toBe('https://rapporto.app/e/abc');
  });
});

describe('waNummer', () => {
  it('macht aus einer Schweizer 0-Nummer eine mit 41', () => {
    expect(waNummer('079 123 45 67')).toBe('41791234567');
  });
  it('nimmt +41 wie es ist', () => {
    expect(waNummer('+41 79 123 45 67')).toBe('41791234567');
  });
  it('nimmt 0041', () => {
    expect(waNummer('0041791234567')).toBe('41791234567');
  });
  it('lässt Leerzeichen, Striche und Klammern weg', () => {
    expect(waNummer('(079) 123-45-67')).toBe('41791234567');
  });
  it('gibt null bei nichts, Unsinn oder zu kurz', () => {
    expect(waNummer(null)).toBeNull();
    expect(waNummer('')).toBeNull();
    expect(waNummer('keine Nummer')).toBeNull();
    expect(waNummer('079 12')).toBeNull();
  });
});

describe('waLink', () => {
  it('baut einen wa.me-Link mit verpacktem Text', () => {
    const l = waLink('079 123 45 67', 'Hallo Nuhi');
    expect(l).toBe('https://wa.me/41791234567?text=Hallo%20Nuhi');
  });
  it('gibt null ohne brauchbare Nummer — dann bleibt nur «Link kopieren»', () => {
    expect(waLink(null, 'Hallo')).toBeNull();
  });
});

describe('einladungsText', () => {
  const t = einladungsText('Ismail Vaiti', 'https://rapporto.app/e/abc');
  it('spricht mit dem Vornamen', () => {
    expect(t).toContain('Hallo Ismail,');
    expect(t).not.toContain('Vaiti');
  });
  it('enthält den Link und die Gültigkeit', () => {
    expect(t).toContain('https://rapporto.app/e/abc');
    expect(t).toContain(`${GUELTIG_STUNDEN} Stunden`);
  });
  it('kommt auch mit einem einzelnen Namen zurecht', () => {
    expect(einladungsText('Nuhi', 'x')).toContain('Hallo Nuhi,');
  });
});

describe('stand', () => {
  const jetzt = new Date('2026-10-09T12:00:00Z');
  it('eingelöst schlägt alles', () => {
    expect(stand({ gueltig_bis: '2026-10-08T12:00:00Z', eingeloest_am: '2026-10-08T13:00:00Z' }, jetzt)).toBe('eingeloest');
  });
  it('abgelaufen und nie benutzt ist verfallen', () => {
    expect(stand({ gueltig_bis: '2026-10-09T11:59:00Z', eingeloest_am: null }, jetzt)).toBe('verfallen');
  });
  it('noch gültig ist offen', () => {
    expect(stand({ gueltig_bis: '2026-10-09T18:00:00Z', eingeloest_am: null }, jetzt)).toBe('offen');
  });
});

describe('restText', () => {
  const jetzt = new Date('2026-10-09T12:00:00Z');
  it('zeigt Minuten unter einer Stunde', () => {
    expect(restText('2026-10-09T12:20:00Z', jetzt)).toBe('noch 20 Minuten');
  });
  it('zeigt Stunden darüber', () => {
    expect(restText('2026-10-09T19:00:00Z', jetzt)).toBe('noch 7 Stunden');
  });
  it('schreibt die eine Stunde in der Einzahl', () => {
    expect(restText('2026-10-09T13:00:00Z', jetzt)).toBe('noch 1 Stunde');
  });
  it('sagt abgelaufen, wenn die Zeit um ist', () => {
    expect(restText('2026-10-09T11:00:00Z', jetzt)).toBe('abgelaufen');
  });
});

describe('geraeteName', () => {
  it('erkennt die Geräte, die auf der Baustelle vorkommen', () => {
    expect(geraeteName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
    expect(geraeteName('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad');
    expect(geraeteName('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android-Handy');
  });
  it('fällt auf etwas Harmloses zurück', () => {
    expect(geraeteName('irgendwas')).toBe('Gerät');
  });
});
