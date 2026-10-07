import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { demoLaden, demoZuruecksetzen, type DemoUmfang, type DemoZusammenfassung } from '../../lib/demo';
import { lokaleWarteschlangeLeeren } from '../../lib/db';

/**
 * Demo-Betrieb: ein kompletter Gerüstbaubetrieb auf Knopfdruck —
 * für Vorführungen, Tests und Schulung. Ersetzt ALLE Bewegungsdaten.
 */
export function Demo() {
  const [migrationOk, setMigrationOk] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [bestaetigen, setBestaetigen] = useState<DemoUmfang | 'leeren' | null>(null);
  const [protokoll, setProtokoll] = useState<string[]>([]);
  const [ergebnis, setErgebnis] = useState<DemoZusammenfassung | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('kunde').select('email').limit(1).then(({ error }) => setMigrationOk(!error));
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const log = (z: string) => setProtokoll((p) => [...p, z]);

  async function laden(umfang: DemoUmfang) {
    if (!supabase || !userId) return;
    setLaeuft(true); setFehler(''); setErgebnis(null); setProtokoll([]);
    try {
      const r = await demoLaden(supabase, userId, log, umfang);
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
        <p className="font-display text-lg font-semibold">Demo-Betrieb</p>
        <p className="text-sm text-ink2">
          Für Vorführungen: ein übersichtlicher Betrieb mit <b>5 Teams</b> à drei Leuten, 2 Bauführern, <b>6 Kunden</b> und
          <b> drei Wochen</b> Tagesmeldungen. Jedes Team spricht eine andere Sprache (Deutsch, Französisch, Italienisch,
          Portugiesisch, Polnisch). Die Vorwoche bleibt zum Prüfen offen, Team 3 hat heute noch nicht gemeldet — das lässt sich
          live auf dem Handy zeigen. Am besten am Tag der Vorführung laden.
        </p>
        <p className="text-xs text-ink3">
          Der grosse Betrieb (20 Teams, 75 Mitarbeitende, 30 Kunden, fünf Wochen) ist der aus dem Launch-Video.
        </p>
        <p className="text-xs text-ink3">
          Kunden-Mails enden auf <span className="font-mono">.example</span> — aus der Demo geht nie eine Mail an eine echte fremde Adresse.
          Ersetzt alle bisherigen Bewegungsdaten; die Kontonummern bleiben, ihre Namen werden durch erfundene ersetzt.
        </p>
        <div className="flex flex-wrap gap-2">
          {bestaetigen === 'klein' || bestaetigen === 'gross' ? (
            <>
              <button type="button" disabled={laeuft} onClick={() => void laden(bestaetigen)} className="cta w-auto px-5 py-3 text-base">{laeuft ? 'Lädt …' : 'Ja, jetzt laden'}</button>
              <button type="button" onClick={() => setBestaetigen(null)} className="btn-ghost">Abbrechen</button>
              <span className="self-center text-xs text-ink3">{bestaetigen === 'klein' ? 'Vorführung · 5 Teams' : 'Grosser Betrieb · 20 Teams'}</span>
            </>
          ) : (
            <>
              <button type="button" disabled={laeuft || migrationOk === false || !userId} onClick={() => setBestaetigen('klein')} className="cta w-auto px-5 py-3 text-base">Demo-Betrieb laden</button>
              <button type="button" disabled={laeuft || migrationOk === false || !userId} onClick={() => setBestaetigen('gross')} className="btn-ghost">Grosser Betrieb (Video)</button>
            </>
          )}
        </div>
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm text-ink2">
            Löscht alle Tagesmeldungen und Zeiteinträge. Stammdaten bleiben.
          </p>
          {bestaetigen === 'leeren' ? (
            <div className="rounded-[10px] border border-accent/40 bg-accent-soft p-3 text-sm">
              <p className="font-semibold">Wirklich alles leeren? Das lässt sich nicht rückgängig machen.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={laeuft} onClick={() => void leeren()} className="cta w-auto px-5 py-2.5 text-sm">{laeuft ? 'Leert …' : 'Ja, alles leeren'}</button>
                <button type="button" onClick={() => setBestaetigen(null)} className="btn-ghost">Abbrechen</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={laeuft} onClick={() => setBestaetigen('leeren')} className="cta w-auto px-5 py-2.5 text-sm">Alles leeren</button>
          )}
        </div>
        {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
        {ergebnis && (
          <p className="rounded-[10px] bg-good-soft p-3 text-sm text-good-deep">
            Fertig: {ergebnis.mitarbeiter} Mitarbeitende, {ergebnis.teams} Teams, {ergebnis.kunden} Kunden, {ergebnis.meldungen} Tagesmeldungen mit {ergebnis.eintraege} Zeiteinträgen.
            {ergebnis.regierapporte !== undefined && ` Dazu ${ergebnis.regierapporte} Regierapporte in allen Stadien.`}
          </p>
        )}
        {protokoll.length > 0 && (
          <pre className="max-h-48 overflow-auto rounded-[10px] bg-surface-2 p-3 font-mono text-[11px] text-ink2">{protokoll.join('\n')}</pre>
        )}
      </section>
    </div>
  );
}
