import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { formatChf, materialmiete, ETAPPE_MIN_RAPPEN } from '../lib/tarif';

/**
 * Phase 4 — der einzelne Regierapport:
 * Positionen prüfen, Etappe/Materialmiete zuschalten, SORBA-PDF anhängen,
 * versenden (fester Betreff, Frist +3 Tage), danach die Zustell-Chronik.
 * Der verbindliche Beleg bleibt das SORBA-Dokument im Anhang.
 */

interface Rapport {
  id: string;
  status: string;
  betrag_rappen: number | null;
  frist_bis: string | null;
  versendet_am: string | null;
  bestaetigt_am: string | null;
  empfaenger_email: string | null;
  anhang_pfad: string | null;
  link_token: string;
  baustelle: { bezeichnung: string | null; konto_nr: string; kunde: { email: string | null; ansprechperson: string | null } | null } | null;
}

interface Position {
  id: string;
  tarif_code: string;
  bezeichnung: string;
  betrag_rappen: number;
}

interface LogZeile {
  id: string;
  ereignis: string;
  zeitpunkt: string;
  an: string;
}

const EREIGNIS_LABEL: Record<string, string> = {
  gesendet: 'Mail gesendet',
  zugestellt: 'zugestellt',
  geoeffnet: 'geöffnet',
  link_geklickt: 'Link geöffnet',
  bestaetigt: 'vom Kunden bestätigt',
  rueckfrage: 'Rückfrage des Kunden',
  erinnert: 'Erinnerung gesendet',
};

export function RegieDetail() {
  const { id } = useParams();
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [positionen, setPositionen] = useState<Position[]>([]);
  const [logs, setLogs] = useState<LogZeile[]>([]);
  const [empfaenger, setEmpfaenger] = useState('');
  const [sendet, setSendet] = useState(false);
  const [fehler, setFehler] = useState('');
  const [kopiert, setKopiert] = useState(false);

  const laden = useCallback(async () => {
    if (!supabase || !id) return;
    const [r, p, l] = await Promise.all([
      supabase
        .from('regierapport')
        .select('id,status,betrag_rappen,frist_bis,versendet_am,bestaetigt_am,empfaenger_email,anhang_pfad,link_token,baustelle:baustelle_id(bezeichnung,konto_nr,kunde:kunde_id(email,ansprechperson))')
        .eq('id', id)
        .single(),
      supabase.from('regie_position').select('id,tarif_code,bezeichnung,betrag_rappen').eq('regierapport_id', id),
      supabase.from('zustellung_log').select('id,ereignis,zeitpunkt,an').eq('regierapport_id', id).order('zeitpunkt'),
    ]);
    if (r.data) {
      const rp = r.data as unknown as Rapport;
      setRapport(rp);
      if (rp.empfaenger_email) setEmpfaenger(rp.empfaenger_email);
      else if (rp.baustelle?.kunde?.email) setEmpfaenger(rp.baustelle.kunde.email);
    }
    if (p.data) setPositionen(p.data);
    if (l.data) setLogs(l.data);
  }, [id]);

  useEffect(() => {
    void laden();
  }, [laden]);

  const basis = useMemo(
    () => positionen.filter((p) => p.tarif_code !== 'materialmiete').reduce((s, p) => s + p.betrag_rappen, 0),
    [positionen],
  );
  const mieteZeile = positionen.find((p) => p.tarif_code === 'materialmiete');
  const etappeZeile = positionen.find((p) => p.tarif_code === 'etappe');
  const total = basis + (mieteZeile?.betrag_rappen ?? 0);
  const entwurf = rapport?.status === 'entwurf';

  /** Miete hängt von der Zwischensumme ab — nach jedem Umschalten neu rechnen. */
  async function betragAktualisieren() {
    if (!supabase || !id) return;
    const { data: p } = await supabase
      .from('regie_position')
      .select('id,tarif_code,betrag_rappen')
      .eq('regierapport_id', id);
    const zeilen = p ?? [];
    const neuBasis = zeilen
      .filter((x) => x.tarif_code !== 'materialmiete')
      .reduce((s, x) => s + x.betrag_rappen, 0);
    const miete = zeilen.find((x) => x.tarif_code === 'materialmiete');
    if (miete) {
      const neu = materialmiete(neuBasis);
      await supabase.from('regie_position').update({ betrag_rappen: neu, ansatz_rappen: neu }).eq('id', miete.id);
    }
    const { data: p2 } = await supabase.from('regie_position').select('betrag_rappen').eq('regierapport_id', id);
    const totalNeu = (p2 ?? []).reduce((s, x) => s + x.betrag_rappen, 0);
    await supabase.from('regierapport').update({ betrag_rappen: totalNeu }).eq('id', id);
    void laden();
  }

  async function etappeUmschalten() {
    if (!supabase || !id || !entwurf) return;
    if (etappeZeile) {
      await supabase.from('regie_position').delete().eq('id', etappeZeile.id);
    } else {
      await supabase.from('regie_position').insert({
        regierapport_id: id,
        tarif_code: 'etappe',
        bezeichnung: 'Etappenzuschlag',
        menge_hundertstel: 100,
        ansatz_rappen: ETAPPE_MIN_RAPPEN,
        betrag_rappen: ETAPPE_MIN_RAPPEN,
      });
    }
    await betragAktualisieren();
  }

  async function mieteUmschalten() {
    if (!supabase || !id || !entwurf) return;
    if (mieteZeile) {
      await supabase.from('regie_position').delete().eq('id', mieteZeile.id);
    } else {
      const betrag = materialmiete(basis);
      await supabase.from('regie_position').insert({
        regierapport_id: id,
        tarif_code: 'materialmiete',
        bezeichnung: 'Materialmiete 9 %',
        menge_hundertstel: 100,
        ansatz_rappen: betrag,
        betrag_rappen: betrag,
      });
    }
    await betragAktualisieren();
  }

  async function anhangWaehlen(e: ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0];
    if (!supabase || !id || !datei) return;
    const pfad = `${id}/${datei.name}`;
    const { error } = await supabase.storage.from('anhaenge').upload(pfad, datei, { upsert: true });
    if (error) {
      setFehler('Anhang: ' + error.message);
      return;
    }
    await supabase.from('regierapport').update({ anhang_pfad: pfad }).eq('id', id);
    void laden();
  }

  async function senden() {
    if (!supabase || !id) return;
    setFehler('');
    if (!empfaenger.trim().includes('@')) {
      setFehler('E-Mail der Bauleitung eintragen.');
      return;
    }
    setSendet(true);
    const { data, error } = await supabase.functions.invoke('regierapport-senden', {
      body: { regierapport_id: id, empfaenger_email: empfaenger.trim(), basis_url: window.location.origin },
    });
    setSendet(false);
    const antwortFehler = (data as { fehler?: string } | null)?.fehler;
    if (error || antwortFehler) {
      setFehler(antwortFehler ?? error?.message ?? 'Versand fehlgeschlagen.');
      return;
    }
    void laden();
  }

  function linkKopieren() {
    if (!rapport) return;
    void navigator.clipboard
      .writeText(`${window.location.origin}/b/${rapport.link_token}`)
      .then(() => {
        setKopiert(true);
        setTimeout(() => setKopiert(false), 2000);
      });
  }

  if (!rapport) {
    return (
      <Shell zurueck>
        <div className="card text-sm text-ink3">Lädt …</div>
      </Shell>
    );
  }

  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header>
          <p className="lbl mb-1">Regierapport</p>
          <h1 className="font-display text-2xl font-bold">
            {rapport.baustelle?.bezeichnung ?? '—'}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-ink3">
            {rapport.baustelle && <span className="knr">{rapport.baustelle.konto_nr}</span>}
            <span>{rapport.status === 'entwurf' ? 'Entwurf' : rapport.status}</span>
            {rapport.frist_bis && rapport.status === 'versendet' && (
              <span>· Frist bis {rapport.frist_bis}</span>
            )}
          </p>
        </header>

        <section className="card">
          <p className="lbl">Positionen · SGUV 2026/27</p>
          <div className="divide-y divide-line">
            {positionen.map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-2 py-1.5 text-sm">
                <span>{p.bezeichnung}</span>
                <span className="font-mono tabular-nums">{formatChf(p.betrag_rappen)}</span>
              </div>
            ))}
          </div>
          {entwurf && (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => void etappeUmschalten()} className={'chip ' + (etappeZeile ? 'chip-on' : '')}>
                Etappenzuschlag
              </button>
              <button type="button" onClick={() => void mieteUmschalten()} className={'chip ' + (mieteZeile ? 'chip-on' : '')}>
                Materialmiete 9 %
              </button>
            </div>
          )}
          <div className="mt-3 flex items-baseline justify-between border-t border-line-strong pt-2.5">
            <span className="font-display font-bold">Total</span>
            <span className="font-mono text-lg font-semibold text-accent-deep tabular-nums">
              {formatChf(total)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink3">
            Vorgerechnet als Entscheidungshilfe — der verbindliche Beleg ist das SORBA-Dokument im Anhang.
          </p>
        </section>

        {entwurf ? (
          <section className="card space-y-3 p-5">
            <div>
              <label className="lbl">Anhang (Regierapport aus SORBA)</label>
              {rapport.anhang_pfad ? (
                <p className="text-sm">
                  📎 {rapport.anhang_pfad.split('/').pop()}{' '}
                  <label className="ml-1 cursor-pointer text-xs text-steel underline">
                    ersetzen
                    <input type="file" className="hidden" onChange={(e) => void anhangWaehlen(e)} />
                  </label>
                </p>
              ) : (
                <label className="block cursor-pointer rounded-[10px] border border-dashed border-line-strong px-3.5 py-3 text-center text-sm text-ink3 hover:border-ink3">
                  Datei wählen — aus SORBA gespeichert
                  <input type="file" className="hidden" onChange={(e) => void anhangWaehlen(e)} />
                </label>
              )}
              <p className="mt-1 text-[11px] text-ink3">
                Ohne Anhang geht die Mail trotzdem raus — für Tests okay, für echte Kunden nicht.
              </p>
            </div>
            <div>
              <label className="lbl">E-Mail der Bauleitung</label>
              <input
                type="email"
                value={empfaenger}
                onChange={(e) => setEmpfaenger(e.target.value)}
                placeholder="bauleitung@firma.ch"
                className="field"
              />
            </div>
            <button type="button" onClick={() => void senden()} disabled={sendet} className="cta">
              {sendet ? 'Sendet …' : 'Regierapport senden'}
            </button>
            {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
            <p className="text-[11px] text-ink3">
              Fester Betreff «Regie {rapport.baustelle?.bezeichnung} · {rapport.baustelle?.konto_nr}»,
              Frist läuft ab Versand 3 Tage.
            </p>
          </section>
        ) : (
          <section className="card space-y-2">
            <p className="lbl">Verlauf</p>
            {logs.length === 0 && <p className="text-sm text-ink3">Noch keine Ereignisse.</p>}
            {logs.map((l) => (
              <div key={l.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span>{EREIGNIS_LABEL[l.ereignis] ?? l.ereignis}</span>
                <span className="font-mono text-xs text-ink3">
                  {new Date(l.zeitpunkt).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={linkKopieren} className="btn-ghost">
                {kopiert ? 'Kopiert ✓' : 'Kundenlink kopieren'}
              </button>
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}
