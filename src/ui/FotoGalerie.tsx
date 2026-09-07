import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Fotos aus dem Bucket «anhaenge» als Vorschau — signierte Links, 5 Minuten gültig.
 * Antippen öffnet das Bild in voller Grösse.
 */
export function FotoGalerie({ pfade, klein = false }: { pfade: string[]; klein?: boolean }) {
  const [urls, setUrls] = useState<{ pfad: string; url: string }[]>([]);

  useEffect(() => {
    if (!supabase || pfade.length === 0) { setUrls([]); return; }
    void supabase.storage.from('anhaenge').createSignedUrls(pfade, 300).then(({ data }) => {
      if (data) setUrls(data.flatMap((d) => (d.signedUrl ? [{ pfad: d.path ?? '', url: d.signedUrl }] : [])));
    });
  }, [pfade.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pfade.length === 0) return null;
  const groesse = klein ? 'h-14 w-14' : 'h-20 w-20';
  return (
    <div className="flex flex-wrap gap-1.5">
      {urls.map((u) => (
        <a key={u.pfad} href={u.url} target="_blank" rel="noreferrer" className={groesse + ' block overflow-hidden rounded-[8px] border border-line bg-ground'}>
          <img src={u.url} alt="Foto von der Baustelle" className="h-full w-full object-cover" loading="lazy" />
        </a>
      ))}
      {urls.length < pfade.length && <span className="self-center font-mono text-[11px] text-ink3">lädt …</span>}
    </div>
  );
}
