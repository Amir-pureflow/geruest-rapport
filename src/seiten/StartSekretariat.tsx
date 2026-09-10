/**
 * Startseite Sekretariat: Kundenanrufe festhalten, Regierapporte im Blick, Export, Stammdaten.
 * Freigeben tut der Bauführer — die Wochenübersicht ist hier nur zum Ansehen.
 * Am PC zusätzlich die Liste «Nachfassen»: Regierapporte, deren Frist verstrichen ist.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { Kachel, MONATE, NavKarte } from '../ui/Karten';
import { DiagrammKarte, RegieMonate, Trichter } from '../ui/Diagramm';
import { regieMonate, trichter, type RegieMonat, type TrichterDaten } from '../lib/kennzahlen';
import { formatChf } from '../lib/tarif';
import { supabase } from '../lib/supabase';
import { ausIso, iso, kurz, lang } from '../lib/datum';

interface Kennzahlen {
  entwuerfe: number;
  regieOffen: number;
  regieOffenRappen: number;
  regieUeberfaellig: number;
  regieMonatRappen: number;
  offeneAuftraege: number;
  ohneMeldung: number;
  teamsGemeldet: number;
  teams: number;
}

interface Nachfassen {
  id: string;
  nummer: string | null;
  status: string;
  betrag_rappen: number | null;
  versendet_am: string | null;
  frist_bis: string | null;
  empfaenger_email: string | null;
  baustelle: { bezeichnung: string | null; konto_nr: string } | null;
}

export function StartSekretariat() {
  const [k, setK] = useState<Kennzahlen | null>(null);
  const [nachfassen, setNachfassen] = useState<Nachfassen[]>([]);
  const [monate, setMonate] = useState<RegieMonat[] | null>(null);
  const [tr, setTr] = useState<TrichterDaten | null>(null);
  const heute = new Date();

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    const heuteIso = iso(heute);
    const monatsStart = iso(new Date(heute.getFullYear(), heute.getMonth(), 1, 12));
    const ueberfaellig = `status.eq.frist_abgelaufen,and(status.eq.versendet,frist_bis.lt.${heuteIso})`;
    void (async () => {
      const [en, ro, ru, rm, za, om, tm, teams, nf] = await Promise.all([
        c.from('regierapport').select('id', { count: 'exact', head: true }).eq('status', 'entwurf'),
        c.from('regierapport').select('betrag_rappen').in('status', ['versendet', 'rueckfrage']),
        c.from('regierapport').select('id', { count: 'exact', head: true }).or(ueberfaellig),
        c.from('regierapport').select('betrag_rappen').gte('versendet_am', monatsStart).neq('status', 'entwurf'),
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).in('stand', ['bestellt', 'gemeldet']),
        c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).eq('ohne_meldung', true),
        c.from('tagesmeldung').select('team_id').eq('datum', heuteIso),
        c.from('team').select('id', { count: 'exact', head: true }).eq('aktiv', true),
        c.from('regierapport')
          .select('id,nummer,status,betrag_rappen,versendet_am,frist_bis,empfaenger_email,baustelle:baustelle_id(bezeichnung,konto_nr)')
          .or(ueberfaellig)
          .order('frist_bis', { ascending: true })
          .limit(30),
      ]);
      setK({
        entwuerfe: en.count ?? 0,
        regieOffen: (ro.data ?? []).length,
        regieOffenRappen: (ro.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        regieUeberfaellig: ru.count ?? 0,
        regieMonatRappen: (rm.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
        offeneAuftraege: za.count ?? 0,
        ohneMeldung: om.count ?? 0,
        teamsGemeldet: new Set((tm.data ?? []).map((r) => r.team_id)).size,
        teams: teams.count ?? 0,
      });
      setNachfassen((nf.data ?? []) as unknown as Nachfassen[]);
      // Diagramme danach — die Kacheln und die Nachfassliste sollen nicht darauf warten
      const [mo, t] = await Promise.all([regieMonate(c), trichter(c)]);
      setMonate(mo);
      setTr(t);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="lbl mb-0.5">Sekretariat</p>
            <h1 className="font-display text-2xl font-semibold lg:text-3xl">{lang(heute)}</h1>
          </div>
          <Link to="/zusatzauftrag" className="cta cta-accent hidden w-auto px-5 py-2.5 lg:block">+ Kunde ruft an</Link>
        </header>

        <Link to="/zusatzauftrag" className="cta cta-accent block p-5 text-left lg:hidden">
          <span className="block text-[17px] font-semibold">+ Kunde ruft an: Zusatzauftrag</span>
          <span className="mt-0.5 block text-sm text-white/85">Bestellung festhalten, während er noch am Telefon ist — der Bauführer sieht sie sofort</span>
        </Link>

        {k && (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-4">
            <Kachel zu="/regie" wert={String(k.regieOffen)} label={`Regierapporte beim Kunden · ${formatChf(k.regieOffenRappen)}`} />
            <Kachel zu="/regie" wert={String(k.regieUeberfaellig)} label="Frist abgelaufen — nachfassen" warn={k.regieUeberfaellig > 0} />
            <Kachel zu="/regie" wert={formatChf(k.regieMonatRappen)} label={`Regie an Kunden verschickt im ${MONATE[heute.getMonth()]}`} />
            <Kachel zu="/regie" wert={String(k.entwuerfe)} label="Entwürfe beim Bauführer" />
            <Kachel zu="/zusatzauftrag" wert={String(k.offeneAuftraege)} label="offene Zusatzaufträge" />
            <Kachel zu="/zusatzauftrag" wert={String(k.ohneMeldung)} label="Bestellungen ohne Meldung — geplanter Tag vorbei, Team hat nichts gemeldet" warn={k.ohneMeldung > 0} />
            <Kachel zu="/heute" wert={`${k.teamsGemeldet}/${k.teams}`} label="Teams haben heute gemeldet" />
          </div>
        )}

        {/* Am PC: Geldverlauf und Trichter — die Nachfassliste darunter ist die Arbeit */}
        <div className="hidden gap-4 lg:grid lg:grid-cols-2">
          {monate && (
            <DiagrammKarte
              titel="Regie je Monat"
              unter="Verschickt an Kunden, davon bestätigt"
              aktion={<Link to="/auswertung" className="text-xs font-semibold text-steel">Auswertung ›</Link>}
            >
              <RegieMonate monate={monate} />
            </DiagrammKarte>
          )}
          {tr && (
            <DiagrammKarte
              titel="Zusatzaufträge"
              unter="Wo sie stehen — letzte 60 Tage, Stand abgeleitet"
              aktion={<Link to="/zusatzauftrag" className="text-xs font-semibold text-steel">Neu erfassen ›</Link>}
            >
              <Trichter stufen={tr.stufen} ohneMeldung={tr.ohneMeldung} />
            </DiagrammKarte>
          )}
        </div>

        {k && (
          <section className="hidden lg:block">
            <div className="flex items-baseline justify-between">
              <h2 className="lbl mb-0">Nachfassen · {nachfassen.length}</h2>
              <Link to="/regie" className="text-xs font-semibold text-steel">Alle Regierapporte ›</Link>
            </div>
            {nachfassen.length === 0 ? (
              <p className="card mt-2 text-sm text-ink3">Nichts zum Nachfassen — keine Frist ist verstrichen.</p>
            ) : (
              <div className="card mt-2 divide-y divide-line p-0">
                {nachfassen.map((r) => (
                  <Link key={r.id} to={`/regie/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-ground">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {r.baustelle?.bezeichnung ?? '—'}
                        {r.nummer && <span className="ml-1.5 font-mono text-xs text-ink3">{r.nummer}</span>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink3">
                        {r.baustelle && <span className="knr">{r.baustelle.konto_nr}</span>}
                        {r.versendet_am && <span>verschickt {kurz(new Date(r.versendet_am))}</span>}
                        {r.frist_bis && <span className="font-semibold text-accent-deep">Frist war {lang(ausIso(r.frist_bis))}</span>}
                        {r.empfaenger_email && <span>{r.empfaenger_email}</span>}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm font-semibold tabular-nums text-accent-deep">{formatChf(r.betrag_rappen ?? 0)}</span>
                      <span className="text-ink3" aria-hidden="true">›</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
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
