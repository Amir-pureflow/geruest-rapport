/** Aus «Mercedes Sprinter · BE 71 997» nur das Kennzeichen: das interessiert auf der Baustelle, nicht das Modell. */
export function kennzeichen(fahrzeug: string | null | undefined): string {
  if (!fahrzeug) return '';
  const treffer = fahrzeug.match(/\b[A-Z]{2}\s?\d[\d\s']*\b/);
  return (treffer ? treffer[0] : fahrzeug.split('·').pop() ?? fahrzeug).trim();
}
