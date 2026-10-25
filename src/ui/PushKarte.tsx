/**
 * Hinweis auf der Team-Startseite: Benachrichtigungen «Plan für morgen» einschalten (25.10.2026, Schritt 5).
 * Nur sichtbar, solange sie auf diesem Gerät nicht an sind — ist alles eingerichtet, steht hier nichts.
 * «Nicht jetzt» blendet ihn zwei Wochen aus.
 */
import { useEffect, useState } from 'react';
import { BellRing, Share } from 'lucide-react';
import { hinweisAusblenden, hinweisAusgeblendet, pushAbgleichen, pushEinschalten, pushStand, type PushStand } from '../lib/push';

export function PushKarte({ teamId }: { teamId: string }) {
  const [stand, setStand] = useState<PushStand | null>(null);
  const [aus, setAus] = useState(hinweisAusgeblendet);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [eben, setEben] = useState(false);

  useEffect(() => {
    let weg = false;
    void pushStand().then((s) => { if (!weg) setStand(s); });
    void pushAbgleichen(teamId);
    return () => { weg = true; };
  }, [teamId]);

  async function einschalten() {
    setLaeuft(true);
    setFehler(null);
    const f = await pushEinschalten(teamId);
    setLaeuft(false);
    if (f === 'blockiert') { setStand('blockiert'); return; }
    if (f === 'abgebrochen') return;
    if (f) { setFehler(f); return; }
    setStand('an');
    setEben(true);
    setTimeout(() => setEben(false), 4000);
  }

  if (eben) {
    return <p className="rounded-[14px] bg-good-soft px-4 py-2.5 text-sm font-medium text-good-deep" role="status">✓ Benachrichtigungen an — ab heute 16:00 kommt der Plan für morgen.</p>;
  }
  if (!stand || stand === 'an' || stand === 'nicht-moeglich' || aus) return null;

  return (
    <section className="card space-y-2.5" aria-label="Benachrichtigungen">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-steel-soft text-steel"><BellRing size={17} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">Plan für morgen aufs Handy</p>
          <p className="text-sm text-ink2">Jeden Arbeitstag um 16:00 — und sofort, wenn das Büro etwas ändert.</p>
        </div>
      </div>
      {stand === 'iphone-installieren' && (
        <p className="rounded-[12px] bg-ground px-3.5 py-2.5 text-sm text-ink2">
          Auf dem iPhone geht das nur mit Rapporto auf dem Home-Bildschirm: unten auf <Share size={14} className="-mt-0.5 inline" aria-label="Teilen" /> tippen,
          «Zum Home-Bildschirm», dann Rapporto von dort öffnen und hier einschalten.
        </p>
      )}
      {stand === 'blockiert' && (
        <p className="rounded-[12px] bg-amber-soft px-3.5 py-2.5 text-sm text-amber-deep">
          Benachrichtigungen sind für Rapporto blockiert. In den Einstellungen des Browsers (Schloss neben der Adresse) erlauben, dann neu laden.
        </p>
      )}
      {fehler && <p className="text-sm text-accent-deep" role="alert">{fehler}</p>}
      <div className="flex flex-wrap gap-2">
        {stand === 'aus' && (
          // Dunkel und klein: Rot gehört auf dieser Seite «Tag melden» (eine Hauptaktion je Bildschirm)
          <button type="button" disabled={laeuft} onClick={() => void einschalten()} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/90 disabled:opacity-50">
            {laeuft ? 'Schaltet ein …' : 'Einschalten'}
          </button>
        )}
        <button type="button" onClick={() => { hinweisAusblenden(); setAus(true); }} className="btn-ghost px-3.5 py-2 text-sm">Nicht jetzt</button>
      </div>
    </section>
  );
}
