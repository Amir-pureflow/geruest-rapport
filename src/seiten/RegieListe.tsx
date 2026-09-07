import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { formatChf } from '../lib/tarif';

interface Zeile {
  id: string;
  status: string;
  betrag_rappen: number | null;
  frist_bis: string | null;
  erstellt_am: string;
  versendet_am: string | null;
  bestaetigt_am: string | null;
  baustelle: { bezeichnung: string | null; konto_nr: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf',
  versendet: 'versendet',
  bestaetigt: 'bestätigt',
  rueckfrage: 'Rückfrage',
  frist_abgelaufen: 'Frist abgelaufen',
};

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function kurz(ts: string): string {
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/** Zeile in Worten: was ist wann passiert — dieselben Daten, die die Startseiten-Kacheln zählen. */
function verlauf(z: Zeile): string {
  if (z.status === 'entwurf') return `Entwurf vom ${kurz(z.erstellt_am)} — noch nicht verschickt`;
  const teile: string[] = [];
  if (z.versendet_am) teile.push(`verschickt ${kurz(z.versendet_am)}`);
  if (z.status === 'bestaetigt' && z.bestaetigt_am) teile.push(`bestätigt ${kurz(z.bestaetigt_am)}`);
  else if (z.status === 'versendet' && z.frist_bis) teile.push(`Frist bis ${kurz(z.frist_bis + 'T12:00:00')}`);
  else if (z.status === 'frist_abgelaufen') teile.push('Frist verstrichen — nachfassen');
  else if (z.status === 'rueckfrage') teile.push('Kunde hat eine Rückfrage');
  return teile.join(' · ');
}

const STATUS_STIL: Record<string, string> = {
  entwurf: 'bg-ground text-ink2',
  versendet: 'bg-steel-soft text-steel',
  bestaetigt: 'bg-good-soft text-good-deep',
  rueckfrage: 'bg-amber-100 text-amber-900',
  frist_abgelaufen: 'bg-accent-soft text-accent-deep',
};

export function RegieListe() {
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [laedt, setLaedt] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('regierapport')
      .select('id,status,betrag_rappen,frist_bis,erstellt_am,versendet_am,bestaetigt_am,baustelle:baustelle_id(bezeichnung,konto_nr)')
      .order('erstellt_am', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setZeilen(data as unknown as Zeile[]);
        setLaedt(false);
      });
  }, []);

  // Gruppen wie die Kacheln auf der Startseite: Entwürfe · beim Kunden · diesen Monat verschickt · früher
  const heute = new Date();
  const monatsStart = new Date(heute.getFullYear(), heute.getMonth(), 1).toISOString();
  const imMonat = (z: Zeile) => !!z.versendet_am && z.versendet_am >= monatsStart && z.status !== 'entwurf';
  const gruppen: { titel: string; hinweis?: string; zeilen: Zeile[] }[] = [
    { titel: 'Entwürfe — noch nicht verschickt', zeilen: zeilen.filter((z) => z.status === 'entwurf') },
    { titel: 'Beim Kunden — warten auf Bestätigung', zeilen: zeilen.filter((z) => ['versendet', 'rueckfrage', 'frist_abgelaufen'].includes(z.status)) },
    {
      titel: `Im ${MONATE[heute.getMonth()]} verschickt`,
      hinweis: 'Das ist die Summe auf der Startseite.',
      zeilen: zeilen.filter((z) => imMonat(z)),
    },
    { titel: 'Früher', zeilen: zeilen.filter((z) => z.status !== 'entwurf' && !imMonat(z) && !['versendet', 'rueckfrage', 'frist_abgelaufen'].includes(z.status)) },
  ];
  const summe = (l: Zeile[]) => l.reduce((s, z) => s + (z.betrag_rappen ?? 0), 0);

  return (
    <Shell zurueck>
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold">Regierapporte</h1>
        {zeilen.length === 0 && (
          <div className="card text-sm text-ink3">
            {laedt
              ? 'Lädt …'
              : 'Noch keine. Der Weg: Wochenübersicht → gelbe Verdachtskarte → «→ Regierapport».'}
          </div>
        )}
        {gruppen.filter((g) => g.zeilen.length > 0).map((g) => (
          <section key={g.titel} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="lbl mb-0">{g.titel} · {g.zeilen.length}</h2>
              <span className="font-mono text-xs text-ink3">{formatChf(summe(g.zeilen))}</span>
            </div>
            {g.hinweis && <p className="-mt-1 text-[11px] text-ink3">{g.hinweis}</p>}
            {g.zeilen.map((z) => (
          <Link key={z.id} to={`/regie/${z.id}`} className="card block hover:border-line-strong">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-[15px] font-bold">
                {z.baustelle?.bezeichnung ?? '—'}
              </span>
              <span
                className={
                  'rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ' +
                  (STATUS_STIL[z.status] ?? 'bg-ground text-ink3')
                }
              >
                {STATUS_LABEL[z.status] ?? z.status}
              </span>
            </div>
            <p className="mt-1 flex items-center gap-2 text-xs text-ink2">
              {z.baustelle && <span className="knr">{z.baustelle.konto_nr}</span>}
              {z.betrag_rappen != null && (
                <span className="font-mono font-semibold text-accent-deep">
                  {formatChf(z.betrag_rappen)}
                </span>
              )}
            </p>
            <p className="mt-1 text-[11px] text-ink3">{verlauf(z)}</p>
          </Link>
            ))}
          </section>
        ))}
      </div>
    </Shell>
  );
}
