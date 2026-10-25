/**
 * Posteingang (24.10.2026, Migration 0051): alles, was sich für diese Ansicht geändert hat — neu oben, darunter
 * «Früher». Ein Tipp markiert den Eintrag als gelesen und führt dorthin, wo man handelt (Startseite des Teams,
 * Regierapport, Wochenübersicht). Texte aus `eintragText()` (lib/posteingang.ts).
 */
import { useNavigate } from 'react-router-dom';
import { AlarmClock, CalendarClock, CheckCircle2, ClipboardPen, Inbox, MessageCircleQuestion, TriangleAlert, UserRound, type LucideIcon } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { useAnsicht } from '../lib/ansicht';
import { iso } from '../lib/datum';
import { alsGelesen, eintragText, istNeu, usePosteingang, wannText, type Eintrag } from '../lib/posteingang';

const ICON: Record<Eintrag['art'], LucideIcon> = {
  plan: CalendarClock, korrektur: ClipboardPen, rueckfrage: MessageCircleQuestion, bestaetigt: CheckCircle2, frist: AlarmClock, abweichung: TriangleAlert,
};

/** Bernstein für Hinweise (Plan, Abweichung, Frist), Rot nur, wo jemand handeln muss (Rückfrage), Grün für erledigt */
const TON: Record<Eintrag['art'], string> = {
  plan: 'bg-amber-soft text-amber-deep', abweichung: 'bg-amber-soft text-amber-deep', frist: 'bg-amber-soft text-amber-deep',
  rueckfrage: 'bg-accent-soft text-accent-deep', korrektur: 'bg-steel-soft text-steel', bestaetigt: 'bg-good-soft text-good-deep',
};

function Zeile({ e, heuteIso, jetzt, onWahl }: { e: Eintrag; heuteIso: string; jetzt: Date; onWahl: (e: Eintrag, ziel: string) => void }) {
  const t = eintragText(e, heuteIso);
  const neu = istNeu(e);
  const Icon = e.art === 'plan' && e.an === 'person' ? UserRound : ICON[e.art];
  return (
    <li>
      <button
        type="button"
        onClick={() => onWahl(e, t.ziel)}
        className="flex w-full items-start gap-3 rounded-[12px] px-3 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <span className={'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ' + (neu ? TON[e.art] : 'bg-surface-2 text-ink3')}>
          <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={'text-[14.5px] leading-snug ' + (neu ? 'font-semibold text-ink' : 'text-ink2')}>{t.titel}</span>
            <span className="shrink-0 text-[11.5px] text-ink3">{wannText(e.geaendert_am, jetzt)}</span>
          </span>
          {t.zeilen.length > 0 && (
            <span className="mt-0.5 block space-y-0.5">
              {t.zeilen.map((z, i) => <span key={i} className={'block text-[13.5px] leading-snug ' + (neu ? 'text-ink2' : 'text-ink3')}>{z}</span>)}
            </span>
          )}
          {e.erledigt_am && (e.art === 'rueckfrage' || e.art === 'frist' || e.art === 'abweichung') && (
            <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-good-deep"><CheckCircle2 size={12} aria-hidden="true" /> erledigt</span>
          )}
        </span>
        {neu && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="neu" />}
      </button>
    </li>
  );
}

export function Posteingang() {
  const ansicht = useAnsicht();
  const navigate = useNavigate();
  const p = usePosteingang(ansicht);
  const jetzt = new Date();
  const heuteIso = iso(jetzt);
  const neu = p.eintraege.filter(istNeu);
  const frueher = p.eintraege.filter((e) => !istNeu(e));
  const buero = ansicht === 'bauf' || ansicht === 'sekretariat';

  function waehlen(e: Eintrag, ziel: string) {
    void alsGelesen([e.id]);
    navigate(ziel);
  }

  const leer = buero
    ? 'Hier erscheinen Rückfragen und Bestätigungen der Kunden zu Regierapporten, abgelaufene Fristen und Meldungen mit Abweichung.'
    : ansicht === 'chef'
      ? 'Hier erscheint, wenn das Büro den Plan für heute oder den nächsten Arbeitstag ändert, jemand fehlt oder Stunden korrigiert werden.'
      : 'Hier erscheint, wenn du in einem anderen Team eingeteilt wirst oder das Büro deine Stunden korrigiert.';

  return (
    <Shell schmal>
      <div className="space-y-5">
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold">Posteingang</h1>
            <p className="text-sm text-ink3">{neu.length === 0 ? 'Nichts Neues' : neu.length === 1 ? '1 neu' : `${neu.length} neu`}</p>
          </div>
          {neu.length > 0 && (
            <button type="button" className="btn-ghost shrink-0 whitespace-nowrap text-xs" onClick={() => void alsGelesen(neu.map((e) => e.id))}>
              Alle gelesen
            </button>
          )}
        </header>

        {p.fehler && (
          <p className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep" role="status">
            {navigator.onLine ? 'Posteingang konnte gerade nicht geladen werden.' : 'Ohne Netz — gezeigt wird der letzte Stand.'}
          </p>
        )}

        {!p.geladen ? (
          <p className="card text-sm text-ink3">Lädt …</p>
        ) : p.eintraege.length === 0 ? (
          <div className="card flex items-start gap-3">
            <Inbox size={20} className="mt-0.5 shrink-0 text-ink3" aria-hidden="true" />
            <p className="text-sm text-ink2">{leer}</p>
          </div>
        ) : (
          <>
            {neu.length > 0 && (
              <section aria-label="Neu">
                <h2 className="mb-1.5 px-1 text-xs font-medium text-ink3">Neu</h2>
                <ul className="card divide-y divide-line p-1.5">
                  {neu.map((e) => <Zeile key={e.id} e={e} heuteIso={heuteIso} jetzt={jetzt} onWahl={waehlen} />)}
                </ul>
              </section>
            )}
            {frueher.length > 0 && (
              <section aria-label="Früher">
                <h2 className="mb-1.5 px-1 text-xs font-medium text-ink3">Früher</h2>
                <ul className="card divide-y divide-line p-1.5">
                  {frueher.map((e) => <Zeile key={e.id} e={e} heuteIso={heuteIso} jetzt={jetzt} onWahl={waehlen} />)}
                </ul>
              </section>
            )}
            <p className="px-1 text-xs text-ink3">Einträge der letzten 30 Tage.</p>
          </>
        )}
      </div>
    </Shell>
  );
}
