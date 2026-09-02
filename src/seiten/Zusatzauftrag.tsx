import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
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

interface Auftrag {
  id: string;
  besteller_name: string;
  kanal: string;
  taetigkeit: string;
  geplant_fuer: string | null;
  bestellt_am: string;
  status: string;
  notiz: string | null;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
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

const STATUS_LABEL: Record<string, string> = {
  offen: 'offen',
  ausgefuehrt: 'ausgeführt',
  abgerechnet: 'abgerechnet',
};

const STATUS_STIL: Record<string, string> = {
  offen: 'bg-accent-soft text-accent-deep',
  ausgefuehrt: 'bg-steel-soft text-steel',
  abgerechnet: 'bg-good-soft text-good-deep',
};

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

  async function ladeListe() {
    void offeneAuftraege().then(setLokal);
    if (!supabase) return;
    const { data } = await supabase
      .from('zusatzauftrag')
      .select(
        'id,besteller_name,kanal,taetigkeit,geplant_fuer,bestellt_am,status,notiz,baustelle(konto_nr,bezeichnung)',
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

  async function statusWeiter(a: Auftrag) {
    if (!supabase) return;
    const naechster = a.status === 'offen' ? 'ausgefuehrt' : 'abgerechnet';
    await supabase.from('zusatzauftrag').update({ status: naechster }).eq('id', a.id);
    void ladeListe();
  }

  return (
    <Shell zurueck>
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
            <div key={a.id} className="card">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[15px] font-bold">
                  {a.baustelle?.bezeichnung ?? '—'}
                </span>
                <span
                  className={
                    'rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ' +
                    (STATUS_STIL[a.status] ?? 'bg-ground text-ink3')
                  }
                >
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink2">
                {a.baustelle && <span className="knr">{a.baustelle.konto_nr}</span>}
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
              {a.status !== 'abgerechnet' && (
                <button
                  type="button"
                  onClick={() => void statusWeiter(a)}
                  className="btn-ghost mt-2.5"
                >
                  {a.status === 'offen' ? '→ ausgeführt' : '→ abgerechnet'}
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
    </Shell>
  );
}
