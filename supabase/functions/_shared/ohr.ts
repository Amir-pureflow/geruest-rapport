// Das Ohr: Aufnahme → Text in der Sprache des Sprechers (Azure AI Speech, sonst Mistral Voxtral).
// Gemeinsam für `transkribieren` (die App) und den Prüfstand. Beim Deploy über die CLI wird diese Datei mitgebündelt.
//
// Geprüft 13.10.2026: Eine Phrasenliste (deutsche Baustellenwörter) hilft Azure nicht — in einem spanischen, albanischen
// oder arabischen Satz bleibt «Gerüst» «Jerust», auch mit starker Gewichtung. Solche Wörter richtet die Übersetzung.

/** Sprachcode aus dem Profil → Azure-Gebietsschema. Deutsch als de-CH: Hochdeutsch mit Schweizer Zunge. */
export const AZURE_GEBIET: Record<string, string> = { de: 'de-CH', sq: 'sq-AL', pt: 'pt-PT', it: 'it-IT', fr: 'fr-FR', es: 'es-ES', ar: 'ar-SY', pl: 'pl-PL', en: 'en-US' };

/**
 * Das Ohr, Fassung Azure: schnelle Transkription, ein Aufruf, Antwort in Sekunden.
 *
 * Azure meldet bei knapper Kapazität 429 «Resource Exhausted» — je Region und je Sprachmodell
 * (beobachtet am 04.10.2026: de-CH lief in Frankfurt sofort, sq-AL wurde minutenlang abgewiesen).
 * Darum: in der Region kurz wiederholen, dann auf die Ausweichregion wechseln, falls mit
 * `AZURE_SPEECH_KEY2`/`AZURE_SPEECH_REGION2` eine zweite Ressource hinterlegt ist. Schlüssel
 * gelten nur in ihrer Region, deshalb braucht die Ausweichregion einen eigenen.
 */
async function sttAzure(k: Record<string, string>, datei: Blob, dateiname: string, sprache: string): Promise<string> {
  const ressourcen: { basis: string; schluessel: string }[] = [
    {
      basis: (k.AZURE_SPEECH_ENDPOINT || `https://${k.AZURE_SPEECH_REGION || 'germanywestcentral'}.api.cognitive.microsoft.com`).replace(/\/$/, ''),
      schluessel: k.AZURE_SPEECH_KEY,
    },
  ];
  if (k.AZURE_SPEECH_KEY2) {
    ressourcen.push({
      basis: `https://${k.AZURE_SPEECH_REGION2 || 'westeurope'}.api.cognitive.microsoft.com`,
      schluessel: k.AZURE_SPEECH_KEY2,
    });
  }

  let letzter = '';
  let holprig: string | null = null;
  for (const quelle of ressourcen) {
    for (let versuch = 0; versuch < 2; versuch++) {
      if (versuch > 0) await new Promise((w) => setTimeout(w, 2500));
      const form = new FormData();
      form.append('audio', datei, dateiname);
      // Kein Fluchwort-Filter: es gilt, was der Sprecher sagt (Regel: nichts umdeuten) — bereinigt wird später
      form.append('definition', JSON.stringify({ locales: [AZURE_GEBIET[sprache] ?? 'de-CH'], profanityFilterMode: 'None' }));
      const r = await fetch(`${quelle.basis}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': quelle.schluessel },
        body: form,
      });
      if (r.status === 429) { letzter = 'überlastet'; continue; }
      if (!r.ok) throw new Error(`Azure-Erkennung ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j = (await r.json()) as { combinedPhrases?: { text?: string }[] };
      const text = (j.combinedPhrases ?? []).map((p) => p.text ?? '').join(' ').trim();
      if (!text) throw new Error('Erkennung lieferte keinen Text');
      // Lall-Schleife («hëhhhh hëhhh …», 04.10.2026 bei Albanisch passiert): nochmal versuchen,
      // notfalls über die Ausweichregion — die verhält sich oft anders. Bleibt es dabei,
      // geht der holprige Text trotzdem raus: der Sprecher sieht ihn im Prüfschritt.
      if (istLallSchleife(text)) { holprig = text; letzter = 'stottern'; continue; }
      return text;
    }
  }
  if (holprig) return holprig;
  throw new Error(letzter === 'überlastet'
    ? 'Die Erkennung ist gerade überlastet — einen Moment warten und nochmals antippen.'
    : 'Erkennung nicht erreichbar');
}

/**
 * Entgleiste Erkennung: das Modell verhakt sich bei Atmen/Wind/Pausen und lallt («hëhhhhhh»).
 * Kennzeichen: «Wörter» ab 6 Zeichen aus höchstens 2 verschiedenen Buchstaben, oder dasselbe
 * Wort viermal hintereinander. Keine unserer Sprachen schreibt so.
 */
function istLallSchleife(text: string): boolean {
  const woerter = text.toLowerCase().split(/\s+/).filter(Boolean);
  const lall = woerter.filter((w) => {
    const buchstaben = w.replace(/[^\p{L}]/gu, '');
    return buchstaben.length >= 6 && new Set(buchstaben).size <= 2;
  }).length;
  if (lall >= 2 || lall / Math.max(1, woerter.length) > 0.2) return true;
  let gleich = 1;
  for (let i = 1; i < woerter.length; i++) {
    gleich = woerter[i] === woerter[i - 1] && woerter[i].length >= 2 ? gleich + 1 : 1;
    if (gleich >= 4) return true;
  }
  return false;
}

/** Schritt 1 — das Ohr: Aufnahme → Text in der Sprache des Sprechers (roh, so wie gesprochen). */
export async function stt(k: Record<string, string>, datei: Blob, dateiname: string, sprache: string): Promise<string> {
  if (k.AZURE_SPEECH_KEY) return sttAzure(k, datei, dateiname, sprache);
  const modell = k.TRANSKRIPT_MODELL || 'voxtral-mini-latest';
  const form = new FormData();
  form.append('file', datei, dateiname);
  form.append('model', modell);
  form.append('language', sprache);
  const erk = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k.MISTRAL_API_KEY}` },
    body: form,
  });
  if (!erk.ok) throw new Error(`Erkennung ${erk.status}: ${(await erk.text()).slice(0, 300)}`);
  const erkannt = (await erk.json()) as { text?: string };
  const original = (erkannt.text ?? '').trim();
  if (!original) throw new Error('Erkennung lieferte keinen Text');
  return original;
}
