import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { ausIso, kurz } from '../lib/datum';
import {
  enqueueZusatzauftrag,
  flushNachSupabase,
  offeneAuftraege,
  type LokalerAuftrag,
} from '../lib/db';

/**
 * Stufe 1 — der Geldwert: Die Kundenbestellung wird eingetippt,
 * während der Bauleiter noch am Telefon ist. Vier Angaben, 20 Sekunden.
 * Schreibt in die Offline-Queue (CLAUDE.md #4) und sendet sofort, wenn Netz da ist.
 */

interface Baustelle {
  id: string;
  konto_nr: string;
  bezeichnung: string | null;
}

/** Zeile aus der Sicht zusatzauftrag_stand — der Stand ist abgeleitet, nicht geklickt. */
interface Auftrag {
  id: string;
  besteller_name: string;
  kanal: string;
  taetigkeit: string;
  geplant_fuer: string | null;
  bestellt_am: string;
  status: 'offen' | 'erledigt_ohne_regie';
  notiz: string | null;
  konto_nr: string;
  baustelle_bezeichnung: string | null;
  stand: 'bestellt' | 'gemeldet' | 'im_regierapport' | 'beim_kunden' | 'bestaetigt' | 'erledigt_ohne_regie';
  gemeldet_am: string | null;
  gemeldet_von_team: string | null;
  regierapport_id: string | null;
  regierapport_nummer: string | null;
  regierapport_status: string | null;
  ohne_meldung: boolean;
  erledigt_grund: string | null;
  erledigt_am: string | null;
}

const TAETIGKEITEN = [
  ['versetzen', 'versetzen'],
  ['ergaenzen', 'ergänzen'],
  ['reparieren', 'reparieren'],
  ['teilabbau', 'Teilabbau'],
  ['reinigen', 'reinigen'],
  ['anderes', 'anderes'],
] as const;

const KANAELE = [
  ['telefon', 'Telefon'],
  ['mail', 'Mail'],
  ['vor_ort', 'vor Ort'],
] as const;

// Stand kommt aus Meldung und Regierapport (Sicht zusatzauftrag_stand). Einziger Handgriff: «erledigt ohne Regie».
const STAND_LABEL: Record<Auftrag['stand'], string> = {
  bestellt: 'bestellt',
  gemeldet: 'gemeldet',
  im_regierapport: 'im Regierapport',
  beim_kunden: 'beim Kunden',
  bestaetigt: 'bestätigt',
  erledigt_ohne_regie: 'erledigt ohne Regie',
};

const STAND_STIL: Record<Auftrag['stand'], string> = {
  bestellt: 'bg-accent-soft text-accent-deep',
  gemeldet: 'bg-amber-100 text-amber-900',
  im_regierapport: 'bg-steel-soft text-steel',
  beim_kunden: 'bg-steel-soft text-steel',
  bestaetigt: 'bg-good-soft text-good-deep',
  erledigt_ohne_regie: 'bg-ground text-ink3',
};

const GRUENDE = [
  ['abgesagt', 'Kunde hat abgesagt'],
  ['pauschale', 'war in der Pauschale'],
  ['kulanz', 'kulant, ohne Rechnung'],
  ['doppelt', 'doppelt erfasst'],
] as const;

const GRUND_LABEL: Record<string, string> = Object.fromEntries(GRUENDE);

// Baustellenliste lokal vorhalten, damit das Formular auch ohne Netz aufgeht.
// Kommt Netz zurück, wird der Cache beim nächsten Laden erneuert.
const CACHE_KEY = 'baustellen-cache-v1';

export function Zusatzauftrag() {
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [suche, setSuche] = useState('');
  const [gewaehlt, setGewaehlt] = useState<Baustelle | null>(null);
  const [besteller, setBesteller] = useState('');
  const [kanal, setKanal] = useState<string>('telefon');
  const [taetigkeit, setTaetigkeit] = useState<string>('versetzen');
  const [geplant, setGeplant] = useState('');
  const [notiz, setNotiz] = useState('');
  const [gespeichert, setGespeichert] = useState(false);
  const [fehler, setFehler] = useState('');
  const [liste, setListe] = useState<Auftrag[]>([]);
  const [lokal, setLokal] = useState<LokalerAuftrag[]>([]);
  const [erledigen, setErledigen] = useState<string | null>(null); // Auftrag, für den gerade der Grund gewählt wird
  const [userId, setUserId] = useState<string | null>(null);

  async function ladeListe() {
    void offeneAuftraege().then(setLokal);
    if (!supabase) return;
    const { data } = await supabase
      .from('zusatzauftrag_stand')
      .select(
        'id,besteller_name,kanal,taetigkeit,geplant_fuer,bestellt_am,status,notiz,konto_nr,baustelle_bezeichnung,stand,gemeldet_am,gemeldet_von_team,regierapport_id,regierapport_nummer,regierapport_status,ohne_meldung,erledigt_grund,erledigt_am',
      )
      .order('bestellt_am', { ascending: false })
      .limit(50);
    if (data) setListe(data as unknown as Auftrag[]);
  }

  useEffect(() => {
    try {
      const c = localStorage.getItem(CACHE_KEY);
      if (c) setBaustellen(JSON.parse(c) as Baustelle[]);
    } catch {
      /* Cache nicht verfügbar — dann eben nur online */
    }
    if (supabase) {
      void supabase
        .from('baustelle')
        .select('id,konto_nr,bezeichnung')
        .order('bezeichnung')
        .then(({ data }) => {
          if (data) {
            setBaustellen(data);
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            } catch {
              /* voll oder blockiert — unkritisch */
            }
          }
        });
    }
    void ladeListe();
    if (supabase) void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return [];
    return baustellen
      .filter(
        (b) =>
          (b.bezeichnung ?? '').toLowerCase().includes(q) || b.konto_nr.includes(q),
      )
      .slice(0, 8);
  }, [suche, baustellen]);

  async function speichern() {
    setFehler('');
    if (!gewaehlt) {
      setFehler('Zuerst die Baustelle wählen.');
      return;
    }
    if (!besteller.trim()) {
      setFehler('Wer hat die Arbeit verlangt? Name eintragen.');
      return;
    }
    await enqueueZusatzauftrag({
      baustelle_id: gewaehlt.id,
      besteller_name: besteller.trim(),
      kanal,
      taetigkeit,
      geplant_fuer: geplant || null,
      notiz: notiz.trim() || null,
      status: 'offen',
    });
    if (supabase) await flushNachSupabase(supabase);
    setGespeichert(true);
    setTimeout(() => setGespeichert(false), 2500);
    setGewaehlt(null);
    setSuche('');
    setBesteller('');
    setGeplant('');
    setNotiz('');
    setTaetigkeit('versetzen');
    setKanal('telefon');
    void ladeListe();
  }

  /** Der einzige Handgriff: bestellt, aber es gibt keine Regie — mit Pflichtgrund, wer, wann. */
  async function ohneRegieErledigen(a: Auftrag, grund: string) {
    if (!supabase) return;
    await supabase
      .from('zusatzauftrag')
      .update({ status: 'erledigt_ohne_regie', erledigt_grund: grund, erledigt_am: new Date().toISOString(), erledigt_von: userId })
      .eq('id', a.id);
    setErledigen(null);
    void ladeListe();
  }

  /** Versehentlich erledigt → wieder offen; der Stand ergibt sich dann wieder aus den Daten. */
  async function wiederOeffnen(a: Auftrag) {
    if (!supabase) return;
    await supabase
      .from('zusatzauftrag')
      .update({ status: 'offen', erledigt_grund: null, erledigt_am: null, erledigt_von: null })
      .eq('id', a.id);
    void ladeListe();
  }

  return (
    <Shell zurueck schmal>
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold">Zusatzarbeit</h1>

        <section className="card space-y-4 p-5">
          <div>
            <label className="lbl">Baustelle</label>
            {gewaehlt ? (
              <button
                type="button"
                onClick={() => {
                  setGewaehlt(null);
                  setSuche('');
                }}
                className="w-full rounded-[10px] border border-accent bg-accent-soft px-3.5 py-2.5 text-left"
              >
                <span className="font-display font-bold">{gewaehlt.bezeichnung}</span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-ink3">
                  <span className="knr">{gewaehlt.konto_nr}</span>
                  antippen zum Ändern
                </span>
              </button>
            ) : (
              <>
                <input
                  value={suche}
                  onChange={(e) => setSuche(e.target.value)}
                  placeholder="Strasse oder Nummer eintippen …"
                  className="field"
                />
                {treffer.length > 0 && (
                  <div className="mt-1.5 overflow-hidden rounded-[10px] border border-line divide-y divide-line">
                    {treffer.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setGewaehlt(b)}
                        className="flex w-full items-center justify-between gap-2 bg-surface px-3.5 py-2.5 text-left text-sm hover:bg-ground"
                      >
                        <span className="font-medium">{b.bezeichnung}</span>
                        <span className="knr">{b.konto_nr}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="lbl">Wer verlangt es?</label>
            <input
              value={besteller}
              onChange={(e) => setBesteller(e.target.value)}
              placeholder="z. B. M. Huber, Bauleitung"
              className="field"
            />
            <div className="mt-2 flex gap-2">
              {KANAELE.map(([wert, label]) => (
                <button
                  key={wert}
                  type="button"
                  onClick={() => setKanal(wert)}
                  className={'chip px-3.5 ' + (kanal === wert ? 'chip-on' : '')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="lbl">Was ist zu tun?</label>
            <div className="grid grid-cols-3 gap-2">
              {TAETIGKEITEN.map(([wert, label]) => (
                <button
                  key={wert}
                  type="button"
                  onClick={() => setTaetigkeit(wert)}
                  className={'chip ' + (taetigkeit === wert ? 'chip-on' : '')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="lbl">Geplant für</label>
              <input
                type="date"
                value={geplant}
                onChange={(e) => setGeplant(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className="lbl">Notiz (optional)</label>
              <input
                value={notiz}
                onChange={(e) => setNotiz(e.target.value)}
                placeholder="z. B. Maurer blockiert"
                className="field"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => void speichern()}
            className={'cta ' + (gespeichert ? 'cta-good' : '')}
          >
            {gespeichert ? 'Gespeichert ✓' : 'Speichern'}
          </button>
          {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
          <p className="text-xs text-ink3">
            Ohne Netz wird lokal gespeichert und automatisch gesendet, sobald
            Empfang da ist.
          </p>
        </section>

        <section className="space-y-2.5">
          <h2 className="lbl mb-0">Zusatzaufträge</h2>

          {lokal.map((e) => (
            <div
              key={e.client_uuid}
              className="rounded-[14px] border border-dashed border-line-strong p-3.5 text-sm text-ink3"
            >
              ⏳ wird gesendet, sobald Netz da ist
            </div>
          ))}

          {liste.length === 0 && lokal.length === 0 && (
            <div className="card text-sm text-ink3">
              Noch keine — der nächste Kundenanruf landet hier.
            </div>
          )}

          {liste.map((a) => (
            <div key={a.id} className={'card ' + (a.ohne_meldung ? 'border-accent/40' : '')}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[15px] font-bold">
                  {a.baustelle_bezeichnung ?? a.konto_nr}
                </span>
                <span
                  className={
                    'rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ' +
                    (STAND_STIL[a.stand] ?? 'bg-ground text-ink3')
                  }
                >
                  {STAND_LABEL[a.stand] ?? a.stand}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink2">
                <span className="knr">{a.konto_nr}</span>
                <span>{a.taetigkeit}</span>
                <span className="text-ink3">·</span>
                <span>{a.besteller_name}</span>
                {a.geplant_fuer && (
                  <>
                    <span className="text-ink3">·</span>
                    <span>geplant {a.geplant_fuer}</span>
                  </>
                )}
                {a.notiz && (
                  <>
                    <span className="text-ink3">·</span>
                    <span className="text-ink3">{a.notiz}</span>
                  </>
                )}
              </p>

              {/* Woher der Stand kommt — benannte Quelle statt Urteil */}
              <p className="mt-1.5 text-xs text-ink3">
                {a.stand === 'gemeldet' && a.gemeldet_am && (
                  <>gemeldet am {kurz(ausIso(a.gemeldet_am))}{a.gemeldet_von_team ? ` von ${a.gemeldet_von_team}` : ''} — Regierapport in der Wochenübersicht erstellen</>
                )}
                {(a.stand === 'im_regierapport' || a.stand === 'beim_kunden' || a.stand === 'bestaetigt') && a.regierapport_id && (
                  <Link to={`/regie/${a.regierapport_id}`} className="font-semibold text-steel">
                    Regierapport {a.regierapport_nummer ?? ''} ›
                  </Link>
                )}
                {a.stand === 'bestellt' && a.ohne_meldung && (
                  <span className="font-semibold text-accent-deep">geplant {a.geplant_fuer ? kurz(ausIso(a.geplant_fuer)) : ''}, bis jetzt keine Meldung vom Team — nachfragen?</span>
                )}
                {a.stand === 'bestellt' && !a.ohne_meldung && <>wartet auf die Meldung des Teams</>}
                {a.stand === 'erledigt_ohne_regie' && (
                  <>{GRUND_LABEL[a.erledigt_grund ?? ''] ?? a.erledigt_grund}{a.erledigt_am ? ` · ${kurz(new Date(a.erledigt_am))}` : ''}</>
                )}
              </p>

              {(a.stand === 'bestellt' || a.stand === 'gemeldet') && erledigen !== a.id && (
                <button type="button" onClick={() => setErledigen(a.id)} className="btn-ghost mt-2.5 text-xs">
                  erledigt ohne Regie …
                </button>
              )}
              {erledigen === a.id && (
                <div className="mt-2.5 space-y-2 rounded-[12px] bg-ground p-3">
                  <p className="text-xs font-semibold">Warum gibt es keine Regie?</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {GRUENDE.map(([code, text]) => (
                      <button key={code} type="button" onClick={() => void ohneRegieErledigen(a, code)} className="chip text-xs">
                        {text}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setErledigen(null)} className="text-xs text-ink3">Abbrechen</button>
                </div>
              )}
              {a.stand === 'erledigt_ohne_regie' && (
                <button type="button" onClick={() => void wiederOeffnen(a)} className="btn-ghost mt-2.5 text-xs">
                  wieder öffnen
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
    </Shell>
  );
}
