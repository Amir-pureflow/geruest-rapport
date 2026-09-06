import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { demoLaden, demoZuruecksetzen, type DemoZusammenfassung } from '../../lib/demo';
import { lokaleWarteschlangeLeeren } from '../../lib/db';

/**
 * Demo-Betrieb: ein kompletter Gerüstbaubetrieb auf Knopfdruck —
 * für Vorführungen, Tests und Schulung. Ersetzt ALLE Bewegungsdaten.
 */
export function Demo() {
  const [migrationOk, setMigrationOk] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [bestaetigen, setBestaetigen] = useState<'laden' | 'leeren' | null>(null);
  const [protokoll, setProtokoll] = useState<string[]>([]);
  const [ergebnis, setErgebnis] = useState<DemoZusammenfassung | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('kunde').select('email').limit(1).then(({ error }) => setMigrationOk(!error));
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const log = (z: string) => setProtokoll((p) => [...p, z]);

  async function laden() {
    if (!supabase || !userId) return;
    setLaeuft(true); setFehler(''); setErgebnis(null); setProtokoll([]);
    try {
      const r = await demoLaden(supabase, userId, log);
      setErgebnis(r);
      localStorage.removeItem('teamgeraet-team-id');
      await lokaleWarteschlangeLeeren();
      log('Lokale Warteschlange dieses Geräts geleert.');
    } catch (e) {
      setFehler((e as Error).message);
    }
    setLaeuft(false); setBestaetigen(null);
  }
  async function leeren() {
    if (!supabase) return;
    setLaeuft(true); setFehler(''); setErgebnis(null); setProtokoll([]);
    try {
      await demoZuruecksetzen(supabase, log);
      localStorage.removeItem('teamgeraet-team-id');
      await lokaleWarteschlangeLeeren();
      log('Lokale Warteschlange dieses Geräts geleert.');
    } catch (e) { setFehler((e as Error).message); }
    setLaeuft(false); setBestaetigen(null);
  }

  return (
    <div className="space-y-3">
      {migrationOk === false && (
        <div className="card border-accent/40 bg-accent-soft text-sm">
          <b>Migration 0005 fehlt.</b> Im Supabase-Dashboard → SQL Editor den Inhalt von
          <span className="font-mono"> supabase/migrations/0005_stammdaten.sql</span> ausführen, dann diese Seite neu laden.
        </div>
      )}

      <section className="card space-y-3 p-4">
        <p className="font-display text-lg font-bold">Demo-Betrieb</p>
        <p className="text-sm text-ink2">
          Erzeugt einen vollständigen Gerüstbaubetrieb: <b>75 Mitarbeitende</b> (45 fest, 30 temporär),
          5 Bauführer, <b>20 Teams</b> mit Chefmonteur, 30 Kunden mit Bauleitung, alle 217 Konten zugeordnet,
          Jahresplan, <b>fünf Wochen Tagesmeldungen</b>, Zusatzaufträge und Regierapporte in allen Stadien.
        </p>
        <p className="text-xs text-ink3">
          Kunden-Mails enden auf <span className="font-mono">.example</span> — aus der Demo geht nie eine Mail an eine echte fremde Adresse.
          Ersetzt alle bisherigen Bewegungsdaten; die 217 Konten bleiben.
        </p>
        <div className="flex flex-wrap gap-2">
          {bestaetigen === 'laden' ? (
            <>
              <button type="button" disabled={laeuft} onClick={() => void laden()} className="cta w-auto px-5 py-3 text-base">{laeuft ? 'Lädt …' : 'Ja, jetzt laden'}</button>
              <button type="button" onClick={() => setBestaetigen(null)} className="btn-ghost">Abbrechen</button>
            </>
          ) : (
            <button type="button" disabled={laeuft || migrationOk === false || !userId} onClick={() => setBestaetigen('laden')} className="cta w-auto px-5 py-3 text-base">Demo-Betrieb laden</button>
          )}
          {bestaetigen === 'leeren' ? (
            <>
              <button type="button" disabled={laeuft} onClick={() => void leeren()} className="btn-ghost text-accent-deep">Ja, alles leeren</button>
              <button type="button" onClick={() => setBestaetigen(null)} className="btn-ghost">Abbrechen</button>
            </>
          ) : (
            <button type="button" disabled={laeuft} onClick={() => setBestaetigen('leeren')} className="btn-ghost">Alles leeren</button>
          )}
        </div>
        {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
        {ergebnis && (
          <p className="rounded-[10px] bg-good-soft p-3 text-sm text-good-deep">
            Fertig: {ergebnis.mitarbeiter} Mitarbeitende, {ergebnis.teams} Teams, {ergebnis.kunden} Kunden, {ergebnis.meldungen} Tagesmeldungen mit {ergebnis.eintraege} Zeiteinträgen, {ergebnis.regierapporte} Regierapporte.
          </p>
        )}
        {protokoll.length > 0 && (
          <pre className="max-h-48 overflow-auto rounded-[10px] bg-surface-2 p-3 font-mono text-[11px] text-ink2">{protokoll.join('\n')}</pre>
        )}
      </section>
    </div>
  );
}
