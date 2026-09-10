/**
 * Sprachnotiz sichtbar machen — zwei Bausteine:
 *  - Pegel: echte Lautstärkebalken vom Mikrofon, solange aufgenommen wird (Web Audio Analyser, Canvas).
 *  - TranskriptLive: nach dem Speichern erscheint der Text aus der Aufnahme Zeichen für Zeichen,
 *    sobald die KI fertig ist (Edge Function «transkribieren», Abfrage alle 2.5 s, höchstens 45 s).
 * Beides respektiert «Bewegung reduzieren»: dann statische Balken und der Text erscheint auf einmal.
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const SPRACHE: Record<string, string> = { de: 'Deutsch', ar: 'Arabisch', pl: 'Polnisch', en: 'Englisch' };

function bewegungReduziert(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Lautstärkebalken vom Mikrofon. `stream` = der laufende getUserMedia-Stream, sonst ruhige Balken. */
export function Pegel({ stream, farbe = '#d82816' }: { stream: MediaStream | null; farbe?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const BALKEN = 28;
    const dpr = window.devicePixelRatio || 1;
    const breite = canvas.clientWidth;
    const hoehe = canvas.clientHeight;
    canvas.width = breite * dpr;
    canvas.height = hoehe * dpr;
    ctx.scale(dpr, dpr);

    function zeichnen(pegel: number[]) {
      if (!ctx) return;
      ctx.clearRect(0, 0, breite, hoehe);
      const abstand = breite / BALKEN;
      const b = Math.max(3, abstand * 0.55);
      for (let i = 0; i < BALKEN; i++) {
        const h = Math.max(3, pegel[i] * hoehe);
        const x = i * abstand + (abstand - b) / 2;
        const y = (hoehe - h) / 2;
        ctx.fillStyle = farbe;
        ctx.globalAlpha = 0.35 + pegel[i] * 0.65;
        ctx.beginPath();
        ctx.roundRect(x, y, b, h, b / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (!stream || bewegungReduziert()) {
      zeichnen(Array.from({ length: BALKEN }, (_, i) => 0.12 + 0.08 * Math.abs(Math.sin(i * 0.9))));
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audio = new AudioCtx();
    const quelle = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    quelle.connect(analyser);
    const daten = new Uint8Array(analyser.frequencyBinCount);
    let laeuft = true;
    let frame = 0;
    const tick = () => {
      if (!laeuft) return;
      analyser.getByteFrequencyData(daten);
      // Sprachfrequenzen liegen in den unteren Bins — gleichmässig auf die Balken verteilen, spiegelnd zur Mitte
      const nutz = Math.floor(daten.length * 0.6);
      const halb = Math.ceil(BALKEN / 2);
      const pegel: number[] = [];
      for (let i = 0; i < halb; i++) {
        const von = Math.floor((i / halb) * nutz);
        const bis = Math.max(von + 1, Math.floor(((i + 1) / halb) * nutz));
        let s = 0;
        for (let j = von; j < bis; j++) s += daten[j];
        pegel.push(Math.min(1, (s / (bis - von)) / 200));
      }
      const voll = [...pegel].reverse().concat(pegel).slice(0, BALKEN);
      zeichnen(voll);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      laeuft = false;
      cancelAnimationFrame(frame);
      quelle.disconnect();
      void audio.close();
    };
  }, [stream, farbe]);

  return <canvas ref={canvasRef} className="h-14 w-full" aria-hidden="true" />;
}

/**
 * Text aus der Sprachnotiz, live nach dem Speichern.
 * `clientUuid` = die Meldung in der Warteschlange; `stand` = ob sie schon gesendet ist.
 */
export function TranskriptLive({ clientUuid, stand }: { clientUuid: string; stand: 'gesendet' | 'wartet' | 'fehler' }) {
  const [zustand, setZustand] = useState<'wartet' | 'fertig' | 'fehler' | 'spaeter'>('wartet');
  const [text, setText] = useState('');
  const [quelle, setQuelle] = useState<{ text: string; sprache: string } | null>(null);
  const [fehler, setFehler] = useState('');
  const [sichtbar, setSichtbar] = useState(0);

  // Abfragen, bis der Text da ist
  useEffect(() => {
    if (!supabase || stand !== 'gesendet') return;
    const c = supabase;
    let aktiv = true;
    const start = Date.now();
    const pruefen = async () => {
      const { data, error } = await c
        .from('tagesmeldung')
        .select('transkript,transkript_quelle,transkript_sprache,transkript_fehler')
        .eq('client_uuid', clientUuid)
        .maybeSingle();
      if (!aktiv) return;
      if (error && /transkript_\w+ does not exist/.test(error.message)) { setZustand('spaeter'); return; }
      if (data?.transkript) {
        setText(data.transkript);
        if (data.transkript_quelle && data.transkript_sprache && data.transkript_sprache !== 'de') setQuelle({ text: data.transkript_quelle, sprache: data.transkript_sprache });
        setZustand('fertig');
        return;
      }
      if (data?.transkript_fehler) { setFehler(data.transkript_fehler); setZustand('fehler'); return; }
      if (Date.now() - start > 45000) { setZustand('spaeter'); return; }
      window.setTimeout(() => void pruefen(), 2500);
    };
    window.setTimeout(() => void pruefen(), 2000);
    return () => { aktiv = false; };
  }, [clientUuid, stand]);

  // Schreibmaschine: Zeichen für Zeichen, ausser bei «Bewegung reduzieren»
  useEffect(() => {
    if (zustand !== 'fertig') return;
    if (bewegungReduziert()) { setSichtbar(text.length); return; }
    setSichtbar(0);
    const id = window.setInterval(() => {
      setSichtbar((n) => {
        if (n >= text.length) { window.clearInterval(id); return n; }
        return n + 1;
      });
    }, 22);
    return () => window.clearInterval(id);
  }, [zustand, text]);

  if (stand !== 'gesendet') {
    return (
      <section className="card">
        <p className="lbl mb-1">Sprachnotiz</p>
        <p className="text-sm text-ink2">Gespeichert. Der Text entsteht, sobald die Meldung gesendet ist.</p>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3">
        <p className="lbl mb-1">Sprachnotiz · Text</p>
        {zustand === 'fertig' && quelle && <span className="text-[11px] text-ink3">übersetzt aus {SPRACHE[quelle.sprache] ?? quelle.sprache}</span>}
      </div>

      {zustand === 'wartet' && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-steel">
            <span className="ki-punkt" /><span className="ki-punkt" style={{ animationDelay: '0.2s' }} /><span className="ki-punkt" style={{ animationDelay: '0.4s' }} />
            <span className="ml-1">Aufnahme wird zu Text …</span>
          </p>
          <div className="space-y-1.5">
            <div className="ki-schimmer h-3 w-11/12 rounded" />
            <div className="ki-schimmer h-3 w-3/4 rounded" style={{ animationDelay: '0.15s' }} />
            <div className="ki-schimmer h-3 w-1/2 rounded" style={{ animationDelay: '0.3s' }} />
          </div>
        </div>
      )}

      {zustand === 'fertig' && (
        <div className="space-y-2">
          <p className="rounded-[10px] bg-ground px-3 py-2 text-[15px] leading-relaxed text-ink">
            «{text.slice(0, sichtbar)}{sichtbar < text.length && <span className="ki-cursor" />}»
          </p>
          {quelle && sichtbar >= text.length && (
            <details className="text-xs text-ink3">
              <summary className="cursor-pointer">Original ({SPRACHE[quelle.sprache] ?? quelle.sprache}) anzeigen</summary>
              <p className="mt-1 whitespace-pre-line">{quelle.text}</p>
            </details>
          )}
          {sichtbar >= text.length && <p className="text-xs text-ink3">Der Bauführer liest das in der Wochenübersicht. Die Aufnahme bleibt als Beleg.</p>}
        </div>
      )}

      {zustand === 'fehler' && (
        <p className="text-sm text-ink2">
          Text konnte nicht erstellt werden. Die Aufnahme ist gespeichert, der Bauführer kann sie anhören.
          <span className="mt-1 block text-[11px] text-ink3">{fehler}</span>
        </p>
      )}

      {zustand === 'spaeter' && (
        <p className="text-sm text-ink2">Die Aufnahme ist gespeichert. Der Text erscheint in Kürze in der Wochenübersicht des Bauführers.</p>
      )}
    </section>
  );
}
