import { useEffect, useState } from 'react';

/**
 * Getippte Ziffern → «HH:MM». «730» → 07:30, «17» → 17:00, «0715» → 07:15, leer → '' (Zeit löschen).
 * Ungültig → null: Stunde über 23 oder Minute über 59 («1775», «799», «25»). Vorher wurde still auf 23/59
 * begrenzt — aus dem Tippfehler «1775» wurde 17:59 statt 17:15 oder 17:45 (Prüfung 28.11.2026).
 */
export function zeitLesen(roh: string): string | null {
  const z = roh.replace(/\D/g, '').slice(0, 4);
  if (z.length === 0) return '';
  const h = Number(z.length === 3 ? z[0] : z.slice(0, 2));
  const m = z.length <= 2 ? 0 : Number(z.length === 3 ? z.slice(1) : z.slice(2));
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Uhrzeit-Feld: tippen öffnet weiterhin die native Uhrzeit-Wahl (Regel 2, keine Tastatur),
 * aber die Anzeige malt die App selbst — native Felder zeigen je nach Handysprache
 * «7:00 AM», im schmalen Feld abgeschnitten als «Al»/«Pl» (Amir, 04.10.2026).
 */
export function ZeitFeld({ wert, aendern, label, klasse }: { wert: string; aendern: (text: string) => void; label: string; klasse: string }) {
  // Eigenes Feld statt <input type="time">: immer 24 h, nie AM/PM — auch beim Tippen
  // (Entscheid Amir, 05.10.2026; native Felder richten sich nach der Gerätesprache).
  // Ziffern reichen: «730» wird 07:30, «17» wird 17:00, leer löscht die Zeit.
  const [tippt, setTippt] = useState(false);
  const [text, setText] = useState(wert);
  /** Letzte Eingabe war keine Uhrzeit: alter Wert bleibt, Feld rot, bis wieder getippt wird */
  const [ungueltig, setUngueltig] = useState(false);
  useEffect(() => { if (!tippt) setText(wert); }, [wert, tippt]);
  const formatieren = (roh: string) => {
    const z = roh.replace(/\D/g, '').slice(0, 4);
    return z.length <= 2 ? z : z.slice(0, 2) + ':' + z.slice(2);
  };
  const abschliessen = () => {
    setTippt(false);
    const fertig = zeitLesen(text);
    if (fertig === null) { setUngueltig(true); setText(wert); return; }
    setUngueltig(false);
    setText(fertig);
    aendern(fertig);
  };
  return (
    <input
      type="text" inputMode="numeric" autoComplete="off" enterKeyHint="done"
      value={tippt ? text : wert}
      placeholder="--:--"
      onFocus={(e) => { setTippt(true); setUngueltig(false); setText(wert); e.target.select(); }}
      onChange={(e) => setText(formatieren(e.target.value))}
      onBlur={abschliessen}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      aria-label={label}
      aria-invalid={ungueltig || undefined}
      title={ungueltig ? 'Keine gültige Uhrzeit — z. B. 1745 für 17:45' : undefined}
      className={klasse + ' placeholder:font-sans placeholder:text-ink3' + (ungueltig ? ' ring-2 ring-accent text-accent-deep' : '')}
    />
  );
}
