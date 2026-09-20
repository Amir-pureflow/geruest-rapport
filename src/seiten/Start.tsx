import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, lang, montag } from '../lib/datum';
import { flushNachSupabase, offeneAnzahl } from '../lib/db';
import { Kachel, NavKarte } from '../ui/Karten';
import { navFuer } from '../ui/Shell';
import { DiagrammKarte, WochenTeams } from '../ui/Diagramm';
import { TeamBoard } from '../ui/TeamBoard';
import { teamStand, wochenTeams, type TeamStand, type WochenTag } from '../lib/kennzahlen';
import { useAnsicht } from '../lib/ansicht';
import { StartChef } from './StartChef';
import { StartMonteur } from './StartMonteur';
import { StartSekretariat } from './StartSekretariat';

/** Was der Bauführer auf einen Blick braucht: wer hat gemeldet, was wartet auf Freigabe, wo sind Überstunden zu lesen. */
interface Kennzahlen {
  teamsGemeldet: number;
  teams: number;
  /** offene Zeiteinträge vor dieser Woche — die Vorwoche steht zur Freigabe an */
  zuPruefen: number;
  /** offene Zeiteinträge der Vorwoche mit Überstunden — da liest der Bauführer die Notiz */
  ueberOffen: number;
}

/** Ein Satz pro Bereich fürs Handy-Menü — die Reihenfolge kommt aus der Seitenleiste (eine Ordnung für beide). */
const BEREICH_TEXT: Record<string, string> = {
  '/heute': 'Wer hat heute gemeldet, wer nicht',
  '/cockpit': 'Prüfen und freigeben, statt telefonieren',
  '/export': 'Freigegebene Stunden im Raster des Tagesrapports — zum Abtippen in SORBA',
  '/verwaltung': 'Mitarbeitende, Teams, Kunden, Baustellen',
  '/erfassung?wahl': 'Teamgerät — ein Knopf für den normalen Tag',
};

/** Startseite je Ansicht (09.09.): Bauführer, Chefmonteur, Monteur, Sekretariat. */
export function Start() {
  const ansicht = useAnsicht();
  if (ansicht === 'chef') return <StartChef />;
  if (ansicht === 'monteur') return <StartMonteur />;
  if (ansicht === 'sekretariat') return <StartSekretariat />;
  return <StartBauf />;
}

/** Bauführer: Kennzahlen, Tagesstand der Teams, alle Bereiche. Regie und Zusatzaufträge sind seit 20.09. weg (SORBA macht das). */
function StartBauf() {
  const [k, setK] = useState<Kennzahlen | null>(null);
  const [wartend, setWartend] = useState<{ anzahl: number; grund?: string } | null>(null);
  const [fehler, setFehler] = useState('');
  const [woche, setWoche] = useState<WochenTag[] | null>(null);
  const [stand, setStand] = useState<TeamStand[] | null>(null);
  const heute = new Date();
  const vorwoche = iso(addTage(montag(heute), -7));

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
        c.from('zeiteintrag').select('id,tagesmeldung!inner(datum)', { count: 'exact', head: true }).eq('status', 'offen').lt('tagesmeldung.datum', wochenStart),
        c.from('zeiteintrag').select('id,tagesmeldung!inner(datum)', { count: 'exact', head: true }).eq('status', 'offen').gt('ueber_min', 0).gte('tagesmeldung.datum', vorwoche).lt('tagesmeldung.datum', wochenStart),
      ]);
      const erster = [tm, teams, zp, uo].find((r) => r.error);
      if (erster?.error) { setFehler(erster.error.message); return; }
      // Die Teamnamen braucht die Kachel nicht mehr — die liefert das Board darunter
      const gemeldet = new Set((tm.data ?? []).map((r) => r.team_id));
      setK({
        teamsGemeldet: gemeldet.size,
        teams: teams.count ?? 0,
        zuPruefen: zp.count ?? 0,
        ueberOffen: uo.count ?? 0,
      });
      // Diagramm und Board danach — die Kacheln sollen nicht darauf warten
      // Die Vorwoche ist die, die zur Freigabe ansteht (Mo/Di prüft der Bauführer) — die laufende wäre halb leer
      const [w, ts] = await Promise.all([wochenTeams(c, addTage(montag(heute), -7)), teamStand(c, heute)]);
      setWoche(w);
      setStand(ts);
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
            {k && k.zuPruefen > 0 && (
              <Link to={`/cockpit?woche=${vorwoche}`} className="cta hidden w-auto px-5 py-2.5 md:block">
                Vorwoche prüfen
              </Link>
            )}
          </div>
        </header>

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
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-4" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={'card h-[104px] animate-pulse bg-surface-2 md:h-[116px] ' + (i === 0 ? 'col-span-2 md:col-span-1' : '')} />
            ))}
          </div>
        )}
        {k && (
          <>
            {/* Handy: der Tagesstand steht oben über die ganze Breite, die zwei Zahlen zur Vorwoche darunter */}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-4">
              <div className="col-span-2 md:col-span-1">
                <Kachel
                  zu="/heute"
                  wert={`${k.teamsGemeldet} von ${k.teams}`}
                  label="Teams haben heute gemeldet"
                  fortschritt={{ von: k.teamsGemeldet, bis: k.teams }}
                  farbe={
                    k.teams > 0 && k.teamsGemeldet === k.teams
                      ? 'gruen'
                      : k.teamsGemeldet < k.teams && heute.getDay() >= 1 && heute.getDay() <= 5 && heute.getHours() >= 17
                        ? 'gelb'
                        : 'neutral'
                  }
                />
              </div>
              <Kachel
                zu={`/cockpit?woche=${vorwoche}`}
                wert={String(k.zuPruefen)}
                label={k.zuPruefen > 0 ? 'Zeiteinträge der Vorwoche warten auf Freigabe' : 'Vorwoche ist freigegeben'}
                farbe={k.zuPruefen > 0 ? 'gelb' : 'gruen'}
              />
              <Kachel
                zu={`/cockpit?woche=${vorwoche}`}
                wert={String(k.ueberOffen)}
                label={k.ueberOffen > 0 ? 'Überstunden der Vorwoche — Notiz lesen' : 'Überstunden der Vorwoche offen'}
                farbe={k.ueberOffen > 0 ? 'gelb' : 'neutral'}
              />
            </div>

            {/* Handy: derselbe Knopf wie oben am PC — dort ist er in der Kopfzeile */}
            {k.zuPruefen > 0 && (
              <Link to={`/cockpit?woche=${vorwoche}`} className="cta md:hidden">
                Vorwoche prüfen
              </Link>
            )}
          </>
        )}

        {/* Seit 20.09. auch am Handy: die Säulen haben feste Höhe und passen in die schmale Spalte */}
        {woche && (
          <DiagrammKarte
            titel="Freigabe Vorwoche"
            unter={`${kurz(addTage(montag(heute), -7))} bis ${kurz(addTage(montag(heute), -1))} · je Tag die Teams, die gemeldet haben`}
            aktion={<Link to={`/cockpit?woche=${vorwoche}`} className="shrink-0 text-xs font-semibold text-steel">Wochenübersicht ›</Link>}
          >
            <WochenTeams tage={woche} gesamt={k?.teams ?? 0} />
          </DiagrammKarte>
        )}

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
