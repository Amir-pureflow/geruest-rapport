import { describe, expect, it } from 'vitest';
import { MUSTER, WOERTER, tageImText } from './albanisch_woerter';
import { textUebersetzen } from './uebersetzer';

const sq = (t: string) => textUebersetzen(t, { woerter: WOERTER, muster: MUSTER });

describe('Albanische Oberfläche (Baustelle)', () => {
  it('übersetzt feste Texte und lässt Leerraum vorn und hinten stehen', () => {
    expect(sq('Tag melden')).toBe('Raporto ditën');
    expect(sq(' Tag melden ')).toBe(' Raporto ditën ');
    expect(sq('Wer war dabei')).toBe('Kush ishte');
    expect(sq('Fehlt melden')).toBe('Lajmëro mungesën');
  });

  it('übersetzt Texte mit Zahlen, Daten und Wochentagen', () => {
    expect(sq('Mo 16.11.')).toBe('Hën 16.11.');
    expect(sq('Do 19.11.2026')).toBe('Enj 19.11.2026');
    expect(sq('1.6 h Überstunden je Person')).toBe('1.6 orë shtesë për person');
    expect(sq('42 Sek. — antippen zum Stoppen')).toBe('42 sek. — prek për ta ndalur');
    expect(sq('Plan für Montag 23.11. geändert')).toBe('Plani për E hënë 23.11. ndryshoi');
    expect(sq('Plan für morgen geändert')).toBe('Plani për nesër ndryshoi');
    expect(sq('Gespeichert: normaler Tag 8.4 h + 1.6 h Überstunden')).toBe('U ruajt: ditë normale 8.4 h + 1.6 orë shtesë');
  });

  it('übersetzt die neue Erfassung und Startseite (21.11.2026)', () => {
    expect(sq('Total pro Person')).toBe('Gjithsej për person');
    expect(sq('Zwei Baustellen laut Plan')).toBe('Dy kantiere sipas planit');
    expect(sq('Pause 9:00–9:15 ist abgezogen, Mittag 12–13 frei.')).toBe('Pushimi 9:00–9:15 është zbritur, dreka 12–13 e lirë.');
    expect(sq('Mittag 12–13 ist frei. Pause 9:00–9:30 nicht bezahlt? «− Pause» tippen.')).toBe('Dreka 12–13 është e lirë. Pushimi 9:00–9:30 nuk paguhet? Shtyp «− Pushimi».');
    expect(sq('eigene Zeit · davon 1.5 h Überstunden')).toBe('orar i veçantë · prej tyre 1.5 orë shtesë');
    expect(sq('nachtragen')).toBe('plotëso');
  });

  it('nennt die Sprache der Sprachnotiz auf Albanisch', () => {
    expect(sq('Auf Albanisch sprechen, 10 Sekunden reichen — der Bauführer liest es auf Deutsch.'))
      .toBe('Fol shqip, mjaftojnë 10 sekonda — shefi i kantierit e lexon në gjermanisht.');
  });

  it('lässt Baustelle, Adresse, Treffpunkt und Hinweis des Büros deutsch (Erin 19.11.2026)', () => {
    expect(sq('Neubau Wankdorffeld, Baufeld C')).toBeNull();
    expect(sq('Aarstrasse 12, 3005 Bern')).toBeNull();
    expect(sq('Werkhof')).toBeNull();
    expect(sq('auf der Baustelle')).toBeNull();
    expect(sq('Treffpunkt Werkhof')).toBe('Vendtakimi: Werkhof');
    expect(sq('Hinweis: «Schlüssel beim Hauswart holen»')).toBe('Shënim: «Schlüssel beim Hauswart holen»');
    expect(sq('Viktoriastrasse statt Eigerplatz (ab 6:30, Treffpunkt Werkhof)'))
      .toBe('Viktoriastrasse në vend të Eigerplatz (nga ora 6:30, vendtakimi Werkhof)');
  });

  it('lässt Namen und Unbekanntes unverändert', () => {
    expect(sq('Fidan Kameri')).toBeNull();
    expect(sq('903673')).toBeNull();
    expect(sq('')).toBeNull();
  });

  it('übersetzt Tage in einem Stück Text', () => {
    expect(tageImText('Freitag 20.11.')).toBe('E premte 20.11.');
    expect(tageImText('Di 17.11.')).toBe('Mar 17.11.');
    expect(tageImText('heute')).toBe('sot');
  });
});
