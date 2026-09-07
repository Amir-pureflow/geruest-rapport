import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { FotoGalerie } from '../ui/FotoGalerie';
import { fotoVerkleinern } from '../lib/foto';
import { supabase } from '../lib/supabase';
import { formatChf, materialmiete, tarifNachCode, positionBetrag, ETAPPE_MIN_RAPPEN } from '../lib/tarif';

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
  /** Ursprung: die Tagesmeldung, aus der der Rapport gerechnet wurde (bei alten Rapporten evtl. leer). */
  tagesmeldung: {
    id: string;
    datum: string;
    abweichung_typ: string | null;
    wer_hats_gewollt: string | null;
    transkript: string | null;
    audio_pfad: string | null;
    audio_sekunden: number | null;
    team: { id: string; bezeichnung: string; chefmonteur: { name: string } | null } | null;
    zeiteintrag: { normal_min: number; ueber_min: number; status: string; mitarbeiter: { name: string } | null }[];
    foto: { id: string; pfad: string }[];
  } | null;
  /** Vom Bauführer nachgereichte Bilder direkt am Rapport */
  foto: { id: string; pfad: string }[];
  zusatzauftrag: { besteller_name: string; kanal: string; taetigkeit: string; geplant_fuer: string | null; bestellt_am: string; notiz: string | null } | null;
}

const STATUS_TEXT: Record<string, string> = {
  entwurf: 'Entwurf',
  versendet: 'versendet',
  bestaetigt: 'bestätigt',
  rueckfrage: 'Rückfrage',
  frist_abgelaufen: 'Frist abgelaufen',
};

const ABWEICHUNG_TEXT: Record<string, string> = { zusaetzlich: 'zusätzliche Arbeit', warten: 'Wartezeit', kaputt: 'etwas kaputt' };
const WER_TEXT: Record<string, string> = { kunde: 'der Kunde wollte es', chef: 'der Chef wollte es', niemand: 'niemand hat es verlangt' };
const KANAL_TEXT: Record<string, string> = { telefon: 'per Telefon', mail: 'per Mail', vor_ort: 'vor Ort' };

function tagKurz(isoDatum: string): string {
  const d = new Date(isoDatum + 'T12:00:00');
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

interface Position {
  id: string;
  tarif_code: string;
  bezeichnung: string;
  menge_hundertstel: number;
  ansatz_rappen: number;
  betrag_rappen: number;
}

const FIXE_POSITIONEN = new Set(['etappe', 'materialmiete']);

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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [fotoLaedt, setFotoLaedt] = useState(false);
  /** Bilder nachreichen — z. B. vom Bauführer selbst gemacht oder per Mail vom Team bekommen. */
  async function fotosNachreichen(e: ChangeEvent<HTMLInputElement>) {
    const dateien = e.target.files;
    e.target.value = '';
    if (!supabase || !id || !dateien || dateien.length === 0) return;
    setFotoLaedt(true);
    const { data: u } = await supabase.auth.getUser();
    for (const datei of Array.from(dateien).slice(0, 6)) {
      try {
        const blob = await fotoVerkleinern(datei);
        const fid = crypto.randomUUID();
        const pfad = `fotos/rapport/${id}/${fid}.jpg`;
        const { error: e1 } = await supabase.storage.from('anhaenge').upload(pfad, blob, { upsert: true, contentType: 'image/jpeg' });
        if (e1) { setFehler('Foto: ' + e1.message); break; }
        const { error: e2 } = await supabase.from('foto').insert({ id: fid, regierapport_id: id, pfad, erstellt_von: u.user?.id ?? null });
        if (e2) { setFehler('Foto: ' + e2.message); break; }
      } catch {
        setFehler('Ein Bild konnte nicht gelesen werden.');
      }
    }
    setFotoLaedt(false);
    void laden();
  }

  async function sprachnotizAnhoeren(pfad: string) {
    if (!supabase) return;
    const { data } = await supabase.storage.from('anhaenge').createSignedUrl(pfad, 300);
    if (data?.signedUrl) setAudioUrl(data.signedUrl);
  }

  const laden = useCallback(async () => {
    if (!supabase || !id) return;
    const [r, p, l] = await Promise.all([
      supabase
        .from('regierapport')
        .select('id,status,betrag_rappen,frist_bis,versendet_am,bestaetigt_am,empfaenger_email,anhang_pfad,link_token,baustelle:baustelle_id(bezeichnung,konto_nr,kunde:kunde_id(email,ansprechperson)),tagesmeldung:tagesmeldung_id(id,datum,abweichung_typ,wer_hats_gewollt,transkript,audio_pfad,audio_sekunden,team:team_id(id,bezeichnung,chefmonteur:chefmonteur_id(name)),zeiteintrag(normal_min,ueber_min,status,mitarbeiter:mitarbeiter_id(name)),foto(id,pfad)),foto(id,pfad),zusatzauftrag:zusatzauftrag_id(besteller_name,kanal,taetigkeit,geplant_fuer,bestellt_am,notiz)')
        .eq('id', id)
        .single(),
      supabase.from('regie_position').select('id,tarif_code,bezeichnung,menge_hundertstel,ansatz_rappen,betrag_rappen').eq('regierapport_id', id),
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
  const fahrzeugZeile = positionen.find((p) => p.tarif_code === 'lieferwagen_35');
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

  /** Der Lieferwagen ist im Regiefall eine Preisposition wie eine Arbeitsstunde — und wird heute leicht vergessen. */
  async function fahrzeugUmschalten() {
    if (!supabase || !id || !entwurf) return;
    if (fahrzeugZeile) {
      await supabase.from('regie_position').delete().eq('id', fahrzeugZeile.id);
    } else {
      const ansatz = tarifNachCode('lieferwagen_35').ansatz_rappen;
      await supabase.from('regie_position').insert({
        regierapport_id: id,
        tarif_code: 'lieferwagen_35',
        bezeichnung: 'Lieferwagen bis 3,5 t · 1.0 h',
        menge_hundertstel: 100,
        ansatz_rappen: ansatz,
        betrag_rappen: ansatz,
      });
    }
    await betragAktualisieren();
  }

  /**
   * «Wie viel davon ist Regie?» — das entscheidet der Bauführer, nicht das System.
   * Stunden pro Position in Halbstundenschritten anpassen; Betrag rechnet nach Tarif.
   */
  async function stundenAnpassen(p: Position, deltaHundertstel: number) {
    if (!supabase || !id || !entwurf) return;
    const menge = Math.max(0, p.menge_hundertstel + deltaHundertstel);
    if (menge === p.menge_hundertstel) return;
    const betrag = positionBetrag({ code: p.tarif_code, bezeichnung: p.bezeichnung, mengeHundertstel: menge, ansatzRappen: p.ansatz_rappen });
    const bezeichnung = p.bezeichnung.replace(/\d+(\.\d)? h$/, `${(menge / 100).toFixed(1)} h`);
    await supabase.from('regie_position').update({ menge_hundertstel: menge, betrag_rappen: betrag, bezeichnung }).eq('id', p.id);
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
            <span>{STATUS_TEXT[rapport.status] ?? rapport.status}</span>
            {rapport.frist_bis && rapport.status === 'versendet' && (
              <span>· Frist bis {rapport.frist_bis}</span>
            )}
          </p>
        </header>

        {/* Ursprung: woher die Zahlen kommen — Tagesmeldung des Teams und die Bestellung des Kunden */}
        {(rapport.tagesmeldung || rapport.zusatzauftrag) && (
          <section className="card space-y-3">
            <p className="lbl mb-0">Ursprung</p>
            {rapport.tagesmeldung && (() => {
              const m = rapport.tagesmeldung;
              const total = m.zeiteintrag.reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
              return (
                <div className="space-y-1.5 text-sm">
                  <p>
                    <strong>Tagesmeldung {tagKurz(m.datum)}</strong>
                    {m.team && <> · {m.team.bezeichnung}{m.team.chefmonteur ? ` (${m.team.chefmonteur.name})` : ''}</>}
                  </p>
                  <p className="text-ink2">
                    Team meldet: <strong>{ABWEICHUNG_TEXT[m.abweichung_typ ?? ''] ?? m.abweichung_typ ?? '—'}</strong>
                    {m.wer_hats_gewollt && <> · {WER_TEXT[m.wer_hats_gewollt] ?? m.wer_hats_gewollt}</>}
                  </p>
                  {m.zeiteintrag.length > 0 && (
                    <p className="text-ink2">
                      {m.zeiteintrag.map((z) => `${z.mitarbeiter?.name ?? '?'} ${((z.normal_min + z.ueber_min) / 60).toFixed(1)} h`).join(' · ')}
                      <span className="text-ink3"> · zusammen {(total / 60).toFixed(1)} h</span>
                    </p>
                  )}
                  {m.foto?.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] text-ink3">Fotos vom Team · {m.foto.length}</p>
                      <FotoGalerie pfade={m.foto.map((f) => f.pfad)} />
                    </div>
                  )}
                  {m.transkript && <p className="rounded-[10px] bg-ground px-3 py-2 italic text-ink2">«{m.transkript}»</p>}
                  {(m.audio_pfad || m.audio_sekunden) && (
                    <div className="flex items-center gap-2">
                      {m.audio_pfad ? (
                        <button type="button" onClick={() => void sprachnotizAnhoeren(m.audio_pfad!)} className="btn-ghost">▶ Sprachnotiz{m.audio_sekunden ? ` · ${m.audio_sekunden} Sek.` : ''}</button>
                      ) : (
                        <span className="font-mono text-[11px] text-ink3">Sprachnotiz {m.audio_sekunden} Sek. (Demo — keine Aufnahme hinterlegt)</span>
                      )}
                      {audioUrl && <audio controls autoPlay src={audioUrl} className="h-8 flex-1" />}
                    </div>
                  )}
                  {m.team && (
                    <Link to={`/cockpit?woche=${m.datum}&tag=${m.datum}&team=${m.team.id}&meldung=${m.id}&rapport=${rapport.id}`} className="inline-block font-semibold text-steel">
                      Diese Woche in der Wochenübersicht anschauen ›
                    </Link>
                  )}
                </div>
              );
            })()}
            {rapport.zusatzauftrag && (
              <div className="border-t border-line pt-2.5 text-sm">
                <p>
                  <strong>Bestellt von {rapport.zusatzauftrag.besteller_name}</strong> {KANAL_TEXT[rapport.zusatzauftrag.kanal] ?? rapport.zusatzauftrag.kanal}
                  {' '}am {tagKurz(rapport.zusatzauftrag.bestellt_am.slice(0, 10))}
                </p>
                <p className="text-ink2">
                  {rapport.zusatzauftrag.taetigkeit}
                  {rapport.zusatzauftrag.geplant_fuer && <> · geplant für {tagKurz(rapport.zusatzauftrag.geplant_fuer)}</>}
                  {rapport.zusatzauftrag.notiz && <> · {rapport.zusatzauftrag.notiz}</>}
                </p>
                <Link to="/zusatzauftrag" className="mt-1 inline-block text-xs font-semibold text-steel">Zu den Zusatzaufträgen ›</Link>
              </div>
            )}
            {!rapport.tagesmeldung && (
              <p className="text-xs text-ink3">Zu diesem Rapport ist keine Tagesmeldung verknüpft (älterer Rapport).</p>
            )}
          </section>
        )}

        <section className="card space-y-2">
          <p className="lbl mb-0">Bilder zum Rapport</p>
          {rapport.foto?.length > 0
            ? <FotoGalerie pfade={rapport.foto.map((f) => f.pfad)} />
            : <p className="text-xs text-ink3">{rapport.tagesmeldung?.foto?.length ? 'Die Bilder des Teams stehen oben beim Ursprung.' : 'Noch keine Bilder — der Kunde will sehen, was gemacht wurde.'}</p>}
          <label className="btn-ghost inline-block cursor-pointer">
            {fotoLaedt ? 'lädt …' : '+ Bilder nachreichen'}
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void fotosNachreichen(e)} />
          </label>
        </section>

        <section className="card">
          <p className="lbl">Positionen · SGUV 2026/27</p>
          <div className="divide-y divide-line">
            {positionen.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="min-w-0 truncate">{p.bezeichnung}</span>
                <span className="flex flex-none items-center gap-1.5">
                  {entwurf && !FIXE_POSITIONEN.has(p.tarif_code) && (
                    <>
                      <button type="button" onClick={() => void stundenAnpassen(p, -50)} className="btn-ghost px-2 py-0.5" title="−0.5 h">−</button>
                      <button type="button" onClick={() => void stundenAnpassen(p, 50)} className="btn-ghost px-2 py-0.5" title="+0.5 h">+</button>
                    </>
                  )}
                  <span className="w-24 text-right font-mono tabular-nums">{formatChf(p.betrag_rappen)}</span>
                </span>
              </div>
            ))}
          </div>
          {entwurf && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void fahrzeugUmschalten()} className={'chip ' + (fahrzeugZeile ? 'chip-on' : '')}>
                Lieferwagen 1 h
              </button>
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
            {entwurf && ' Mit − / + nur die Stunden stehen lassen, die wirklich Zusatzarbeit waren.'}
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
