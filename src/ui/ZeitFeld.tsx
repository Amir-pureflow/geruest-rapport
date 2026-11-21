import { useEffect, useState } from 'react';

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
  useEffect(() => { if (!tippt) setText(wert); }, [wert, tippt]);
  const formatieren = (roh: string) => {
    const z = roh.replace(/\D/g, '').slice(0, 4);
    return z.length <= 2 ? z : z.slice(0, 2) + ':' + z.slice(2);
  };
  const abschliessen = () => {
    setTippt(false);
    const z = text.replace(/\D/g, '');
    if (z.length === 0) { setText(''); aendern(''); return; }
    const h = Math.min(23, Number(z.length === 3 ? z[0] : z.slice(0, 2)));
    const m = Math.min(59, z.length <= 2 ? 0 : Number(z.length === 3 ? z.slice(1) : z.slice(2)));
    const fertig = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    setText(fertig);
    aendern(fertig);
  };
  return (
    <input
      type="text" inputMode="numeric" autoComplete="off" enterKeyHint="done"
      value={tippt ? text : wert}
      placeholder="--:--"
      onFocus={(e) => { setTippt(true); setText(wert); e.target.select(); }}
      onChange={(e) => setText(formatieren(e.target.value))}
      onBlur={abschliessen}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      aria-label={label}
      className={klasse + ' placeholder:font-sans placeholder:text-ink3'}
    />
  );
}
