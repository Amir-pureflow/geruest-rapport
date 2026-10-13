// Kontext für die Übersetzung einer Sprachnotiz (13.10.2026): auf welcher Baustelle das Team war und wer im Team ist.
// Die Spracherkennung verstümmelt Namen («Aarstrasse» → «artrase», «Arstrasse»); mit dem Kontext schreibt die
// Übersetzung sie richtig. Nur Zeilen der eigenen Firma — die Function läuft mit der Service-Role.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { zuerichDatum } from './zugang.ts';

export async function kontextLaden(
  supa: SupabaseClient,
  firma: string,
  q: { team_id?: string | null; baustelle_id?: string | null; datum?: string | null },
): Promise<string | null> {
  try {
    const teile: string[] = [];
    const tag = q.datum && /^\d{4}-\d{2}-\d{2}$/.test(q.datum) ? q.datum : zuerichDatum(new Date());

    const { data: team } = q.team_id
      ? await supa.from('team').select('id, chefmonteur:chefmonteur_id(name)').eq('id', q.team_id).eq('firma_id', firma).maybeSingle()
      : { data: null };

    // Baustelle: die gewählte, sonst die heute geplante(n) des Teams
    let ids: string[] = q.baustelle_id ? [q.baustelle_id] : [];
    if (ids.length === 0 && team) {
      const { data } = await supa.from('jahresplan').select('baustelle_id').eq('firma_id', firma).eq('team_id', team.id).lte('von', tag).gte('bis', tag);
      ids = ((data ?? []) as { baustelle_id: string | null }[]).map((x) => x.baustelle_id).filter((x): x is string => !!x);
    }
    if (ids.length > 0) {
      const { data } = await supa.from('baustelle').select('bezeichnung, strasse, ort').eq('firma_id', firma).in('id', ids.slice(0, 3));
      for (const b of (data ?? []) as { bezeichnung: string | null; strasse: string | null; ort: string | null }[]) {
        const name = [b.bezeichnung, b.strasse, b.ort].filter(Boolean).join(', ');
        if (name) teile.push(`Baustelle «${name}»`);
      }
    }

    // Leute im Team: Chefmonteur und aktuelle Mitglieder
    if (team) {
      const namen = new Set<string>();
      const chef = (team as unknown as { chefmonteur: { name: string } | null }).chefmonteur;
      if (chef?.name) namen.add(chef.name);
      const { data } = await supa.from('team_mitglied').select('mitarbeiter:mitarbeiter_id(name)').eq('team_id', team.id).is('bis', null);
      for (const m of (data ?? []) as unknown as { mitarbeiter: { name: string } | null }[]) if (m.mitarbeiter?.name) namen.add(m.mitarbeiter.name);
      if (namen.size > 0) teile.push(`Leute im Team: ${[...namen].slice(0, 12).join(', ')}`);
    }
    return teile.length > 0 ? teile.join('; ') : null;
  } catch {
    // Ohne Kontext geht es auch — er ist nur eine Hilfe für Namen
    return null;
  }
}
