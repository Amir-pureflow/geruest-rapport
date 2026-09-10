import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { formatChf } from '../lib/tarif';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, lang, montag } from '../lib/datum';
import { flushNachSupabase, offeneAnzahl } from '../lib/db';
import { Kachel, MONATE, NavKarte } from '../ui/Karten';
import { navFuer } from '../ui/Shell';
import { DiagrammKarte, Trichter, WochenTeams } from '../ui/Diagramm';
import { TeamBoard } from '../ui/TeamBoard';
import { teamStand, trichter, wochenTeams, type TeamStand, type TrichterDaten, type WochenTag } from '../lib/kennzahlen';
import { useAnsicht } from '../lib/ansicht';
import { StartChef } from './StartChef';
import { StartMonteur } from './StartMonteur';
import { StartSekretariat } from './StartSekretariat';
import { StartKunde } from './StartKunde';

interface Kennzahlen {
  offeneAuftraege: number;
  heuteGeplant: number;
  teamsGemeldet: number;
  teams: number;
  zuPruefen: number;
  regieOffen: number;
  regieUeberfaellig: number;
  regieOffenRappen: number;
  regieMonatRappen: number;
  /** Bestellt, geplanter Tag vorbei, keine Meldung — der Moment zum Nachfragen */
  ohneMeldung: number;
  /** Regie in Arbeit (alles ausser bestätigt), davon älter als 30 Tage */
  inArbeitRappen: number;
  inArbeitAltRappen: number;
}

/** Ein Satz pro Bereich fürs Handy-Menü — die Reihenfolge kommt aus der Seitenleiste (eine Ordnung für beide). */
const BEREICH_TEXT: Record<string, string> = {
  '/zusatzauftrag': 'Kundenbestellung festhalten, bevor gearbeitet wird',
  '/heute': 'Wer hat heute gemeldet, wer nicht',
  '/cockpit': 'Prüfen und freigeben, statt telefonieren',
  '/regie': 'Versand, Zustellnachweis und Fristen',
  '/auswertung': 'Regie pro Baustelle und Kunde, pro Monat',
  '/export': 'SORBA-Raster, Lohn-Excel, Temporärbüro',
  '/board': 'Jahresplan — welches Team wann wo',
  '/verwaltung': 'Mitarbeitende, Teams, Kunden, Baustellen',
  '/erfassung?wahl': 'Teamgerät — ein Knopf für den normalen Tag',
  '/b/demo-token': 'So bestätigt die Bauleitung — ohne Konto',
};

/** Startseite je Ansicht (09.09.): Bauführer, Chefmonteur, Monteur, Sekretariat, Kunde. */
export function Start() {
  const ansicht = useAnsicht();
  if (ansicht === 'chef') return <StartChef />;
  if (ansicht === 'monteur') return <StartMonteur />;
  if (ansicht === 'sekretariat') return <StartSekretariat />;
  if (ansicht === 'kunde') return <StartKunde />;
  return <StartBauf />;
}

/** Bauführer: Kennzahlen, Zusatzarbeit, alle Bereiche. */
function StartBauf() {
  const [k, setK] = useState<Kennzahlen | null>(null);
  const [wartend, setWartend] = useState<{ anzahl: number; grund?: string } | null>(null);
  const [fehler, setFehler] = useState('');
  const [woche, setWoche] = useState<WochenTag[] | null>(null);
  const [tr, setTr] = useState<TrichterDaten | null>(null);
  const [stand, setStand] = useState<TeamStand[] | null>(null);
  const heute = new Date();
  const vorwoche = iso(addTage(montag(heute), -7));

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    const heuteIso = iso(heute);
    const monatsStart = iso(new Date(heute.getFullYear(), heute.getMonth(), 1, 12));
    const wochenStart = iso(montag(heute));
    void (async () => {
      // Erst die lokale Warteschlange leeren, dann zählen — sonst zählt das Dashboard hinterher
      if (navigator.onLine) {
        const erg = await flushNachSupabase(c);
        const rest = await offeneAnzahl();
        setWartend(rest > 0 ? { anzahl: rest, grund: erg.fehlerText } : null);
      } else {
        const rest = await offeneAnzahl();
        setWartend(rest > 0 ? { anzahl: rest } : null);
      }
      const [za, zaHeute, tm, teams, zp, ro, ru, rm, om, ia] = await Promise.all([
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).in('stand', ['bestellt', 'gemeldet']),
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).eq('stand', 'bestellt').eq('geplant_fuer', heuteIso),
        c.from('tagesmeldung').select('team_id').eq('datum', heuteIso),
        c.from('team').select('id', { count: 'exact', head: true }).eq('aktiv', true),
        c.from('zeiteintrag').select('id,tagesmeldung!inner(datum)', { count: 'exact', head: true }).eq('status', 'offen').lt('tagesmeldung.datum', wochenStart),
        c.from('regierapport').select('betrag_rappen').in('status', ['versendet', 'rueckfrage']),
        c.from('regierapport').select('id', { count: 'exact', head: true }).or(`status.eq.frist_abgelaufen,and(status.eq.versendet,frist_bis.lt.${heuteIso})`),
        // Verschickt = Versanddatum zählt, nicht das Anlegen des Entwurfs
        c.from('regierapport').select('betrag_rappen').gte('versendet_am', monatsStart).neq('status', 'entwurf'),
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).eq('ohne_meldung', true),
        c.from('regierapport').select('betrag_rappen,versendet_am,erstellt_am').neq('status', 'bestaetigt'),
      ]);
      const erster = [za, zaHeute, tm, teams, zp, ro, ru, rm, om, ia].find((r) => r.error);
      if (erster?.error) { setFehler(erster.error.message); return; }
      const dreissigTage = Date.now() - 30 * 86400000;
      const inArbeit = (ia.data ?? []) as { betrag_rappen: number | null; versendet_am: string | null; erstellt_am: string }[];
      // Die Teamnamen braucht die Kachel nicht mehr — die liefert das Board darunter
      const gemeldet = new Set((tm.data ?? []).map((r) => r.team_id));
      setK({
        offeneAuftraege: za.count ?? 0,
        heuteGeplant: zaHeute.count ?? 0,
        teamsGemeldet: gemeldet.size,
        teams: teams.count ?? 0,
        zuPruefen: zp.count ?? 0,
        regieOffen: (ro.data ?? []).length,
        regieOffenRappen: (ro.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        regieUeberfaellig: ru.count ?? 0,
        regieMonatRappen: (rm.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        ohneMeldung: om.count ?? 0,
        inArbeitRappen: inArbeit.reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        inArbeitAltRappen: inArbeit.filter((r) => new Date(r.versendet_am ?? r.erstellt_am).getTime() < dreissigTage).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
      });
      // Diagramme und Board danach — die Kacheln sollen nicht darauf warten
      // Die Vorwoche ist die, die zur Freigabe ansteht (Mo/Di prüft der Bauführer) — die laufende wäre halb leer
      const [w, t, ts] = await Promise.all([wochenTeams(c, addTage(montag(heute), -7)), trichter(c), teamStand(c, heute)]);
      setWoche(w);
      setTr(t);
      setStand(ts);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="lbl mb-0.5">Bauführer</p>
            <h1 className="font-display text-2xl font-bold lg:text-3xl">{lang(heute)}</h1>
            <p className="mt-1 hidden text-sm text-ink3 lg:block">Woche {kw(heute)} · {kurz(montag(heute))} bis {kurz(addTage(montag(heute), 6))}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono text-xs text-ink3">
              <span className={'inline-block h-2 w-2 rounded-full ' + (supabase ? 'bg-good' : 'bg-accent')} />
              {supabase ? 'verbunden' : 'offline-Modus'}
            </span>
            <Link to="/zusatzauftrag" className="cta hidden w-auto px-5 py-2.5 text-[15px] lg:block">+ Zusatzarbeit</Link>
          </div>
        </header>

        <Link to="/zusatzauftrag" className="block rounded-[14px] bg-accent p-5 text-white shadow-[0_3px_14px_rgb(216_40_22/0.35)] transition active:bg-accent-deep lg:hidden">
          <span className="block font-display text-lg font-extrabold">+ Zusatzarbeit</span>
          <span className="mt-0.5 block text-sm text-white/85">Kundenbestellung festhalten, während er noch am Telefon ist — 20 Sekunden</span>
        </Link>

        {wartend && (
          <div className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">
            <strong>{wartend.anzahl} Meldung{wartend.anzahl === 1 ? '' : 'en'} auf diesem Gerät noch nicht gesendet.</strong>
            {wartend.grund ? ` ${wartend.grund}` : ' Wird gesendet, sobald Netz da ist.'}
          </div>
        )}

        {fehler && (
          <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">
            Kennzahlen konnten nicht geladen werden: {fehler} <button type="button" className="ml-2 font-semibold underline" onClick={() => location.reload()}>Nochmals</button>
          </p>
        )}
        {!k && !fehler && supabase && (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-4" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-[76px] animate-pulse bg-surface-2 lg:h-[92px]" />)}
          </div>
        )}
        {k && (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-4">
            <Kachel zu="/heute" wert={`${k.teamsGemeldet}/${k.teams}`} label="Teams haben heute gemeldet" warn={k.teamsGemeldet < k.teams && heute.getDay() >= 1 && heute.getDay() <= 5 && heute.getHours() >= 17} />
            <Kachel zu={`/cockpit?woche=${vorwoche}`} wert={String(k.zuPruefen)} label="Zeiteinträge der Vorwoche warten auf Freigabe" warn={k.zuPruefen > 0} />
            <Kachel zu="/zusatzauftrag" wert={String(k.offeneAuftraege)} label={k.ohneMeldung > 0 ? `offene Zusatzaufträge · ${k.ohneMeldung} ohne Meldung vom Team` : k.heuteGeplant > 0 ? `offene Zusatzaufträge · ${k.heuteGeplant} heute` : 'offene Zusatzaufträge'} warn={k.ohneMeldung > 0} />
            <Kachel zu="/regie" wert={formatChf(k.inArbeitRappen)} label={k.inArbeitAltRappen > 0 ? `Regie in Arbeit · ${formatChf(k.inArbeitAltRappen)} älter als 30 Tage` : `Regie in Arbeit · ${k.regieOffen} beim Kunden`} warn={k.inArbeitAltRappen > 0} />
            <Kachel zu="/regie" wert={String(k.regieUeberfaellig)} label="Frist abgelaufen — nachfassen" warn={k.regieUeberfaellig > 0} />
            <Kachel zu="/auswertung" wert={formatChf(k.regieMonatRappen)} label={`Regie an Kunden verschickt im ${MONATE[heute.getMonth()]}`} />
          </div>
        )}

        {/* Diagramme nur am PC — auf dem Handy zählen die Kacheln und die schnellen Wege */}
        <div className="hidden gap-4 lg:grid lg:grid-cols-2">
          {woche && (
            <DiagrammKarte
              titel="Freigabe Vorwoche"
              unter={`${kurz(addTage(montag(heute), -7))} bis ${kurz(addTage(montag(heute), -1))} — Teams je Tag, die noch auf dich warten`}
              aktion={<Link to={`/cockpit?woche=${vorwoche}`} className="text-xs font-semibold text-steel">Wochenübersicht ›</Link>}
            >
              <WochenTeams tage={woche} />
            </DiagrammKarte>
          )}
          {tr && (
            <DiagrammKarte
              titel="Zusatzaufträge"
              unter="Wo sie stehen — letzte 60 Tage, Stand abgeleitet"
              aktion={<Link to="/auswertung" className="text-xs font-semibold text-steel">Auswertung ›</Link>}
            >
              <Trichter stufen={tr.stufen} ohneMeldung={tr.ohneMeldung} />
            </DiagrammKarte>
          )}
        </div>

        {stand && stand.length > 0 && heute.getDay() >= 1 && heute.getDay() <= 6 && (
          <div className="hidden lg:block">
            <TeamBoard teams={stand} />
          </div>
        )}

        <nav className="grid gap-3 lg:hidden">
          {navFuer('bauf').flatMap((g) => g.eintraege).filter((e) => e.zu !== '/').map((e) => (
            <NavKarte key={e.zu} zu={e.zu} titel={e.label} text={BEREICH_TEXT[e.zu] ?? ''} />
          ))}
        </nav>

        <p className="text-center text-[11px] text-ink3 lg:hidden">Woche {kw(heute)} · {kurz(montag(heute))} bis {kurz(addTage(montag(heute), 6))}</p>
      </div>
    </Shell>
  );
}

