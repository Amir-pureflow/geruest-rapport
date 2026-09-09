/**
 * Startseite Sekretariat: Kundenanrufe festhalten, Regierapporte im Blick, Export, Stammdaten.
 * Freigeben tut der Bauführer — die Wochenübersicht ist hier nur zum Ansehen.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { Kachel, MONATE, NavKarte } from '../ui/Karten';
import { formatChf } from '../lib/tarif';
import { supabase } from '../lib/supabase';
import { iso, lang } from '../lib/datum';

interface Kennzahlen {
  entwuerfe: number;
  regieOffen: number;
  regieOffenRappen: number;
  regieUeberfaellig: number;
  regieMonatRappen: number;
  offeneAuftraege: number;
  teamsGemeldet: number;
  teams: number;
}

export function StartSekretariat() {
  const [k, setK] = useState<Kennzahlen | null>(null);
  const heute = new Date();

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    const heuteIso = iso(heute);
    const monatsStart = iso(new Date(heute.getFullYear(), heute.getMonth(), 1, 12));
    void (async () => {
      const [en, ro, ru, rm, za, tm, teams] = await Promise.all([
        c.from('regierapport').select('id', { count: 'exact', head: true }).eq('status', 'entwurf'),
        c.from('regierapport').select('betrag_rappen').in('status', ['versendet', 'rueckfrage']),
        c.from('regierapport').select('id', { count: 'exact', head: true }).or(`status.eq.frist_abgelaufen,and(status.eq.versendet,frist_bis.lt.${heuteIso})`),
        c.from('regierapport').select('betrag_rappen').gte('versendet_am', monatsStart).neq('status', 'entwurf'),
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).in('stand', ['bestellt', 'gemeldet']),
        c.from('tagesmeldung').select('team_id').eq('datum', heuteIso),
        c.from('team').select('id', { count: 'exact', head: true }).eq('aktiv', true),
      ]);
      setK({
        entwuerfe: en.count ?? 0,
        regieOffen: (ro.data ?? []).length,
        regieOffenRappen: (ro.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        regieUeberfaellig: ru.count ?? 0,
        regieMonatRappen: (rm.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        offeneAuftraege: za.count ?? 0,
        teamsGemeldet: new Set((tm.data ?? []).map((r) => r.team_id)).size,
        teams: teams.count ?? 0,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="lbl mb-0.5">Sekretariat</p>
            <h1 className="font-display text-2xl font-bold lg:text-3xl">{lang(heute)}</h1>
          </div>
          <Link to="/zusatzauftrag" className="cta hidden w-auto px-5 py-2.5 text-[15px] lg:block">+ Kunde ruft an</Link>
        </header>

        <Link to="/zusatzauftrag" className="block rounded-[14px] bg-accent p-5 text-white shadow-[0_3px_14px_rgb(216_40_22/0.35)] transition active:bg-accent-deep lg:hidden">
          <span className="block font-display text-lg font-extrabold">+ Kunde ruft an: Zusatzarbeit</span>
          <span className="mt-0.5 block text-sm text-white/85">Bestellung festhalten, während er noch am Telefon ist — der Bauführer sieht sie sofort</span>
        </Link>

        {k && (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-4">
            <Kachel zu="/regie" wert={String(k.regieOffen)} label={`Regierapporte beim Kunden · ${formatChf(k.regieOffenRappen)}`} />
            <Kachel zu="/regie" wert={String(k.regieUeberfaellig)} label="Frist abgelaufen — nachfassen" warn={k.regieUeberfaellig > 0} />
            <Kachel zu="/regie" wert={formatChf(k.regieMonatRappen)} label={`Regie an Kunden verschickt im ${MONATE[heute.getMonth()]}`} />
            <Kachel zu="/regie" wert={String(k.entwuerfe)} label="Entwürfe beim Bauführer" />
            <Kachel zu="/zusatzauftrag" wert={String(k.offeneAuftraege)} label="offene Zusatzaufträge" />
            <Kachel zu="/heute" wert={`${k.teamsGemeldet}/${k.teams}`} label="Teams haben heute gemeldet" />
          </div>
        )}

        <nav className="grid gap-3 lg:hidden">
          <NavKarte zu="/regie" titel="Regierapporte" text="Versand, Zustellnachweis, Fristen — nachfassen" />
          <NavKarte zu="/export" titel="Export" text="SORBA-Raster, Lohn-Excel, Temporärbüro" />
          <NavKarte zu="/cockpit" titel="Wochenübersicht" text="Nur ansehen — freigeben tut der Bauführer" />
          <NavKarte zu="/heute" titel="Tagesübersicht" text="Wer hat heute gemeldet, wer nicht" />
          <NavKarte zu="/board" titel="Board" text="Jahresplan — welches Team wann wo" />
          <NavKarte zu="/verwaltung" titel="Verwaltung" text="Mitarbeitende, Teams, Kunden, Baustellen" />
        </nav>
      </div>
    </Shell>
  );
}
