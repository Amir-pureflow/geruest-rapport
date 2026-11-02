import { useRef, useState } from 'react';
import { Check, MapPinOff, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { adresseSuchen, suchText, trefferBewerten, trefferSortieren, type Lage, type Sicherheit, type Treffer } from '../../lib/adresse';
import { Segment, SegmentZahl } from '../../ui/Segment';

/** Was die Sammel-Zuordnung von einer Baustelle braucht */
export interface OhneOrt extends Lage { id: string; konto_nr: string; bezeichnung: string | null; plz: string | null }

interface Ergebnis {
  b: OhneOrt;
  stufe: Sicherheit;
  grund: string | null;
  /** Der sichere bzw. beste Treffer */
  treffer: Treffer | null;
  /** Bis drei Treffer zum Antippen (beim Prüfen) */
  vorschlaege: Treffer[];
  stand: 'offen' | 'gespeichert' | 'weg' | 'fehler';
}

const zeile = (t: Treffer) => `${t.strasse}, ${t.plz} ${t.ort}`;

/**
 * Adressen gesammelt nachtragen (25.10.2026, Amir: «217 Baustellen der Gerüst GmbH ohne Adresse»). Die Bezeichnung
 * enthält meist schon die Adresse («Muri Thunstrasse 99», «Gümligen Worbstr.262») — Rapporto sucht jede im
 * Adressverzeichnis des Bundes und teilt ein: sicher (Strasse und Nummer stimmen genau, `trefferBewerten`), prüfen,
 * nicht gefunden. Gespeichert wird erst auf Knopfdruck des Büros: die sicheren gesammelt, die anderen einzeln.
 * Zwei Durchgänge: ohne bekanntes Gebiet der Firma zuerst schweizweit, dann die unklaren nochmals im Umkreis der
 * sicheren Treffer («Fabrikstrasse 8»: Bern statt Lyss).
 */
export function AdressenNachtragen({ baustellen, naehe, onGespeichert, onOeffnen }: {
  baustellen: OhneOrt[];
  naehe: { lat: number; lon: number } | null;
  onGespeichert: () => void;
  /** Baustelle unten in der Liste aufklappen (selbst suchen oder Punkt setzen) */
  onOeffnen: (id: string) => void;
}) {
  const [phase, setPhase] = useState<'bereit' | 'sucht' | 'fertig'>('bereit');
  const [fortschritt, setFortschritt] = useState({ n: 0, von: 0 });
  const [ergebnisse, setErgebnisse] = useState<Ergebnis[]>([]);
  const [ansicht, setAnsicht] = useState<Sicherheit>('sicher');
  const [aus, setAus] = useState<Set<string>>(new Set());
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; ok: boolean } | null>(null);
  const abbruch = useRef<AbortController | null>(null);

  async function durchgang(liste: OhneOrt[], gebiet: { lat: number; lon: number } | null, signal: AbortSignal, zaehlen: () => void): Promise<Ergebnis[]> {
    const out: Ergebnis[] = [];
    let pos = 0;
    // Vier Anfragen gleichzeitig — schnell genug (217 in wenigen Sekunden), ohne die Adresssuche zu überfahren
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (pos < liste.length && !signal.aborted) {
        const b = liste[pos++];
        const suche = suchText(b);
        let treffer: Treffer[] = [];
        try { treffer = trefferSortieren(await adresseSuchen(suche, gebiet, signal), { plz: b.plz, naehe: gebiet }); } catch { if (signal.aborted) return; }
        const r = trefferBewerten(suche, treffer, gebiet);
        // Der beste Treffer zuerst unter den Vorschlägen (er kann weiter hinten in der Liste stehen: «15» nach «15a»)
        const vorschlaege = (r.treffer ? [r.treffer, ...treffer.filter((x) => x !== r.treffer)] : treffer).slice(0, 3);
        out.push({ b, ...r, vorschlaege, stand: 'offen' });
        zaehlen();
      }
    }));
    return out;
  }

  async function suchen() {
    const ctrl = new AbortController();
    abbruch.current = ctrl;
    setPhase('sucht');
    setMeldung(null);
    let n = 0;
    setFortschritt({ n: 0, von: baustellen.length });
    const zaehlen = () => setFortschritt({ n: ++n, von: baustellen.length });
    const erste = await durchgang(baustellen, naehe, ctrl.signal, zaehlen);
    if (ctrl.signal.aborted) { setPhase('bereit'); return; }
    let alle = erste;
    // Ohne bekanntes Gebiet: die unklaren nochmals im Umkreis der sicheren Treffer suchen
    const sicher = erste.filter((e) => e.stufe === 'sicher' && e.treffer);
    if (!naehe && sicher.length >= 3) {
      const gebiet = { lat: sicher.reduce((s, e) => s + e.treffer!.lat, 0) / sicher.length, lon: sicher.reduce((s, e) => s + e.treffer!.lon, 0) / sicher.length };
      const unklar = erste.filter((e) => e.stufe !== 'sicher').map((e) => e.b);
      n = 0;
      setFortschritt({ n: 0, von: unklar.length });
      const zweite = await durchgang(unklar, gebiet, ctrl.signal, () => setFortschritt({ n: ++n, von: unklar.length }));
      if (ctrl.signal.aborted) { setPhase('bereit'); return; }
      const neu = new Map(zweite.map((e) => [e.b.id, e]));
      alle = erste.map((e) => neu.get(e.b.id) ?? e);
    }
    const ordnung = new Map(baustellen.map((b, i) => [b.id, i]));
    alle.sort((x, y) => (ordnung.get(x.b.id) ?? 0) - (ordnung.get(y.b.id) ?? 0));
    setErgebnisse(alle);
    setAus(new Set());
    setAnsicht(alle.some((e) => e.stufe === 'sicher') ? 'sicher' : alle.some((e) => e.stufe === 'pruefen') ? 'pruefen' : 'keiner');
    setPhase('fertig');
  }

  async function speichernEine(b: OhneOrt, t: Treffer): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase.from('baustelle')
      .update({ strasse: t.strasse, plz: t.plz, ort: t.ort, lat: t.lat, lon: t.lon, lage_quelle: 'suche', lage_geprueft_am: new Date().toISOString() })
      .eq('id', b.id);
    return !error;
  }

  function stand(id: string, s: Ergebnis['stand'], treffer?: Treffer) {
    setErgebnisse((l) => l.map((e) => (e.b.id === id ? { ...e, stand: s, treffer: treffer ?? e.treffer } : e)));
  }

  async function sichereUebernehmen() {
    const liste = ergebnisse.filter((e) => e.stufe === 'sicher' && e.stand === 'offen' && !aus.has(e.b.id) && e.treffer);
    if (liste.length === 0) return;
    setSpeichert(true);
    setMeldung(null);
    let gut = 0;
    let schlecht = 0;
    for (let i = 0; i < liste.length; i += 8) {
      const teil = liste.slice(i, i + 8);
      const ok = await Promise.all(teil.map((e) => speichernEine(e.b, e.treffer!)));
      teil.forEach((e, k) => { stand(e.b.id, ok[k] ? 'gespeichert' : 'fehler'); if (ok[k]) gut++; else schlecht++; });
    }
    setSpeichert(false);
    setMeldung(schlecht
      ? { text: `${gut} gespeichert, ${schlecht} nicht — bitte nochmals versuchen.`, ok: false }
      : { text: `${gut} ${gut === 1 ? 'Adresse' : 'Adressen'} gespeichert ✓ — die Baustellen stehen jetzt auf der Karte.`, ok: true });
    onGespeichert();
  }

  async function einzeln(e: Ergebnis, t: Treffer) {
    const ok = await speichernEine(e.b, t);
    stand(e.b.id, ok ? 'gespeichert' : 'fehler', t);
    if (ok) onGespeichert();
  }

  if (baustellen.length === 0 && phase !== 'fertig') return null;

  const zahl = (s: Sicherheit) => ergebnisse.filter((e) => e.stufe === s).length;
  const offenSicher = ergebnisse.filter((e) => e.stufe === 'sicher' && e.stand === 'offen');
  const gewaehlt = offenSicher.filter((e) => !aus.has(e.b.id)).length;
  const sichtbar = ergebnisse.filter((e) => e.stufe === ansicht);

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-amber-soft text-amber-deep"><MapPinOff size={17} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {phase === 'fertig' ? 'Adressen aus den Bezeichnungen' : `${baustellen.length} ${baustellen.length === 1 ? 'Baustelle' : 'Baustellen'} ohne Ort`}
          </p>
          <p className="text-xs text-ink3">
            {phase === 'fertig'
              ? 'Sicher = Strasse und Nummer stehen genau so in der Bezeichnung. Gespeichert wird erst, wenn du übernimmst.'
              : 'Sie fehlen auf der Tageskarte, «Navigieren» sucht nur nach dem Text. Rapporto liest die Adresse aus der Bezeichnung und sucht sie im Adressverzeichnis des Bundes — du bestätigst, bevor etwas gespeichert wird.'}
          </p>
        </div>
        {phase === 'bereit' && (
          <button type="button" onClick={() => void suchen()} className="btn-ghost shrink-0 py-2 text-sm"><Search size={14} aria-hidden="true" /> Adressen suchen</button>
        )}
        {phase === 'fertig' && (
          <button type="button" onClick={() => { setPhase('bereit'); setErgebnisse([]); setMeldung(null); }} className="shrink-0 text-xs font-semibold text-ink3 underline underline-offset-2 hover:text-ink">Schliessen</button>
        )}
      </div>

      {phase === 'sucht' && (
        <div className="space-y-1.5" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-steel transition-[width] duration-200" style={{ width: `${fortschritt.von ? (fortschritt.n / fortschritt.von) * 100 : 0}%` }} />
          </div>
          <p className="flex items-center justify-between text-xs text-ink3">
            <span>Sucht … {fortschritt.n} von {fortschritt.von}</span>
            <button type="button" onClick={() => abbruch.current?.abort()} className="font-semibold underline underline-offset-2 hover:text-ink">Abbrechen</button>
          </p>
        </div>
      )}

      {phase === 'fertig' && (
        <>
          <Segment label="Ergebnis" wert={ansicht} aendern={setAnsicht} optionen={[
            { wert: 'sicher', text: <span className="inline-flex items-center gap-1.5">Sicher <SegmentZahl n={zahl('sicher')} an={ansicht === 'sicher'} /></span> },
            { wert: 'pruefen', text: <span className="inline-flex items-center gap-1.5">Bitte prüfen <SegmentZahl n={zahl('pruefen')} an={ansicht === 'pruefen'} /></span> },
            { wert: 'keiner', text: <span className="inline-flex items-center gap-1.5">Nicht gefunden <SegmentZahl n={zahl('keiner')} an={ansicht === 'keiner'} /></span> },
          ]} />

          {ansicht === 'sicher' && offenSicher.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-ink2">
                <input type="checkbox" checked={gewaehlt === offenSicher.length} onChange={(ev) => setAus(ev.target.checked ? new Set() : new Set(offenSicher.map((e) => e.b.id)))} className="h-4 w-4 accent-[var(--color-ink)]" />
                alle auswählen
              </label>
              <button type="button" disabled={speichert || gewaehlt === 0} onClick={() => void sichereUebernehmen()} className="cta w-auto px-4 py-2 text-sm">
                {speichert ? 'Speichert …' : `${gewaehlt} ${gewaehlt === 1 ? 'Adresse' : 'Adressen'} übernehmen`}
              </button>
            </div>
          )}
          {meldung && <p className={'text-xs ' + (meldung.ok ? 'font-medium text-good-deep' : 'font-semibold text-accent-deep')} role="status">{meldung.text}</p>}

          <ul className="max-h-[440px] divide-y divide-line overflow-y-auto rounded-[12px] border border-line bg-white">
            {sichtbar.length === 0 && <li className="px-3 py-3 text-sm text-ink3">Keine in dieser Gruppe.</li>}
            {sichtbar.map((e) => (
              <li key={e.b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                {ansicht === 'sicher' && e.stand === 'offen' && (
                  <input type="checkbox" aria-label={`${e.b.bezeichnung ?? e.b.konto_nr} übernehmen`} checked={!aus.has(e.b.id)}
                    onChange={() => setAus((s) => { const n = new Set(s); if (n.has(e.b.id)) n.delete(e.b.id); else n.add(e.b.id); return n; })}
                    className="h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{e.b.bezeichnung || e.b.konto_nr} <span className="knr ml-1 align-middle text-[10px]">{e.b.konto_nr}</span></span>
                  {e.stand === 'gespeichert' && e.treffer ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-good-deep"><Check size={12} strokeWidth={3} aria-hidden="true" />{zeile(e.treffer)}</span>
                  ) : e.stufe === 'sicher' && e.treffer ? (
                    <span className="block truncate text-xs text-ink2">→ {zeile(e.treffer)}</span>
                  ) : (
                    <span className="block text-xs text-amber-deep">{e.grund}</span>
                  )}
                  {e.stand === 'fehler' && <span className="block text-xs font-semibold text-accent-deep">Nicht gespeichert — nochmals versuchen.</span>}
                </span>
                {ansicht !== 'sicher' && e.stand !== 'gespeichert' && e.stand !== 'weg' && (
                  <span className="flex w-full flex-wrap items-center gap-1.5">
                    {e.vorschlaege.map((t) => (
                      <button key={`${t.lat},${t.lon}`} type="button" onClick={() => void einzeln(e, t)} title="Diese Adresse übernehmen"
                        className="rounded-full border border-line-strong bg-white px-2.5 py-1 text-[11px] font-medium text-ink2 transition hover:border-ink/30 hover:text-ink">
                        {zeile(t)}
                      </button>
                    ))}
                    <button type="button" onClick={() => onOeffnen(e.b.id)} className="px-1 text-[11px] font-semibold text-steel hover:underline">selbst suchen</button>
                    <button type="button" onClick={() => stand(e.b.id, 'weg')} className="px-1 text-[11px] font-semibold text-ink3 hover:text-ink">überspringen</button>
                  </span>
                )}
                {e.stand === 'weg' && <span className="text-[11px] text-ink3">übersprungen</span>}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-ink3">Adressen: Adressverzeichnis des Bundes, © swisstopo</p>
        </>
      )}
    </section>
  );
}
