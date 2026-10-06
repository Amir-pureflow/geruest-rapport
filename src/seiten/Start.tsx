import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Banknote, CalendarCheck, PhoneCall, Send, Users } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, lang, montag } from '../lib/datum';
import { flushNachSupabase, offeneAnzahl } from '../lib/db';
import { Kachel, MONATE, NavKarte } from '../ui/Karten';
import { navFuer } from '../ui/Shell';
import { DiagrammKarte, Trichter, WochenTeams } from '../ui/Diagramm';
import { TeamBoard } from '../ui/TeamBoard';
import { teamStand, trichter, wochenTeams, type TeamStand, type TrichterDaten, type WochenTag } from '../lib/kennzahlen';
import { useAnsicht } from '../lib/ansicht';
import { einstellungen } from '../lib/einstellungen';
import { formatChf } from '../lib/tarif';
import { StartChef } from './StartChef';
import { StartMonteur } from './StartMonteur';
import { StartSekretariat } from './StartSekretariat';
import { StartKunde } from './StartKunde';

/** Was der Bauführer auf einen Blick braucht: wer hat gemeldet, was wartet auf Freigabe, wo sind Überstunden zu lesen. */
interface Kennzahlen {
  teamsGemeldet: number;
  teams: number;
  /** offene Team-Tage vor dieser Woche — der Bauführer denkt in Tagen, nicht in Zeiteinträgen (05.10.2026) */
  zuPruefen: number;
  /** offene Zeiteinträge der Vorwoche mit Überstunden — da liest der Bauführer die Notiz */
  ueberOffen: number;
}

/**
 * Nur im Regie-Modus (Firmen-Schalter `MODUS_ERFASSUNG`, 02.10.2026). Steht getrennt, damit die
 * Grundabfrage ohne Regie keine Tabelle anfasst, die diese Firma nicht benutzt.
 */
interface RegieZahlen {
  /** offene Zusatzaufträge (bestellt oder gemeldet) */
  offeneAuftraege: number;
  /** davon heute geplant */
  heuteGeplant: number;
  /** bestellt, geplanter Tag vorbei, keine Meldung — der Moment zum Nachfragen */
  ohneMeldung: number;
  /** Regie in Arbeit (alles ausser bestätigt), davon älter als 30 Tage */
  inArbeitRappen: number;
  inArbeitAltRappen: number;
  /** Rapporte beim Kunden, und wie viele davon über der Frist sind */
  beimKunden: number;
  ueberfaellig: number;
  /** diesen Monat verschickt */
  monatRappen: number;
}

/** Ein Satz pro Bereich fürs Handy-Menü — die Reihenfolge kommt aus der Seitenleiste (eine Ordnung für beide). */
const BEREICH_TEXT: Record<string, string> = {
  '/zusatzauftrag': 'Kundenbestellung festhalten, bevor gearbeitet wird',
  '/regie': 'Versand, Zustellnachweis und Fristen',
  '/auswertung': 'Regie pro Baustelle und Kunde, pro Monat',
  '/board': 'Jahresplan — welches Team wann wo',
  '/heute': 'Wer hat heute gemeldet, wer nicht',
  '/cockpit': 'Prüfen und freigeben, statt telefonieren',
  '/verwaltung': 'Mitarbeitende, Teams, Kunden, Baustellen',
  '/erfassung?wahl': 'Teamgerät — ein Knopf für den normalen Tag',
};

/** Startseite je Ansicht (09.09.): Bauführer, Chefmonteur, Monteur, Sekretariat — «Kunde» nur im Regie-Modus. */
export function Start() {
  const ansicht = useAnsicht();
  if (ansicht === 'chef') return <StartChef />;
  if (ansicht === 'monteur') return <StartMonteur />;
  if (ansicht === 'sekretariat') return <StartSekretariat />;
  if (ansicht === 'kunde') return <StartKunde />;
  return <StartBauf />;
}

/**
 * Bauführer: Kennzahlen, Tagesstand der Teams, alle Bereiche.
 *
 * Regie, Zusatzaufträge und der Trichter kommen nur, wenn die Firma `MODUS_ERFASSUNG = regie`
 * gesetzt hat (Verwaltung → Einstellungen, 02.10.2026). Bei der Gerüst GmbH macht SORBA die Regie.
 */
function StartBauf() {
  const regie = einstellungen().erfassung === 'regie';
  const [k, setK] = useState<Kennzahlen | null>(null);
  const [rz, setRz] = useState<RegieZahlen | null>(null);
  const [tr, setTr] = useState<TrichterDaten | null>(null);
  const [wartend, setWartend] = useState<{ anzahl: number; grund?: string } | null>(null);
  const [fehler, setFehler] = useState('');
  const [woche, setWoche] = useState<WochenTag[] | null>(null);
  const [stand, setStand] = useState<TeamStand[] | null>(null);
  const heute = new Date();
  const vorwoche = iso(addTage(montag(heute), -7));
  // Montag der Woche, die in der Freigabe-Karte steht — automatisch die älteste mit offenen Freigaben
  const [freigabeMo, setFreigabeMo] = useState<Date>(() => addTage(montag(new Date()), -7));

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    const heuteIso = iso(heute);
    const wochenStart = iso(montag(heute));
    void (async () => {
      // Erst die lokale Warteschlange leeren, dann zählen — sonst zählt das Dashboard hinterher.
      // Ist der lokale Speicher kaputt (privater Modus, volle Platte), darf das Dashboard trotzdem laden.
      try {
        if (navigator.onLine) {
          const erg = await flushNachSupabase(c);
          const rest = await offeneAnzahl();
          setWartend(rest > 0 ? { anzahl: rest, grund: erg.fehlerText } : null);
        } else {
          const rest = await offeneAnzahl();
          setWartend(rest > 0 ? { anzahl: rest } : null);
        }
      } catch {
        setWartend(null);
      }
      const [tm, teams, zp, uo] = await Promise.all([
        c.from('tagesmeldung').select('team_id').eq('datum', heuteIso),
        c.from('team').select('id', { count: 'exact', head: true }).eq('aktiv', true),
        c.from('tagesmeldung').select('datum,team_id,zeiteintrag!inner(id)').eq('zeiteintrag.status', 'offen').lt('datum', wochenStart),
        c.from('zeiteintrag').select('id,tagesmeldung!inner(datum)', { count: 'exact', head: true }).eq('status', 'offen').gt('ueber_min', 0).gte('tagesmeldung.datum', vorwoche).lt('tagesmeldung.datum', wochenStart),
      ]);
      const erster = [tm, teams, zp, uo].find((r) => r.error);
      if (erster?.error) { setFehler(erster.error.message); return; }
      // Die Teamnamen braucht die Kachel nicht mehr — die liefert das Board darunter
      const gemeldet = new Set((tm.data ?? []).map((r) => r.team_id));
      setK({
        teamsGemeldet: gemeldet.size,
        teams: teams.count ?? 0,
        zuPruefen: new Set(((zp.data ?? []) as unknown as { datum: string; team_id: string }[]).map((r) => r.team_id + r.datum)).size,
        ueberOffen: uo.count ?? 0,
      });
      // Diagramm und Board danach — die Kacheln sollen nicht darauf warten
      // Die Karte springt auf die älteste Woche mit offenen Freigaben (Amir, 04.10.2026) —
      // bis 6 Wochen zurück, auch die laufende. Ist nichts offen, zeigt sie die Vorwoche.
      let freigabeBezug = addTage(montag(heute), -7);
      const { data: aelteste } = await c
        .from('tagesmeldung')
        .select('datum, zeiteintrag!inner(id)')
        .eq('zeiteintrag.status', 'offen')
        .lte('datum', heuteIso)
        .gte('datum', iso(addTage(montag(heute), -42)))
        .order('datum', { ascending: true })
        .limit(1);
      if (aelteste?.[0]?.datum) freigabeBezug = new Date(aelteste[0].datum + 'T12:00:00');
      setFreigabeMo(montag(freigabeBezug));
      const [w, ts] = await Promise.all([wochenTeams(c, freigabeBezug), teamStand(c, heute)]);
      setWoche(w);
      setStand(ts);

      if (!regie) return;
      // Regie-Teil: eigener Block, eigene Fehlerbehandlung — stolpert er, bleibt der Rest der Seite stehen
      const monatsStart = iso(new Date(heute.getFullYear(), heute.getMonth(), 1, 12));
      const [za, zaHeute, om, ia, bk, uf, rm] = await Promise.all([
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).in('stand', ['bestellt', 'gemeldet']),
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).eq('stand', 'bestellt').eq('geplant_fuer', heuteIso),
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).eq('ohne_meldung', true),
        c.from('regierapport').select('betrag_rappen,versendet_am,erstellt_am').neq('status', 'bestaetigt'),
        c.from('regierapport').select('id', { count: 'exact', head: true }).in('status', ['versendet', 'rueckfrage']),
        c.from('regierapport').select('id', { count: 'exact', head: true }).or(`status.eq.frist_abgelaufen,and(status.eq.versendet,frist_bis.lt.${heuteIso})`),
        // Verschickt = Versanddatum zählt, nicht das Anlegen des Entwurfs
        c.from('regierapport').select('betrag_rappen').gte('versendet_am', monatsStart).neq('status', 'entwurf'),
      ]);
      if ([za, zaHeute, om, ia, bk, uf, rm].some((r) => r.error)) return;
      const dreissigTage = Date.now() - 30 * 86400000;
      const inArbeit = (ia.data ?? []) as { betrag_rappen: number | null; versendet_am: string | null; erstellt_am: string }[];
      setRz({
        offeneAuftraege: za.count ?? 0,
        heuteGeplant: zaHeute.count ?? 0,
        ohneMeldung: om.count ?? 0,
        inArbeitRappen: inArbeit.reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        inArbeitAltRappen: inArbeit
          .filter((r) => new Date(r.versendet_am ?? r.erstellt_am).getTime() < dreissigTage)
          .reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        beimKunden: bk.count ?? 0,
        ueberfaellig: uf.count ?? 0,
        monatRappen: (rm.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
      });
      setTr(await trichter(c));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="lbl mb-0.5">Bauführer</p>
            <h1 className="font-display text-2xl font-semibold md:text-3xl">{lang(heute)}</h1>
            <p className="mt-1 text-[13px] text-ink3 md:text-sm">
              Woche {kw(heute)} · {kurz(montag(heute))} bis {kurz(addTage(montag(heute), 6))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono text-xs text-ink3">
              <span className={'inline-block h-2 w-2 rounded-full ' + (supabase ? 'bg-good' : 'bg-ink3')} />
              {supabase ? 'verbunden' : 'offline-Modus'}
            </span>
            {/* Die eine Aktion — und nur, wenn es etwas zu tun gibt (Firmenrot, siehe index.css) */}
            {regie ? (
              <Link to="/zusatzauftrag" className="cta cta-accent hidden w-auto px-5 py-2.5 md:block">+ Zusatzarbeit</Link>
            ) : (
              k && k.zuPruefen > 0 && (
                <Link to={`/cockpit?woche=${vorwoche}`} className="cta hidden w-auto px-5 py-2.5 md:block">
                  Vorwoche prüfen
                </Link>
              )
            )}
          </div>
        </header>

        {/* Handy: der Anruf ist das Dringendste — der Kunde ist noch am Telefon */}
        {regie && (
          <Link to="/zusatzauftrag" className="cta cta-accent block p-5 text-left md:hidden">
            <span className="block text-[17px] font-semibold">+ Zusatzarbeit</span>
            <span className="mt-0.5 block text-sm text-white/85">Kundenbestellung festhalten, während er noch am Telefon ist — 20 Sekunden</span>
          </Link>
        )}

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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={'card h-[104px] animate-pulse bg-surface-2 md:h-[116px] ' + (i === 0 ? 'col-span-2 md:col-span-1' : '')} />
            ))}
          </div>
        )}
        {k && (
          <>
            {/* Handy: der Tagesstand steht oben über die ganze Breite, die zwei Zahlen zur Vorwoche darunter */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="col-span-2 md:col-span-1">
                <Kachel
                  zu="/heute"
                  titel="Teams heute"
                  wert={`${k.teamsGemeldet} von ${k.teams}`}
                  label="haben schon gemeldet"
                  icon={Users}
                  fortschritt={{ von: k.teamsGemeldet, bis: k.teams }}
                  farbe="blau"
                />
              </div>
              <Kachel
                zu={`/cockpit?woche=${vorwoche}`}
                titel="Freigabe"
                wert={String(k.zuPruefen)}
                label={k.zuPruefen === 1 ? 'Tag wartet auf Freigabe' : k.zuPruefen > 1 ? 'Tage warten auf Freigabe' : 'Vorwoche ist freigegeben'}
                icon={CalendarCheck}
                farbe="gelb"
              />
              <Kachel
                zu={`/cockpit?woche=${vorwoche}`}
                titel="Überstunden"
                wert={String(k.ueberOffen)}
                label={k.ueberOffen > 0 ? 'aus der Vorwoche — Notiz lesen' : 'aus der Vorwoche offen'}
                icon={AlarmClock}
                farbe="rot"
              />
            </div>

            {/* Regie: eigene Reihe, damit die Stunden oben ungestört bleiben */}
            {rz && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kachel
                  zu="/zusatzauftrag"
                  icon={PhoneCall}
                  titel="Zusatzaufträge"
                  wert={String(rz.offeneAuftraege)}
                  label={
                    rz.ohneMeldung > 0
                      ? `offen · ${rz.ohneMeldung} ohne Meldung vom Team`
                      : rz.heuteGeplant > 0
                        ? `offen · ${rz.heuteGeplant} heute geplant`
                        : 'offen'
                  }
                  farbe="blau"
                />
                <Kachel
                  zu="/regie"
                  icon={Banknote}
                  titel="Regie in Arbeit"
                  wert={formatChf(rz.inArbeitRappen)}
                  label={
                    rz.inArbeitAltRappen > 0
                      ? `${formatChf(rz.inArbeitAltRappen)} älter als 30 Tage`
                      : `${rz.beimKunden} beim Kunden`
                  }
                  farbe="gelb"
                />
                <Kachel zu="/regie" icon={AlarmClock} titel="Fristen" wert={String(rz.ueberfaellig)} label="abgelaufen — nachfassen" farbe="rot" />
                <Kachel zu="/auswertung" icon={Send} titel="Verschickt" wert={formatChf(rz.monatRappen)} label={`Regie im ${MONATE[heute.getMonth()]}`} farbe="gruen" />
              </div>
            )}

            {/* Handy: derselbe Knopf wie oben am PC — dort ist er in der Kopfzeile */}
            {k.zuPruefen > 0 && (
              <Link to={`/cockpit?woche=${vorwoche}`} className="cta md:hidden">
                Vorwoche prüfen
              </Link>
            )}
          </>
        )}

        {/* Seit 20.09. auch am Handy: die Säulen haben feste Höhe und passen in die schmale Spalte */}
        <div className={'grid gap-4 ' + (tr ? 'lg:grid-cols-2' : '')}>
          {woche && (
            <DiagrammKarte
              titel={iso(freigabeMo) === iso(montag(heute)) ? 'Freigabe diese Woche' : iso(freigabeMo) === vorwoche ? 'Freigabe Vorwoche' : `Freigabe Woche ${kw(freigabeMo)}`}
              unter={`${kurz(freigabeMo)} bis ${kurz(addTage(freigabeMo, 6))} · je Tag die Teams, die gemeldet haben`}
              aktion={
                <span className="flex shrink-0 items-center gap-3">
                  <Link to={`/cockpit?woche=${iso(montag(heute))}`} className="text-xs font-semibold text-steel">Diese Woche ›</Link>
                  <Link to={`/cockpit?woche=${vorwoche}`} className="text-xs font-semibold text-steel">Vorwoche ›</Link>
                </span>
              }
            >
              <WochenTeams tage={woche} gesamt={k?.teams ?? 0} />
            </DiagrammKarte>
          )}
          {tr && (
            <DiagrammKarte
              titel="Zusatzaufträge"
              unter="Wo sie stehen — letzte 60 Tage, Stand abgeleitet"
              aktion={<Link to="/auswertung" className="shrink-0 text-xs font-semibold text-steel">Auswertung ›</Link>}
            >
              <Trichter stufen={tr.stufen} ohneMeldung={tr.ohneMeldung} />
            </DiagrammKarte>
          )}
        </div>

        {stand && stand.length > 0 && heute.getDay() >= 1 && heute.getDay() <= 6 && (
          <div className="hidden md:block">
            <TeamBoard teams={stand} />
          </div>
        )}

        {/* Handy: Karten je Bereich. Ab iPad steht die Bereichsleiste in der Kopfzeile (Shell). */}
        <nav className="md:hidden">
          <p className="lbl">Bereiche</p>
          <div className="grid gap-2.5">
            {navFuer('bauf').flatMap((g) => g.eintraege).filter((e) => e.zu !== '/').map((e) => (
              <NavKarte key={e.zu} zu={e.zu} titel={e.label} text={BEREICH_TEXT[e.zu] ?? ''} />
            ))}
          </div>
        </nav>
      </div>
    </Shell>
  );
}
