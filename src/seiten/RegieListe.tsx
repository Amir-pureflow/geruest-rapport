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
  baustelle: { bezeichnung: string | null; konto_nr: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf',
  versendet: 'versendet',
  bestaetigt: 'bestätigt',
  rueckfrage: 'Rückfrage',
  frist_abgelaufen: 'Frist abgelaufen',
};

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
      .select('id,status,betrag_rappen,frist_bis,erstellt_am,baustelle:baustelle_id(bezeichnung,konto_nr)')
      .order('erstellt_am', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setZeilen(data as unknown as Zeile[]);
        setLaedt(false);
      });
  }, []);

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
        {zeilen.map((z) => (
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
              {z.frist_bis && z.status === 'versendet' && (
                <span className="text-ink3">Frist bis {z.frist_bis}</span>
              )}
            </p>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
