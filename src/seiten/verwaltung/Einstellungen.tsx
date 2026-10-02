/**
 * Verwaltung → Einstellungen: wie diese Firma arbeitet (Entscheid 02.10.2026).
 * Ein Code für alle Firmen; die Schalter stehen in `konfiguration` (Migration 0016) und gelten
 * für alle Geräte dieser Firma. Nach dem Umschalten lädt die App neu, damit Menü und Erfassung passen.
 */
import { useState } from 'react';
import { einstellungen, einstellungSetzen, type Einstellungen } from '../../lib/einstellungen';

interface Wahl<K extends keyof Einstellungen> {
  feld: K;
  titel: string;
  erklaerung: string;
  optionen: { wert: Einstellungen[K]; label: string; text: string }[];
}

const WAHLEN = [
  {
    feld: 'erfassung',
    titel: 'Erfassung auf dem Teamgerät',
    erklaerung: 'Was der Chefmonteur am Abend meldet.',
    optionen: [
      { wert: 'wochenblatt', label: 'Wie das Wochenblatt', text: 'Baustelle, wer war dabei, Normalstunden und Überstunden. Überstunden brauchen eine Sprachnotiz — der Bauführer entscheidet daraus, ob es Regie ist. Nichts anderes.' },
      { wert: 'regie', label: 'Mit Regie-Ablauf', text: 'Zusätzlich «War etwas anders?» mit den Symbolen zusätzlich gearbeitet, warten müssen, etwas kaputt. Danach «Wer wollte das?», Stunden je Person, Fotos und Sprachnotiz.' },
    ],
  } as Wahl<'erfassung'>,
  {
    feld: 'sekretariat',
    titel: 'Ansicht Sekretariat',
    erklaerung: 'Was das Sekretariat sieht und bearbeiten kann.',
    optionen: [
      { wert: 'stunden', label: 'Nur Stunden', text: 'Übersicht mit Stunden je Mitarbeiter, Export fürs Lohn-Excel, Board und Verwaltung. Keine Regierapporte, keine Zusatzaufträge.' },
      { wert: 'voll', label: 'Mit Regie', text: 'Zusätzlich Zusatzauftrag am Telefon, Tages- und Wochenübersicht, Regierapporte mit Nachfassen und die Auswertung.' },
    ],
  } as Wahl<'sekretariat'>,
  {
    feld: 'mehrkostenanzeige',
    titel: 'Mehrkostenanzeige',
    erklaerung: 'Bausitzungsprotokoll 7.1: «Mehrkosten ohne vorzeitige und schriftliche Anzeige werden nicht entschädigt.»',
    optionen: [
      { wert: false, label: 'Aus', text: 'Kein Knopf am Zusatzauftrag. Die Firma meldet Mehrkosten auf ihrem eigenen Weg an.' },
      { wert: true, label: 'An', text: 'Der Zusatzauftrag bekommt «Bauleitung informieren»: eine Mail vor der Arbeit, mit Vermerk wann und an wen.' },
    ],
  } as Wahl<'mehrkostenanzeige'>,
];

export function Einstellungen() {
  const [werte, setWerte] = useState(einstellungen());
  const [fehler, setFehler] = useState('');
  const [speichert, setSpeichert] = useState<string | null>(null);

  async function setzen<K extends keyof Einstellungen>(feld: K, wert: Einstellungen[K]) {
    if (werte[feld] === wert || speichert) return;
    setSpeichert(feld);
    const f = await einstellungSetzen(feld, wert);
    setSpeichert(null);
    if (f) { setFehler('Konnte nicht speichern: ' + f); return; }
    setFehler('');
    setWerte({ ...werte, [feld]: wert });
    // Menü, Startseiten und Erfassung hängen daran — neu laden ist ehrlicher als halb umgestellt
    setTimeout(() => location.reload(), 400);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink2">
        Gilt für diese Firma und alle ihre Geräte. Jede Gerüstbaufirma hat ihre eigene Datenbank — die Schalter hier ändern nichts bei anderen Firmen.
      </p>
      {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm text-accent-deep">{fehler}</p>}

      {WAHLEN.map((w) => (
        <section key={w.feld} className="card space-y-2.5">
          <div>
            <h2 className="font-display text-[15px] font-semibold">{w.titel}</h2>
            <p className="mt-0.5 text-xs text-ink3">{w.erklaerung}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {w.optionen.map((o) => {
              const aktiv = werte[w.feld] === o.wert;
              return (
                <button
                  key={String(o.wert)}
                  type="button"
                  disabled={speichert !== null}
                  onClick={() => void setzen(w.feld, o.wert as never)}
                  aria-pressed={aktiv}
                  className={'rounded-[12px] border p-3 text-left transition disabled:opacity-60 ' + (aktiv ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface hover:bg-ground')}
                >
                  <span className={'block text-sm font-semibold ' + (aktiv ? 'text-accent-deep' : '')}>
                    {aktiv ? '✓ ' : ''}{o.label}
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-ink2">{o.text}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-[11px] text-ink3">
        Nach dem Umschalten lädt die App neu. Schon gespeicherte Meldungen bleiben, wie sie sind — die Wochenübersicht zeigt beide Arten.
      </p>
    </div>
  );
}
