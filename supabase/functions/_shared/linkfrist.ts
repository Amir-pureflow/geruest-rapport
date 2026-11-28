// Wie lange der Kunden-Link gilt (Entscheid Amir 28.11.2026): 60 Tage nach dem (letzten) Versand, nach der
// Bestätigung noch 30 Tage. Danach zeigt der Link nichts mehr — auch keine Beträge oder Fotos. Ein neuer Versand aus der
// App setzt versendet_am neu und öffnet den Link wieder. Im Entwurf zeigt er ohnehin nur «wird überarbeitet».
//
// Beim Deploy über die CLI (`--use-api`) wird diese Datei mitgebündelt; über den MCP neben index.ts als `./linkfrist.ts`.

export const LINK_TAGE_NACH_VERSAND = 60;
export const LINK_TAGE_NACH_BESTAETIGUNG = 30;
const TAG_MS = 86_400_000;

/** Ist der Link abgelaufen? `jetzt` in ms (Date.now()). Ohne Versanddatum: nicht abgelaufen (alter Datensatz). */
export function linkAbgelaufen(
  r: { status: string; versendet_am: string | null; bestaetigt_am?: string | null },
  jetzt: number,
): boolean {
  if (r.status === 'entwurf') return false;
  if (r.status === 'bestaetigt' && r.bestaetigt_am) return jetzt > Date.parse(r.bestaetigt_am) + LINK_TAGE_NACH_BESTAETIGUNG * TAG_MS;
  if (r.versendet_am) return jetzt > Date.parse(r.versendet_am) + LINK_TAGE_NACH_VERSAND * TAG_MS;
  return false;
}

export const ABGELAUFEN_TEXT = 'Dieser Link ist abgelaufen. Bitte melden Sie sich beim Absender, wenn Sie den Regierapport nochmals brauchen.';
