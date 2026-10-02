/**
 * Verwaltung → Einstellungen: wie diese Firma arbeitet (Entscheid 02.10.2026).
 * Ein Code für alle Firmen; die Schalter stehen in `konfiguration` (Migration 0017) und gelten
 * für alle Geräte dieser Firma. Nach dem Umschalten lädt die App neu, damit Menü und Erfassung passen.
 */
import { useState } from 'react';
import { einstellungen, einstellungSetzen, schalterGelesen, type Einstellungen } from '../../lib/einstellungen';

interface Wahl<K extends keyof Einstellungen> {
  feld: K;
  titel: string;
  erklaerung: string;
  optionen: { wert: Einstellungen[K]; label: string; text: string }[];
}

const WAHLEN = [
  {
    feld: 'erfassung',
    titel: 'Was der Chefmonteur am Abend meldet',
    erklaerung: 'Auf dem Handy, auf der Baustelle.',
    optionen: [
      { wert: 'wochenblatt', label: 'Nur die Stunden', text: 'Baustelle, wer war dabei, Stunden. Mehr nicht. Gibt es Überstunden, sagt er kurz ins Mikrofon, warum. Der Bauführer hört es und entscheidet.' },
      { wert: 'regie', label: 'Stunden und Zusatzarbeit', text: 'Dazu die Frage, ob etwas anders war. Er tippt ein Bild an, sagt wer es wollte, trägt die Stunden je Person ein und macht Fotos.' },
    ],
  } as Wahl<'erfassung'>,
  {
    feld: 'sekretariat',
    titel: 'Was das Sekretariat sieht',
    erklaerung: 'Für die Lohnabrechnung braucht es nur einen Teil.',
    optionen: [
      { wert: 'stunden', label: 'Nur die Stunden', text: 'Die Stunden je Mitarbeiter, der Export fürs Lohn-Excel und die Stammdaten. Sonst nichts.' },
      { wert: 'voll', label: 'Alles wie der Bauführer', text: 'Dazu die Tages- und die Wochenübersicht. Führt die Firma Zusatzarbeit, sieht das Sekretariat auch die Rapporte an die Kunden.' },
    ],
  } as Wahl<'sekretariat'>,
  {
    feld: 'mehrkostenanzeige',
    titel: 'Zusatzarbeit vorher anmelden',
    erklaerung: 'Viele Bauleitungen zahlen sie nur, wenn sie vor der Arbeit schriftlich angemeldet war.',
    optionen: [
      { wert: false, label: 'Aus', text: 'Die Firma meldet das selber an, wie bisher. In der App gibt es dafür keinen Knopf.' },
      { wert: true, label: 'An', text: 'Beim Zusatzauftrag steht «Bauleitung informieren». Ein Tipp schickt die Mail und hält fest, wann und an wen.' },
    ],
  } as Wahl<'mehrkostenanzeige'>,
];

export function Einstellungen() {
  const [werte, setWerte] = useState(einstellungen());
  const [fehler, setFehler] = useState('');
  const [speichert, setSpeichert] = useState<string | null>(null);
  // Kam beim Start nichts aus der Datenbank, zeigt die Seite unten nur die Standardwerte — das muss dastehen
  const ohneDatenbank = schalterGelesen() === false;

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
        Gilt für diese Firma und für alle ihre Geräte. Jede Firma hat ihre eigene Datenbank. Was hier eingestellt wird, ändert bei anderen Firmen nichts.
      </p>
      {ohneDatenbank && !fehler && (
        <p className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-2.5 text-sm text-amber-deep">
          Diese Einstellungen stehen noch nicht in der Datenbank. Bis Migration 0017 eingespielt ist, gilt überall, was
          unten angekreuzt ist, und Umschalten wird abgewiesen. Die Datei liegt im Repo unter
          supabase/migrations/0017_firma_einstellungen.sql.
        </p>
      )}
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
        Nach dem Umschalten lädt die App neu. Was schon gemeldet wurde, bleibt so, wie es ist.
      </p>
    </div>
  );
}
