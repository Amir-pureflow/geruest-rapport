/**
 * Verwaltung → Einstellungen: wie diese Firma arbeitet (Entscheid 02.10.2026).
 * Ein Code für alle Firmen; die Schalter stehen in `konfiguration` (Migration 0017) und gelten
 * für alle Geräte dieser Firma. Nach dem Umschalten lädt die App neu, damit Menü und Erfassung passen.
 */
import { useState } from 'react';
import {
  einstellungen, einstellungSetzen, schalterGelesen, eigeneFirma,
  briefkopf, briefkopfSetzen, type Briefkopf, type Einstellungen,
} from '../../lib/einstellungen';

/** Die Felder des Briefkopfs in der Reihenfolge, in der sie auf dem Rapport stehen. */
const BRIEFKOPF_FELDER: { feld: keyof Briefkopf; label: string; platzhalter: string; breit?: boolean }[] = [
  { feld: 'name', label: 'Firmenname', platzhalter: 'Gerüst GmbH', breit: true },
  { feld: 'slogan', label: 'Zusatz (optional)', platzhalter: 'Gerüstbau seit 1998', breit: true },
  { feld: 'adresse', label: 'Adresse', platzhalter: 'Industriestrasse 12, 3052 Zollikofen', breit: true },
  { feld: 'tel', label: 'Telefon', platzhalter: '031 911 22 33' },
  { feld: 'fax', label: 'Fax (optional)', platzhalter: '031 911 22 34' },
  { feld: 'mail', label: 'E-Mail', platzhalter: 'info@firma.ch' },
  { feld: 'web', label: 'Web', platzhalter: 'www.firma.ch' },
  { feld: 'bank', label: 'Bankverbindung', platzhalter: 'IBAN CH00 0000 0000 0000 0', breit: true },
  { feld: 'mwst', label: 'MwSt-Nummer', platzhalter: 'CHE-123.456.789 MWST', breit: true },
];

/**
 * Briefkopf für den Regierapport als PDF. Nur sichtbar, wenn die Firma mit Regie arbeitet —
 * ohne Regie entsteht nie ein PDF, dann wäre das Formular nur im Weg.
 */
function BriefkopfKarte() {
  const [werte, setWerte] = useState<Briefkopf>(briefkopf);
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null);

  async function speichern() {
    setSpeichert(true);
    const f = await briefkopfSetzen(werte);
    setSpeichert(false);
    setMeldung(f ? { text: f, art: 'fehler' } : { text: 'Gespeichert ✓', art: 'ok' });
  }

  return (
    <section className="card space-y-2.5">
      <div>
        <h2 className="font-display text-[15px] font-semibold">Briefkopf auf dem Rapport</h2>
        <p className="mt-0.5 text-xs text-ink3">Steht oben auf dem PDF, das der Kunde bekommt. Leere Felder werden weggelassen.</p>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {BRIEFKOPF_FELDER.map((f) => (
          <div key={f.feld} className={f.breit ? 'sm:col-span-2' : ''}>
            <label className="lbl" htmlFor={'bk-' + f.feld}>{f.label}</label>
            <input
              id={'bk-' + f.feld}
              value={werte[f.feld]}
              onChange={(e) => { setWerte({ ...werte, [f.feld]: e.target.value }); setMeldung(null); }}
              placeholder={f.platzhalter}
              className="field"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={speichert} onClick={() => void speichern()} className="cta w-auto px-5 py-2.5 text-sm disabled:opacity-60">
          {speichert ? 'Speichert …' : 'Briefkopf speichern'}
        </button>
        {meldung && (
          <span className={'text-sm font-semibold ' + (meldung.art === 'ok' ? 'text-good-deep' : 'text-accent-deep')}>{meldung.text}</span>
        )}
      </div>
    </section>
  );
}

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
];

export function Einstellungen() {
  const [werte, setWerte] = useState(einstellungen());
  const [fehler, setFehler] = useState('');
  const [speichert, setSpeichert] = useState<string | null>(null);
  // Kam beim Start nichts aus der Datenbank, zeigt die Seite unten nur die Standardwerte — das muss dastehen
  const ohneDatenbank = schalterGelesen() === false;
  const firma = eigeneFirma();

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
        Gilt für {firma?.name ?? 'diese Firma'} und für alle ihre Geräte. Andere Firmen arbeiten in derselben App, sehen aber
        weder diese Einstellungen noch diese Daten.
      </p>
      {ohneDatenbank && !fehler && (
        <p className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-2.5 text-sm text-amber-deep">
          Diese Einstellungen konnten nicht gelesen werden. Entweder fehlt Migration 0019, oder dieser Zugang hängt an
          keiner Firma. Bis dahin gilt, was unten angekreuzt ist, und Umschalten wird abgewiesen.
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

      {werte.erfassung === 'regie' && <BriefkopfKarte />}

      <p className="text-[11px] text-ink3">
        Nach dem Umschalten lädt die App neu. Was schon gemeldet wurde, bleibt so, wie es ist.
      </p>
    </div>
  );
}
