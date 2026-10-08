/**
 * Koppelseite `/e/:token` — was der Monteur sieht, wenn er den WhatsApp-Link antippt.
 *
 * Erreichbar **ohne Anmeldung**, wie der Kundenlink `/b/:token`. Das ist der ganze Sinn:
 * Das Gerät hat noch keine Sitzung und soll eine bekommen, ohne dass jemand tippt.
 *
 * Drei Zustände, mehr gibt es nicht:
 *   prüfen   — wir fragen die Edge Function, wer eingeladen ist
 *   fragen   — «Bist du das, Ismail?» mit einem grossen Knopf
 *   fertig   — gekoppelt, weiter zur Startseite
 *
 * Bewusst eine Rückfrage statt sofortigem Koppeln: Die Linkvorschau von WhatsApp ruft die
 * Adresse selbst auf. Würde schon das Öffnen den Link verbrauchen, wäre er weg, bevor der
 * Monteur ihn antippt. Darum verändert das Laden nichts, erst der Knopf.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Marke, Wortmarke } from '../ui/Shell';
import { einladungPruefen, koppeln, type Koppelansicht } from '../lib/einladung';
import { ansichtSetzen } from '../lib/ansicht';

const MONTEUR_KEY = 'monteur-id';

export function Koppeln() {
  const { token } = useParams<{ token: string }>();
  const [name, setName] = useState('');
  const [ansicht, setAnsicht] = useState<Koppelansicht>('monteur');
  const [fehler, setFehler] = useState('');
  const [phase, setPhase] = useState<'pruefen' | 'fragen' | 'laeuft' | 'fertig'>('pruefen');

  useEffect(() => {
    if (!token) { setFehler('Dieser Link ist unvollständig.'); setPhase('fragen'); return; }
    void (async () => {
      const r = await einladungPruefen(token);
      if ('fehler' in r) { setFehler(r.fehler); setPhase('fragen'); return; }
      setName(r.name);
      setAnsicht(r.ansicht);
      setPhase('fragen');
    })();
  }, [token]);

  async function losKoppeln() {
    if (!token || phase === 'laeuft') return;
    setPhase('laeuft');
    setFehler('');
    const r = await koppeln(token);
    if ('fehler' in r) { setFehler(r.fehler); setPhase('fragen'); return; }

    // Das Gerät weiss ab jetzt, wer es ist: Ansicht und Person liegen lokal, genau wie wenn
    // man sie von Hand gewählt hätte (StartMonteur, StartChef).
    ansichtSetzen(r.ansicht);
    try { if (r.mitarbeiterId) localStorage.setItem(MONTEUR_KEY, r.mitarbeiterId); } catch { /* privater Modus */ }
    setName(r.name);
    setPhase('fertig');

    // Ganz neu laden, nicht nur die Adresse wechseln — die App prüft die Anmeldung beim Start.
    setTimeout(() => location.replace('/'), 1200);
  }

  const vorname = name.trim().split(/\s+/)[0];
  const rolle = ansicht === 'chef' ? 'Chefmonteur' : 'Monteur';

  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center"><Marke className="h-16 w-16 rounded-[18px]" /></div>
          <p><Wortmarke gross /></p>
        </div>

        <div className="card space-y-4 text-center">
          {phase === 'pruefen' && <p className="py-6 text-sm text-ink2">Einen Moment …</p>}

          {phase === 'fertig' && (
            <>
              <p className="font-display text-xl font-bold">Fertig{vorname ? `, ${vorname}` : ''}.</p>
              <p className="text-sm text-ink2">Dieses Handy ist jetzt dein Zugang. Du musst dich nie wieder anmelden.</p>
            </>
          )}

          {(phase === 'fragen' || phase === 'laeuft') && (
            <>
              {fehler ? (
                <>
                  <p className="font-display text-lg font-bold">Das geht nicht</p>
                  <p className="text-sm text-ink2">{fehler}</p>
                  <p className="text-xs text-ink3">Melde dich beim Bauführer, er schickt dir einen neuen Link.</p>
                </>
              ) : (
                <>
                  <p className="font-display text-xl font-bold">Bist du das{vorname ? `, ${vorname}` : ''}?</p>
                  <p className="text-sm text-ink2">
                    Dann richten wir Rapporto auf diesem Handy ein — als {rolle}. Einmal antippen, danach nie wieder.
                  </p>
                  <button
                    type="button"
                    onClick={() => void losKoppeln()}
                    disabled={phase === 'laeuft'}
                    className="w-full rounded-full bg-gradient-to-br from-[#ff6d4c] via-accent to-[#9c1409] px-5 py-3.5 text-base font-semibold text-white shadow-[0_10px_22px_-10px_rgb(224_48_30/0.7)] transition hover:-translate-y-px disabled:opacity-60"
                  >
                    {phase === 'laeuft' ? 'Einen Moment …' : `Ja, das bin ich`}
                  </button>
                  <p className="text-xs text-ink3">Bist du das nicht, schliess diese Seite einfach.</p>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
