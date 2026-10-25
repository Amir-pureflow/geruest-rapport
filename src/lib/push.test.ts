import { describe, expect, it } from 'vitest';
import { standAus } from './push';

const basis = { moeglich: true, apple: false, installiert: false, erlaubnis: 'default' as NotificationPermission, abo: false };

describe('standAus', () => {
  it('an nur mit Erlaubnis und Abo', () => {
    expect(standAus({ ...basis, erlaubnis: 'granted', abo: true })).toBe('an');
    expect(standAus({ ...basis, erlaubnis: 'granted', abo: false })).toBe('aus');
    expect(standAus({ ...basis, erlaubnis: 'default', abo: true })).toBe('aus');
  });
  it('blockiert, wenn der Browser es verweigert', () => {
    expect(standAus({ ...basis, erlaubnis: 'denied' })).toBe('blockiert');
  });
  it('iPhone im Browser-Tab: erst auf den Home-Bildschirm', () => {
    expect(standAus({ ...basis, moeglich: false, apple: true, installiert: false, erlaubnis: null })).toBe('iphone-installieren');
  });
  it('ohne Web Push und kein iPhone (oder schon installiert): nicht möglich', () => {
    expect(standAus({ ...basis, moeglich: false, apple: false, erlaubnis: null })).toBe('nicht-moeglich');
    expect(standAus({ ...basis, moeglich: false, apple: true, installiert: true, erlaubnis: null })).toBe('nicht-moeglich');
  });
});
