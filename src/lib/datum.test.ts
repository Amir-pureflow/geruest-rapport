import { describe, it, expect } from 'vitest';
import { stunden } from './datum';

describe('stunden — Anzeige in Stunden', () => {
  it('eine Nachkommastelle, wo sie genügt', () => {
    expect(stunden(504)).toBe('8.4');
    expect(stunden(480)).toBe('8.0');
    expect(stunden(0)).toBe('0.0');
    expect(stunden(1440)).toBe('24.0');
  });
  it('Viertelstunden genau: 4.75 h statt 4.8 (Pause 9:00–9:15 abgezogen)', () => {
    expect(stunden(285)).toBe('4.75');
    expect(stunden(525)).toBe('8.75');
    expect(stunden(21)).toBe('0.35');
    expect(stunden(15)).toBe('0.25');
  });
});
