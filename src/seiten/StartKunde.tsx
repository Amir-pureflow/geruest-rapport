/**
 * Ansicht «Kunde»: So sieht es die Bauleitung. Sie bekommt per Mail einen Link (/b/<token>)
 * und braucht kein Konto. Diese Seite listet die verschickten Rapporte, damit man den Link
 * ohne Mail öffnen kann — zum Zeigen und Testen.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { formatChf } from '../lib/tarif';
import { supabase } from '../lib/supabase';
import { kurz } from '../lib/datum';

interface Rapport {
  id: string; nummer: string | null; status: string; betrag_rappen: number | null; link_token: string;
  versendet_am: string | null; frist_bis: string | null; empfaenger_email: string | null;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
}

const STATUS: Record<string, string> = {
  versendet: 'wartet auf Bestätigung',
  rueckfrage: 'Rückfrage gestellt',
  frist_abgelaufen: 'Frist abgelaufen',
  bestaetigt: 'bestätigt',
};

export function StartKunde() {
  const [liste, setListe] = useState<Rapport[]>([]);
  const [laedt, setLaedt] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('regierapport')
      .select('id,nummer,status,betrag_rappen,link_token,versendet_am,frist_bis,empfaenger_email,baustelle:baustelle_id(konto_nr,bezeichnung)')
      .neq('status', 'entwurf')
      .order('versendet_am', { ascending: false })
      .limit(30)
      .then(({ data }) => { setListe((data ?? []) as unknown as Rapport[]); setLaedt(false); });
  }, []);

  return (
    <Shell>
      <div className="space-y-5">
        <header>
          <p className="lbl mb-0.5">Kunde · Bauleitung</p>
          <h1 className="font-display text-2xl font-bold">Regierapporte zum Bestätigen</h1>
          <p className="mt-1 text-sm text-ink3">
            Die Bauleitung bekommt eine Mail mit einem Link und braucht kein Konto. Hier sind die Links zum Öffnen, so wie der Kunde sie sieht.
          </p>
        </header>

        {laedt && <p className="text-sm text-ink3">lädt …</p>}
        {!laedt && liste.length === 0 && (
          <div className="card space-y-2 text-sm">
            <p>Noch kein Regierapport verschickt.</p>
            <p className="text-ink3">Als Bauführer einen Rapport senden — dann erscheint er hier mit dem Kundenlink.</p>
            <Link to="/b/demo-token" className="btn-ghost inline-block">Beispiel ansehen ›</Link>
          </div>
        )}

        {liste.map((r) => (
          <Link key={r.id} to={`/b/${r.link_token}`} className="card block space-y-1 hover:border-line-strong">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display font-bold">{r.baustelle?.bezeichnung ?? 'Baustelle'}</span>
              <span className="font-mono text-sm tabular-nums">{formatChf(r.betrag_rappen ?? 0)}</span>
            </div>
            <p className="text-xs text-ink3">
              {r.baustelle && <><span className="knr">{r.baustelle.konto_nr}</span> · </>}
              {r.nummer ? `${r.nummer} · ` : ''}
              {r.versendet_am ? `verschickt ${kurz(new Date(r.versendet_am))}` : ''}
              {r.frist_bis ? ` · Frist ${kurz(new Date(r.frist_bis + 'T12:00:00'))}` : ''}
            </p>
            <p className={'text-xs font-semibold ' + (r.status === 'bestaetigt' ? 'text-good-deep' : r.status === 'frist_abgelaufen' ? 'text-accent-deep' : 'text-steel')}>
              {STATUS[r.status] ?? r.status} ›
            </p>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
