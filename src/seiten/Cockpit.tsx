import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { minutenBetrag, formatChf, tarifNachCode } from '../lib/tarif';

/**
 * Phase 3 — Wochenübersicht des Bauführers.
 *
 * Harte Regel #1: Das System sagt NIE «diese Stunden sind falsch».
 * Jede Markierung nennt ihre Quelle («weicht ab von X», «offener Zusatzauftrag»)
 * — entscheiden tut der Bauführer. Jede Korrektur landet im freigabe_log.
 */

interface Eintrag {
  id: string;
  normal_min: number;
  ueber_min: number;
  status: string;
  mitarbeiter: { id: string; name: string; funktion: string; typ: string };
  tagesmeldung: {
    id: string;
    datum: string;
    normalfall: boolean;
    abweichung_typ: string | null;
    wer_hats_gewollt: string | null;
    transkript: string | null;
    audio_pfad: string | null;
    audio_sekunden: number | null;
    team: { id: string; bezeichnung: string } | null;
    baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null;
  };
}

interface Team { id: string; bezeichnung: string }

interface OffenerAuftrag {
  id: string;
  baustelle_id: string;
  taetigkeit: string;
  besteller_name: string;
  geplant_fuer: string | null;
}

type ZellStatus = 'leer' | 'gruen' | 'gelb' | 'rot' | 'frei';

const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ZEHN_STUNDEN_MIN = 600;

function montag(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(12, 0, 0, 0);
  return x;
}
function addTage(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function ch(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}
function stunden(min: number): string {
  return (min / 60).toFixed(1);
}

const ZELL_STIL: Record<ZellStatus, string> = {
  leer: 'text-ink3',
  gruen: 'bg-surface',
  frei: 'bg-good-soft text-good-deep',
  gelb: 'bg-amber-100 text-amber-900',
  rot: 'bg-accent-soft text-accent-deep font-semibold',
};

export function Cockpit() {
  const [wochenStart, setWochenStart] = useState<Date>(() => montag(new Date()));
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [auftraege, setAuftraege] = useState<OffenerAuftrag[]>([]);
  const [gewaehlt, setGewaehlt] = useState<{ mit: string; datum: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const navigiere = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string>(() => localStorage.getItem('cockpit-team') ?? '');
  const [audio, setAudio] = useState<{ meldung: string; url: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('team').select('id,bezeichnung').eq('aktiv', true).then(({ data }) => {
      if (!data) return;
      const s = data.sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
      setTeams(s);
      setTeamId((t) => (t && (t === 'alle' || s.some((x) => x.id === t)) ? t : 'alle'));
    });
  }, []);
  useEffect(() => { if (teamId) localStorage.setItem('cockpit-team', teamId); }, [teamId]);

  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));

  const laden = useCallback(async () => {
    if (!supabase) return;
    setLaedt(true);
    const [z, a] = await Promise.all([
      (() => {
        const q = supabase
          .from('zeiteintrag')
          .select(
            'id,normal_min,ueber_min,status,mitarbeiter:mitarbeiter_id(id,name,funktion,typ),tagesmeldung:tagesmeldung_id!inner(id,datum,normalfall,abweichung_typ,wer_hats_gewollt,transkript,audio_pfad,audio_sekunden,team:team_id(id,bezeichnung),baustelle:baustelle_id(id,konto_nr,bezeichnung))',
          )
          .gte('tagesmeldung.datum', vonIso)
          .lte('tagesmeldung.datum', bisIso);
        return teamId === 'alle' || !teamId ? q : q.eq('tagesmeldung.team_id', teamId);
      })(),
      supabase
        .from('zusatzauftrag')
        .select('id,baustelle_id,taetigkeit,besteller_name,geplant_fuer')
        .eq('status', 'offen'),
    ]);
    if (z.data) setEintraege(z.data as unknown as Eintrag[]);
    if (a.data) setAuftraege(a.data);
    setLaedt(false);
  }, [vonIso, bisIso, teamId]);

  useEffect(() => {
    if (teamId) void laden();
  }, [laden, teamId]);

  async function anhoeren(meldungId: string, pfad: string) {
    if (!supabase) return;
    const { data } = await supabase.storage.from('anhaenge').createSignedUrl(pfad, 300);
    if (data?.signedUrl) setAudio({ meldung: meldungId, url: data.signedUrl });
  }

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const auftragProBaustelle = useMemo(() => {
    const m = new Map<string, OffenerAuftrag>();
    for (const a of auftraege) if (!m.has(a.baustelle_id)) m.set(a.baustelle_id, a);
    return m;
  }, [auftraege]);

  /** Ein offener Auftrag macht nur den GEPLANTEN Tag verdächtig — nicht die ganze Woche. */
  function passenderAuftrag(baustelleId: string | undefined, datum: string): OffenerAuftrag | undefined {
    if (!baustelleId) return undefined;
    const a = auftragProBaustelle.get(baustelleId);
    if (!a) return undefined;
    return a.geplant_fuer === null || a.geplant_fuer === datum ? a : undefined;
  }

  // Matrix: Person → Tag → Einträge
  const personen = useMemo(() => {
    const m = new Map<
      string,
      { name: string; typ: string; funktion: string; teamName: string; tage: Map<string, Eintrag[]> }
    >();
    for (const e of eintraege) {
      const p =
        m.get(e.mitarbeiter.id) ??
        { name: e.mitarbeiter.name, typ: e.mitarbeiter.typ, funktion: e.mitarbeiter.funktion, teamName: e.tagesmeldung.team?.bezeichnung ?? 'ohne Team', tage: new Map() };
      const liste = p.tage.get(e.tagesmeldung.datum) ?? [];
      liste.push(e);
      p.tage.set(e.tagesmeldung.datum, liste);
      m.set(e.mitarbeiter.id, p);
    }
    return [...m.entries()].sort((a, b) =>
      a[1].teamName.localeCompare(b[1].teamName, 'de', { numeric: true }) || a[1].name.localeCompare(b[1].name),
    );
  }, [eintraege]);

  // Gruppen für die Matrix: eine Kopfzeile pro Team, damit mehrere Teams lesbar bleiben
  const gruppen = useMemo(() => {
    const g: { team: string; leute: typeof personen }[] = [];
    for (const eintrag of personen) {
      const t = eintrag[1].teamName;
      const letzte = g[g.length - 1];
      if (letzte && letzte.team === t) letzte.leute.push(eintrag);
      else g.push({ team: t, leute: [eintrag] });
    }
    return g;
  }, [personen]);

  function zellStatus(liste: Eintrag[] | undefined): ZellStatus {
    if (!liste || liste.length === 0) return 'leer';
    const summe = liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
    if (summe > ZEHN_STUNDEN_MIN) return 'rot';
    const verdacht = liste.some(
      (e) =>
        e.tagesmeldung.abweichung_typ !== null ||
        e.tagesmeldung.wer_hats_gewollt === 'kunde' ||
        passenderAuftrag(e.tagesmeldung.baustelle?.id, e.tagesmeldung.datum) !== undefined,
    );
    if (verdacht) return 'gelb';
    if (liste.every((e) => e.status === 'freigegeben')) return 'frei';
    return 'gruen';
  }

  // Regieverdacht: eine Karte pro betroffener Tagesmeldung
  const verdachtsfaelle = useMemo(() => {
    const gesehen = new Set<string>();
    const faelle: { meldung: Eintrag['tagesmeldung']; eintraege: Eintrag[]; ausloeser: string[] }[] = [];
    for (const e of eintraege) {
      const tm = e.tagesmeldung;
      if (gesehen.has(tm.id)) continue;
      const ausloeser: string[] = [];
      if (tm.abweichung_typ) ausloeser.push(`Team meldet «${tm.abweichung_typ}»`);
      if (tm.wer_hats_gewollt === 'kunde') ausloeser.push('Team: der Kunde wollte es');
      const auftrag = passenderAuftrag(tm.baustelle?.id, tm.datum);
      if (auftrag)
        ausloeser.push(`offener Zusatzauftrag: ${auftrag.taetigkeit} (${auftrag.besteller_name})`);
      if (ausloeser.length === 0) continue;
      gesehen.add(tm.id);
      faelle.push({
        meldung: tm,
        eintraege: eintraege.filter((x) => x.tagesmeldung.id === tm.id),
        ausloeser,
      });
    }
    return faelle;
  }, [eintraege, auftragProBaustelle]);

  function betragVorgerechnet(liste: Eintrag[]): number {
    return liste.reduce((s, e) => {
      let ansatz = 10800; // Rückfall Gerüstmonteur/in
      try {
        ansatz = tarifNachCode(e.mitarbeiter.funktion).ansatz_rappen;
      } catch {
        /* unbekannte Funktion → Monteursansatz */
      }
      return s + minutenBetrag(e.normal_min + e.ueber_min, ansatz);
    }, 0);
  }

  const gruene = useMemo(
    () =>
      personen.flatMap(([, p]) =>
        [...p.tage.values()].flatMap((liste) =>
          zellStatus(liste) === 'gruen' ? liste.filter((e) => e.status === 'offen') : [],
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personen, auftragProBaustelle],
  );

  async function freigeben(liste: Eintrag[]) {
    if (!supabase || !userId || liste.length === 0) return;
    const ids = liste.map((e) => e.id);
    await supabase.from('zeiteintrag').update({ status: 'freigegeben' }).in('id', ids);
    await supabase.from('freigabe_log').insert(
      liste.map((e) => ({
        zeiteintrag_id: e.id,
        wer: userId,
        feld: 'status',
        alt: e.status,
        neu: 'freigegeben',
      })),
    );
    void laden();
  }

  /** Korrektur ±30 Min — jede Änderung landet im Protokoll (wer/wann/von/auf). */
  async function korrigieren(e: Eintrag, deltaMin: number) {
    if (!supabase || !userId) return;
    const neu = Math.max(0, e.normal_min + deltaMin);
    if (neu === e.normal_min) return;
    await supabase.from('zeiteintrag').update({ normal_min: neu }).eq('id', e.id);
    await supabase.from('freigabe_log').insert({
      zeiteintrag_id: e.id,
      wer: userId,
      feld: 'normal_min',
      alt: String(e.normal_min),
      neu: String(neu),
    });
    void laden();
  }

  /** Gelbe Karte → Regierapport-Entwurf: Positionen aus den Zeiteinträgen, Betrag nach SGUV. */
  async function regierapportErstellen(fall: { meldung: Eintrag['tagesmeldung']; eintraege: Eintrag[] }) {
    if (!supabase) return;
    const bs = fall.meldung.baustelle;
    if (!bs) return;
    const { data: r, error } = await supabase
      .from('regierapport')
      .insert({
        baustelle_id: bs.id,
        zusatzauftrag_id: auftragProBaustelle.get(bs.id)?.id ?? null,
        betrag_rappen: betragVorgerechnet(fall.eintraege),
      })
      .select('id')
      .single();
    if (error || !r) return;
    await supabase.from('regie_position').insert(
      fall.eintraege.map((e) => {
        const min = e.normal_min + e.ueber_min;
        let ansatz = 10800;
        try {
          ansatz = tarifNachCode(e.mitarbeiter.funktion).ansatz_rappen;
        } catch {
          /* unbekannte Funktion → Monteursansatz */
        }
        return {
          regierapport_id: r.id,
          tarif_code: e.mitarbeiter.funktion,
          bezeichnung: `${e.mitarbeiter.name} · ${stunden(min)} h`,
          menge_hundertstel: Math.round((min * 100) / 60),
          ansatz_rappen: ansatz,
          betrag_rappen: minutenBetrag(min, ansatz),
        };
      }),
    );
    navigiere(`/regie/${r.id}`);
  }

  const detail = gewaehlt
    ? personen.find(([id]) => id === gewaehlt.mit)?.[1].tage.get(gewaehlt.datum) ?? []
    : [];

  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">Woche</h1>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, -7))}>‹</button>
            <span className="font-mono text-xs text-ink2">
              {ch(wochenStart)}–{ch(addTage(wochenStart, 6))}
            </span>
            <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, 7))}>›</button>
          </div>
        </header>

        <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="field w-auto py-1.5 text-sm">
          <option value="alle">Alle Teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.bezeichnung}</option>)}
        </select>

        {personen.length === 0 ? (
          <div className="card text-sm text-ink3">
            {laedt ? 'Lädt …' : 'Keine Einträge in dieser Woche.'}
          </div>
        ) : (
          <>
            <section className="card overflow-x-auto p-0">
              <table className="w-full min-w-[430px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink3">Person</th>
                    {TAGE.map((t, i) => (
                      <th key={t} className="px-1 py-2 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-ink3">
                        {t}
                        <span className="block text-[9px] font-normal">{ch(addTage(wochenStart, i))}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gruppen.map((g) => [
                    <tr key={'kopf-' + g.team} className="border-b border-line bg-steel-soft/60">
                      <td colSpan={TAGE.length + 1} className="px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-wider text-steel">
                        {g.team}
                        <span className="ml-2 font-mono text-[10px] font-normal normal-case tracking-normal text-ink3">{g.leute.length} Personen</span>
                      </td>
                    </tr>,
                    ...g.leute.map(([mitId, p]) => (
                    <tr key={mitId} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        {p.name}
                        {p.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}
                      </td>
                      {TAGE.map((_, i) => {
                        const datum = iso(addTage(wochenStart, i));
                        const liste = p.tage.get(datum);
                        const st = zellStatus(liste);
                        const summe = liste?.reduce((s, e) => s + e.normal_min + e.ueber_min, 0) ?? 0;
                        const aktiv = gewaehlt?.mit === mitId && gewaehlt.datum === datum;
                        return (
                          <td key={datum} className="p-0.5 text-center">
                            <button
                              type="button"
                              onClick={() => setGewaehlt(aktiv ? null : { mit: mitId, datum })}
                              className={
                                'w-full rounded-md px-1 py-1.5 font-mono text-xs tabular-nums transition ' +
                                ZELL_STIL[st] +
                                (aktiv ? ' ring-2 ring-accent' : '')
                              }
                            >
                              {st === 'leer' ? '–' : stunden(summe)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </section>

            <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink3">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-good-soft ring-1 ring-good/40" />freigegeben</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-200" />Regieverdacht</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent-soft ring-1 ring-accent/40" />über 10 h — anschauen</span>
              <span>– kein Eintrag</span>
            </p>

            {gruene.length > 0 && (
              <button type="button" className="cta cta-good" onClick={() => void freigeben(gruene)}>
                Alles Grüne freigeben ({gruene.length})
              </button>
            )}

            {gewaehlt && detail.length > 0 && (
              <section className="card space-y-3">
                <p className="lbl mb-0">
                  {personen.find(([id]) => id === gewaehlt.mit)?.[1].name} · {gewaehlt.datum}
                </p>
                {detail.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 border-b border-line pb-2.5 last:border-b-0 last:pb-0">
                    <span className="min-w-0 text-sm">
                      <span className="block truncate font-medium">
                        {e.tagesmeldung.baustelle?.bezeichnung ?? 'ohne Baustelle'}
                      </span>
                      {e.tagesmeldung.baustelle && (
                        <span className="knr">{e.tagesmeldung.baustelle.konto_nr}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <button type="button" className="btn-ghost px-2.5" onClick={() => void korrigieren(e, -30)}>−</button>
                      <span className="w-12 text-center font-mono text-sm tabular-nums">
                        {stunden(e.normal_min + e.ueber_min)} h
                      </span>
                      <button type="button" className="btn-ghost px-2.5" onClick={() => void korrigieren(e, 30)}>+</button>
                      {e.status === 'offen' ? (
                        <button type="button" className="btn-ghost text-good-deep" onClick={() => void freigeben([e])}>✓</button>
                      ) : (
                        <span className="px-1 text-good" title="freigegeben">✓</span>
                      )}
                    </span>
                  </div>
                ))}
                <p className="text-[11px] text-ink3">
                  Jede Korrektur wird protokolliert: wer, wann, von, auf.
                </p>
              </section>
            )}

            {verdachtsfaelle.length > 0 && (
              <section className="space-y-2.5">
                <h2 className="lbl mb-0">Regieverdacht</h2>
                {verdachtsfaelle.map(({ meldung, eintraege: liste, ausloeser }) => (
                  <div key={meldung.id} className="card border-amber-300 bg-amber-50">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-display text-[15px] font-bold">
                        {meldung.baustelle?.bezeichnung ?? '—'}
                      </span>
                      <span className="font-mono text-xs text-ink3">{meldung.datum}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-ink2">
                      {ausloeser.map((a) => (
                        <li key={a}>• {a}</li>
                      ))}
                    </ul>
                    {meldung.transkript && (
                      <p className="mt-2 rounded-[10px] bg-surface px-3 py-2 text-sm italic text-ink2">«{meldung.transkript}»</p>
                    )}
                    {(meldung.audio_pfad || meldung.audio_sekunden) && (
                      <div className="mt-2 flex items-center gap-2">
                        {meldung.audio_pfad ? (
                          <button type="button" onClick={() => void anhoeren(meldung.id, meldung.audio_pfad!)} className="btn-ghost">▶ Sprachnotiz{meldung.audio_sekunden ? ` · ${meldung.audio_sekunden} Sek.` : ''}</button>
                        ) : (
                          <span className="font-mono text-[11px] text-ink3">Sprachnotiz {meldung.audio_sekunden} Sek. (Demo — keine Aufnahme hinterlegt)</span>
                        )}
                        {audio?.meldung === meldung.id && <audio controls autoPlay src={audio.url} className="h-8 flex-1" />}
                      </div>
                    )}
                    {meldung.normalfall ? (
                      /* Normaler Tag mit offenem Auftrag: die 8 h sind Aufbau (Offerte), nicht Regie.
                         Regie entsteht nur aus dem gemeldeten Extra — sonst beim Team nachfragen. */
                      <p className="mt-2 rounded-[10px] border border-dashed border-amber-400 px-3 py-2 text-xs text-ink2">
                        Normaler Arbeitstag ({stunden(liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0))} h) — das ist Aufbau aus der Offerte, keine Regie.
                        Der Zusatzauftrag war für diesen Tag geplant, aber <b>das Team hat keine Zusatzarbeit gemeldet</b>: nachfragen, ob sie ausgeführt wurde.
                      </p>
                    ) : (
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm">
                          {stunden(liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0))} h Zusatzarbeit ·{' '}
                          <span className="font-mono font-semibold text-accent-deep">
                            {formatChf(betragVorgerechnet(liste))}
                          </span>
                          <span className="text-xs text-ink3"> vorgerechnet</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => void regierapportErstellen({ meldung, eintraege: liste })}
                          className="btn-ghost border-accent text-accent-deep"
                        >
                          → Regierapport
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
