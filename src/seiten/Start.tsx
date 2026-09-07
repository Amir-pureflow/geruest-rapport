import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { formatChf } from '../lib/tarif';
import { supabase } from '../lib/supabase';
import { addTage, iso, lang, montag } from '../lib/datum';
import { flushNachSupabase, offeneAnzahl } from '../lib/db';

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
}

function NavKarte({ zu, titel, text }: { zu: string; titel: string; text: string }) {
  return (
    <Link to={zu} className="card flex items-center justify-between gap-3 hover:border-line-strong">
      <span>
        <span className="block font-display text-[16px] font-bold">{titel}</span>
        <span className="block text-sm text-ink3">{text}</span>
      </span>
      <span className="text-ink3" aria-hidden="true">›</span>
    </Link>
  );
}

function Kachel({ zu, wert, label, warn }: { zu: string; wert: string; label: string; warn?: boolean }) {
  return (
    <Link to={zu} className={'card block hover:border-line-strong ' + (warn ? 'border-accent/40' : '')}>
      <span className={'block font-display text-2xl font-extrabold tabular-nums ' + (warn ? 'text-accent-deep' : '')}>{wert}</span>
      <span className="block text-xs text-ink3">{label}</span>
    </Link>
  );
}

export function Start() {
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
        c.from('team').select('id', { count: 'exact', head: true }).eq('aktiv', true),
        c.from('zeiteintrag').select('id,tagesmeldung!inner(datum)', { count: 'exact', head: true }).eq('status', 'offen').lt('tagesmeldung.datum', wochenStart),
        c.from('regierapport').select('betrag_rappen').in('status', ['versendet', 'rueckfrage']),
        c.from('regierapport').select('id', { count: 'exact', head: true }).or(`status.eq.frist_abgelaufen,and(status.eq.versendet,frist_bis.lt.${heuteIso})`),
        c.from('regierapport').select('betrag_rappen').gte('erstellt_am', monatsStart).neq('status', 'entwurf'),
      ]);
      setK({
        offeneAuftraege: za.count ?? 0,
        heuteGeplant: zaHeute.count ?? 0,
        teamsGemeldet: new Set((tm.data ?? []).map((r) => r.team_id)).size,
        teams: teams.count ?? 0,
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
        <header className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl font-bold">{lang(heute)}</h1>
          <span className="flex items-center gap-1.5 font-mono text-xs text-ink3">
            <span className={'inline-block h-2 w-2 rounded-full ' + (supabase ? 'bg-good' : 'bg-accent')} />
            {supabase ? 'verbunden' : 'offline-Modus'}
          </span>
        </header>

        <Link to="/zusatzauftrag" className="block rounded-[14px] bg-accent p-5 text-white shadow-[0_3px_14px_rgb(216_40_22/0.35)] transition active:bg-accent-deep">
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
          <div className="grid grid-cols-2 gap-2.5">
            <Kachel zu="/heute" wert={`${k.teamsGemeldet}/${k.teams}`} label="Teams haben heute gemeldet" warn={k.teamsGemeldet < k.teams && heute.getDay() >= 1 && heute.getDay() <= 5 && heute.getHours() >= 17} />
            <Kachel zu="/cockpit" wert={String(k.zuPruefen)} label="Zeiteinträge warten auf Freigabe" warn={k.zuPruefen > 0} />
            <Kachel zu="/zusatzauftrag" wert={String(k.offeneAuftraege)} label={k.heuteGeplant > 0 ? `offene Zusatzaufträge · ${k.heuteGeplant} heute` : 'offene Zusatzaufträge'} />
            <Kachel zu="/regie" wert={String(k.regieOffen)} label={`Regierapporte beim Kunden · ${formatChf(k.regieOffenRappen)}`} />
            <Kachel zu="/regie" wert={String(k.regieUeberfaellig)} label="Frist abgelaufen — nachfassen" warn={k.regieUeberfaellig > 0} />
            <Kachel zu="/regie" wert={formatChf(k.regieMonatRappen)} label="Regie verschickt diesen Monat" />
          </div>
        )}

        <nav className="grid gap-3">
          <NavKarte zu="/erfassung?wahl" titel="Erfassung" text="Teamgerät — ein Knopf für den normalen Tag" />
          <NavKarte zu="/cockpit" titel="Wochenübersicht" text="Prüfen und freigeben, statt telefonieren" />
          <NavKarte zu="/regie" titel="Regierapporte" text="Versand, Zustellnachweis und Fristen" />
          <NavKarte zu="/board" titel="Board" text="Jahresplan — welches Team wann wo" />
          <NavKarte zu="/export" titel="Export" text="SORBA-Raster, Lohn-Excel, Temporärbüro" />
          <NavKarte zu="/verwaltung" titel="Verwaltung" text="Mitarbeitende, Teams, Kunden, Baustellen" />
          <NavKarte zu="/b/demo-token" titel="Kundenlink" text="So bestätigt die Bauleitung — ohne Konto" />
        </nav>

        <p className="text-center text-[11px] text-ink3">Woche {kw(heute)} · {iso(montag(heute))} bis {iso(addTage(montag(heute), 6))}</p>
      </div>
    </Shell>
  );
}

function kw(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const tag = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - tag);
  const start = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - start.getTime()) / 86400000 + 1) / 7);
}
