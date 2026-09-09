import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { formatChf } from '../lib/tarif';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, lang, montag } from '../lib/datum';
import { flushNachSupabase, offeneAnzahl } from '../lib/db';
import { Kachel, MONATE, NavKarte } from '../ui/Karten';
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
  /** Teams ohne Meldung heute — am PC als Liste, am Handy nur die Zahl */
  fehlend: string[];
  zuPruefen: number;
  regieOffen: number;
  regieUeberfaellig: number;
  regieOffenRappen: number;
  regieMonatRappen: number;
}

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
  const heute = new Date();

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
      const [za, zaHeute, tm, teams, zp, ro, ru, rm] = await Promise.all([
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).in('stand', ['bestellt', 'gemeldet']),
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).eq('stand', 'bestellt').eq('geplant_fuer', heuteIso),
        c.from('tagesmeldung').select('team_id').eq('datum', heuteIso),
        c.from('team').select('id,bezeichnung').eq('aktiv', true),
        c.from('zeiteintrag').select('id,tagesmeldung!inner(datum)', { count: 'exact', head: true }).eq('status', 'offen').lt('tagesmeldung.datum', wochenStart),
        c.from('regierapport').select('betrag_rappen').in('status', ['versendet', 'rueckfrage']),
        c.from('regierapport').select('id', { count: 'exact', head: true }).or(`status.eq.frist_abgelaufen,and(status.eq.versendet,frist_bis.lt.${heuteIso})`),
        // Verschickt = Versanddatum zählt, nicht das Anlegen des Entwurfs
        c.from('regierapport').select('betrag_rappen').gte('versendet_am', monatsStart).neq('status', 'entwurf'),
      ]);
      const gemeldet = new Set((tm.data ?? []).map((r) => r.team_id));
      const alleTeams = ((teams.data ?? []) as { id: string; bezeichnung: string }[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
      setK({
        offeneAuftraege: za.count ?? 0,
        heuteGeplant: zaHeute.count ?? 0,
        teamsGemeldet: gemeldet.size,
        teams: alleTeams.length,
        fehlend: alleTeams.filter((t) => !gemeldet.has(t.id)).map((t) => t.bezeichnung),
        zuPruefen: zp.count ?? 0,
        regieOffen: (ro.data ?? []).length,
        regieOffenRappen: (ro.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        regieUeberfaellig: ru.count ?? 0,
        regieMonatRappen: (rm.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
      });
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

        {k && (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-4">
            <Kachel zu="/heute" wert={`${k.teamsGemeldet}/${k.teams}`} label="Teams haben heute gemeldet" warn={k.teamsGemeldet < k.teams && heute.getDay() >= 1 && heute.getDay() <= 5 && heute.getHours() >= 17} />
            <Kachel zu="/cockpit" wert={String(k.zuPruefen)} label="Zeiteinträge warten auf Freigabe" warn={k.zuPruefen > 0} />
            <Kachel zu="/zusatzauftrag" wert={String(k.offeneAuftraege)} label={k.heuteGeplant > 0 ? `offene Zusatzaufträge · ${k.heuteGeplant} heute` : 'offene Zusatzaufträge'} />
            <Kachel zu="/regie" wert={String(k.regieOffen)} label={`Regierapporte beim Kunden · ${formatChf(k.regieOffenRappen)}`} />
            <Kachel zu="/regie" wert={String(k.regieUeberfaellig)} label="Frist abgelaufen — nachfassen" warn={k.regieUeberfaellig > 0} />
            <Kachel zu="/regie" wert={formatChf(k.regieMonatRappen)} label={`Regie an Kunden verschickt im ${MONATE[heute.getMonth()]}`} />
          </div>
        )}

        {k && k.fehlend.length > 0 && heute.getDay() >= 1 && heute.getDay() <= 6 && (
          <section className="card hidden lg:block">
            <div className="flex items-baseline justify-between gap-3">
              <p className="lbl mb-0">Heute noch nichts gemeldet · {k.fehlend.length}</p>
              <Link to="/heute" className="text-xs font-semibold text-steel">Tagesübersicht ›</Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {k.fehlend.map((name) => <span key={name} className="chip py-1 text-xs">{name}</span>)}
            </div>
            <p className="mt-3 text-xs text-ink3">Am Abend meldet das Teamgerät — vorher ist die Liste normal lang.</p>
          </section>
        )}

        <nav className="grid gap-3 lg:hidden">
          <NavKarte zu="/erfassung?wahl" titel="Erfassung" text="Teamgerät — ein Knopf für den normalen Tag" />
          <NavKarte zu="/cockpit" titel="Wochenübersicht" text="Prüfen und freigeben, statt telefonieren" />
          <NavKarte zu="/regie" titel="Regierapporte" text="Versand, Zustellnachweis und Fristen" />
          <NavKarte zu="/board" titel="Board" text="Jahresplan — welches Team wann wo" />
          <NavKarte zu="/export" titel="Export" text="SORBA-Raster, Lohn-Excel, Temporärbüro" />
          <NavKarte zu="/verwaltung" titel="Verwaltung" text="Mitarbeitende, Teams, Kunden, Baustellen" />
          <NavKarte zu="/b/demo-token" titel="Kundenlink" text="So bestätigt die Bauleitung — ohne Konto" />
        </nav>

        <p className="text-center text-[11px] text-ink3 lg:hidden">Woche {kw(heute)} · {kurz(montag(heute))} bis {kurz(addTage(montag(heute), 6))}</p>
      </div>
    </Shell>
  );
}

