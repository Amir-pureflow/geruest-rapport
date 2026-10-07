/**
 * Verwaltung → Einstellungen: wie diese Firma arbeitet (Entscheid 02.10.2026).
 * Ein Code für alle Firmen; die Schalter stehen in `konfiguration` (Migration 0017) und gelten
 * für alle Geräte dieser Firma. Nach dem Umschalten lädt die App neu, damit Menü und Erfassung passen.
 */
import { useState } from 'react';
import { Clock3, Minus, Plus } from 'lucide-react';
import {
  einstellungen, einstellungSetzen, schalterGelesen, eigeneFirma,
  briefkopf, briefkopfSetzen, normaltagMin, normaltagAusDatenbank, NORMALTAG_BEREICH,
  type Briefkopf, type Einstellungen,
} from '../../lib/einstellungen';
import { Segment } from '../../ui/Segment';

/** Häufige Normaltage im Bau: 8.0 · 8.2 · 8.4 (42-h-Woche) · 8.5 · 9.0 h. */
const NORMALTAG_VORSCHLAEGE = [480, 492, 504, 510, 540];
const alsStunden = (min: number) => (min / 60).toFixed(1);
const alsUhrzeit = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

/**
 * Normaler Arbeitstag (08.10.2026): Jede Firma bestimmt selbst, ab wann Überstunden zählen —
 * Gerüst GmbH 8.4 h, eine andere Firma vielleicht 8.2 h. Gilt für neue Meldungen und Korrekturen;
 * was schon gemeldet ist, bleibt, wie es ist (die Aufteilung steht im Zeiteintrag).
 */
function NormaltagKarte() {
  const [gespeichert, setGespeichert] = useState(normaltagMin);
  const [min, setMin] = useState(normaltagMin);
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null);
  const ausDatenbank = normaltagAusDatenbank();
  const { min: unten, max: oben, schritt } = NORMALTAG_BEREICH;
  const stellen = (neu: number) => { setMin(Math.min(oben, Math.max(unten, neu))); setMeldung(null); };
  const beispiel = 600; // 7:00–12:00 und 13:00–18:00

  async function speichern() {
    setSpeichert(true);
    const f = await einstellungSetzen('normaltagMin', min);
    setSpeichert(false);
    if (f) { setMeldung({ text: f, art: 'fehler' }); return; }
    setGespeichert(min);
    setMeldung({ text: 'Gespeichert ✓', art: 'ok' });
  }

  return (
    <section className="card space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-steel text-white shadow-[0_4px_10px_-4px_rgb(43_108_176/0.6)]">
          <Clock3 size={19} strokeWidth={2.2} aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-display text-[15px] font-semibold">Normaler Arbeitstag</h2>
          <p className="mt-0.5 text-xs text-ink3">
            So viele Stunden zählen pro Tag als normal. Was darüber liegt, sind Überstunden — in der Erfassung, in der
            Wochenübersicht und im Lohn-Export.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => stellen(min - schritt)} disabled={min <= unten} aria-label="6 Minuten weniger"
            className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-ink2 transition hover:text-ink disabled:opacity-40">
            <Minus size={18} aria-hidden="true" />
          </button>
          <div className="min-w-[9.5rem] text-center">
            <div className="font-display text-4xl font-semibold leading-none tabular-nums">{alsStunden(min)}<span className="ml-1 text-lg text-ink3">h</span></div>
            <div className="mt-1.5 text-xs tabular-nums text-ink3">{alsUhrzeit(min)} · {alsStunden(min * 5)} h pro Woche</div>
          </div>
          <button type="button" onClick={() => stellen(min + schritt)} disabled={min >= oben} aria-label="6 Minuten mehr"
            className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-ink2 transition hover:text-ink disabled:opacity-40">
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="lbl">Schnellwahl</p>
          <Segment
            label="Normaler Arbeitstag"
            optionen={NORMALTAG_VORSCHLAEGE.map((v) => ({ wert: v, text: `${alsStunden(v)} h` }))}
            wert={NORMALTAG_VORSCHLAEGE.includes(min) ? min : -1}
            aendern={stellen}
          />
        </div>
      </div>

      <p className="rounded-[12px] bg-ground px-3.5 py-2.5 text-xs text-ink2">
        Beispiel: 7:00–12:00 und 13:00–18:00 = {alsStunden(beispiel)} h →{' '}
        <b className="text-ink">{alsStunden(Math.min(beispiel, min))} h normal</b>
        {beispiel > min && <> + <b className="text-amber-deep">{alsStunden(beispiel - min)} h Überstunden</b></>}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={speichert || min === gespeichert} onClick={() => void speichern()} className="cta w-auto px-5 py-2.5 text-sm disabled:opacity-50">
          {speichert ? 'Speichert …' : 'Arbeitstag speichern'}
        </button>
        {meldung && <span className={'text-sm font-semibold ' + (meldung.art === 'ok' ? 'text-good-deep' : 'text-accent-deep')}>{meldung.text}</span>}
        <span className="text-[11px] text-ink3">Gilt ab sofort für neue Meldungen und Korrekturen. Bereits gemeldete Tage bleiben, wie sie sind.</span>
      </div>
      {ausDatenbank === false && (
        <p className="rounded-[12px] border border-amber/40 bg-amber-soft px-3.5 py-2 text-xs text-amber-deep">
          Die Datenbank kennt diese Einstellung noch nicht (Migration 0026 fehlt) — bis dahin gilt 8.4 h.
        </p>
      )}
    </section>
  );
}

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

      <NormaltagKarte />

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
