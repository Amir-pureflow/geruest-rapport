// Wetter laden (25.10.2026, Migration 0054): Lokalprognose von MeteoSchweiz (Open Data, «Quelle: MeteoSchweiz»).
//
// Die Datenbank ruft diese Function alle zwei Stunden zweimal auf (pg_cron → wetter_anstossen → pg_net):
//   {"teil":"tage"}  — Tageswerte: Piktogramm (jp2000d0), Höchst-/Tiefstwert (tre200px/pn), Regen (rka150p0); je ~1 MB
//   {"teil":"boeen"} — stärkste Böe 06–18 Uhr Ortszeit aus den Stundenwerten (fu3010h1, ~33 MB, gestreamt)
// Zwei Aufrufe, damit jeder unter der Rechenzeit der Function bleibt. Gelesen werden alle ~6000 Punkte, behalten nur die,
// die eine Baustelle oder ein Werkhof braucht (`wetter_punkte_noetig()`). Die Punkte selbst (`wetter_ort`) werden
// geladen, wenn sie fehlen oder älter als 7 Tage sind.
//
// Zugang: nur mit dem Geheimnis `WETTER_GEHEIM` aus `konfiguration` im Kopf `x-wetter-geheim`. Deploy: verify_jwt false.
import { createClient } from 'npm:@supabase/supabase-js@2';

const B = 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting';
const json = (daten: unknown, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

function gleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const zahl = (s: string | undefined) => {
  if (s === undefined) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** Neuester Prognoselauf: von der aktuellen Stunde rückwärts, bis die Datei da ist */
async function neuesterLauf(param: string): Promise<{ url: (p: string) => string; zeit: string } | null> {
  const jetzt = Date.now();
  for (let h = 0; h < 30; h++) {
    const t = new Date(jetzt - h * 3600e3);
    const tag = t.toISOString().slice(0, 10).replace(/-/g, '');
    const stunde = String(t.getUTCHours()).padStart(2, '0');
    const url = (p: string) => `${B}/${tag}-ch/vnut12.lssw.${tag}${stunde}00.${p}.csv`;
    const r = await fetch(url(param), { method: 'HEAD' });
    if (r.ok) return { url, zeit: `${t.toISOString().slice(0, 13)}:00:00Z` };
  }
  return null;
}

/** Zeilen einer CSV-Datei (Latin-1, «;») einzeln — ohne die ganze Datei als Text im Speicher */
async function* zeilen(url: string): AsyncGenerator<string> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`${url.split('/').pop()}: ${r.status}`);
  const reader = r.body.pipeThrough(new TextDecoderStream('latin1')).getReader();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const teile = (rest + value).split('\n');
    rest = teile.pop() ?? '';
    for (const z of teile) yield z;
  }
  if (rest) yield rest;
}

/** Ortszeit (Europe/Zurich) zu «JJJJMMTTHHMM» in UTC: [Datum JJJJ-MM-TT, Stunde] — je Zeitpunkt nur einmal gerechnet */
const zuerich = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const ortszeitCache = new Map<string, [string, number]>();
function ortszeit(utc: string): [string, number] {
  let v = ortszeitCache.get(utc);
  if (!v) {
    const d = new Date(Date.UTC(+utc.slice(0, 4), +utc.slice(4, 6) - 1, +utc.slice(6, 8), +utc.slice(8, 10), +utc.slice(10, 12)));
    const t = Object.fromEntries(zuerich.formatToParts(d).map((p) => [p.type, p.value]));
    v = [`${t.year}-${t.month}-${t.day}`, +t.hour];
    ortszeitCache.set(utc, v);
  }
  return v;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ fehler: 'nur POST' }, 405);
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: konf, error: kf } = await supa.from('konfiguration').select('wert').eq('schluessel', 'WETTER_GEHEIM').maybeSingle();
  if (kf) return json({ fehler: 'konfiguration: ' + kf.message }, 500);
  const geheim = (konf as { wert: string } | null)?.wert;
  if (!geheim || !gleich(req.headers.get('x-wetter-geheim') ?? '', geheim)) return json({ fehler: 'kein Zugang' }, 401);
  const teil = ((await req.json().catch(() => ({}))) as { teil?: string }).teil === 'boeen' ? 'boeen' : 'tage';

  try {
    // 1. Punkte (Stationen und PLZ-Mittelpunkte), wenn sie fehlen oder älter als 7 Tage sind
    if (teil === 'tage') {
      const { data: alt } = await supa.from('wetter_ort').select('geladen_am').order('geladen_am').limit(1);
      const stand = (alt as { geladen_am: string }[] | null)?.[0]?.geladen_am;
      if (!stand || Date.now() - new Date(stand).getTime() > 7 * 86400e3) {
        const orte: Record<string, unknown>[] = [];
        const schon = new Set<string>(); // die Liste führt einzelne Stationen doppelt (25.10.2026: Seengen, Gadmen, Kiental …)
        let kopf: string[] | null = null;
        for await (const z of zeilen(`${B}/ogd-local-forecasting_meta_point.csv`)) {
          const f = z.replace(/\r$/, '').split(';');
          if (!kopf) { kopf = f; continue; }
          const r = Object.fromEntries(kopf.map((k, i) => [k, f[i]]));
          const typ = Number(r.point_type_id);
          if (typ !== 1 && typ !== 2) continue;
          const lat = zahl(r.point_coordinates_wgs84_lat as string);
          const lon = zahl(r.point_coordinates_wgs84_lon as string);
          if (lat === null || lon === null || schon.has(`${typ};${r.point_id}`)) continue;
          schon.add(`${typ};${r.point_id}`);
          orte.push({ typ, punkt_id: Number(r.point_id), plz: r.postal_code || null, name: r.point_name, lat, lon, geladen_am: new Date().toISOString() });
        }
        for (let i = 0; i < orte.length; i += 1000) {
          const { error } = await supa.from('wetter_ort').upsert(orte.slice(i, i + 1000), { onConflict: 'typ,punkt_id' });
          if (error) return json({ fehler: 'wetter_ort: ' + error.message }, 500);
        }
      }
    }

    // 2. Welche Punkte gebraucht werden
    const { data: noetig, error: nf } = await supa.rpc('wetter_punkte_noetig');
    if (nf) return json({ fehler: 'wetter_punkte_noetig: ' + nf.message }, 500);
    const punkte = new Set(((noetig ?? []) as { typ: number; punkt_id: number }[]).map((p) => `${p.punkt_id};${p.typ}`));
    if (punkte.size === 0) return json({ teil, punkte: 0 });

    // 3. Neuester Lauf
    const lauf = await neuesterLauf(teil === 'tage' ? 'jp2000d0' : 'fu3010h1');
    if (!lauf) return json({ fehler: 'kein Prognoselauf gefunden' }, 502);

    const werte = new Map<string, Record<string, unknown>>();
    const zeile = (key: string, typ: number, id: number, datum: string) => {
      let w = werte.get(key);
      if (!w) { w = { typ, punkt_id: id, datum, lauf: lauf.zeit }; werte.set(key, w); }
      return w;
    };
    // Eine Zeile: «point_id;point_type_id;JJJJMMTTHHMM;Wert» — der Schlüssel «id;typ» steht vorne, so reicht ein Vergleich
    const lesen = async (param: string, nimm: (id: number, typ: number, zeit: string, wert: number | null) => void) => {
      for await (const z of zeilen(lauf.url(param))) {
        const a = z.indexOf(';');
        const b = z.indexOf(';', a + 1);
        if (a < 0 || b < 0 || !punkte.has(z.slice(0, b))) continue;
        const c = z.indexOf(';', b + 1);
        nimm(Number(z.slice(0, a)), Number(z.slice(a + 1, b)), z.slice(b + 1, c), zahl(z.slice(c + 1).trim()));
      }
    };

    if (teil === 'tage') {
      // Tageswerte: Zeitstempel 00:00 des Tages
      const tag = (zeit: string) => `${zeit.slice(0, 4)}-${zeit.slice(4, 6)}-${zeit.slice(6, 8)}`;
      const felder: [string, string][] = [['jp2000d0', 'symbol'], ['tre200px', 'tmax'], ['tre200pn', 'tmin'], ['rka150p0', 'regen_mm']];
      for (const [param, feld] of felder) {
        await lesen(param, (id, typ, zeit, wert) => {
          const d = tag(zeit);
          zeile(`${id};${typ};${d}`, typ, id, d)[feld] = wert;
        });
      }
    } else {
      // Böen: Stundenwert endet zur angegebenen Zeit — 06–18 Uhr Ortszeit = Stunden, die um 7 bis 18 Uhr enden
      await lesen('fu3010h1', (id, typ, zeit, wert) => {
        if (wert === null) return;
        const [d, h] = ortszeit(zeit);
        if (h < 7 || h > 18) return;
        const w = zeile(`${id};${typ};${d}`, typ, id, d);
        if (!(typeof w.boe_kmh === 'number' && w.boe_kmh >= wert)) w.boe_kmh = wert;
      });
    }

    const liste = [...werte.values()];
    for (let i = 0; i < liste.length; i += 1000) {
      const { error } = await supa.from('wetter').upsert(liste.slice(i, i + 1000), { onConflict: 'typ,punkt_id,datum' });
      if (error) return json({ fehler: 'wetter: ' + error.message }, 500);
    }
    return json({ teil, lauf: lauf.zeit, punkte: punkte.size, zeilen: liste.length });
  } catch (e) {
    return json({ fehler: String(e).slice(0, 300) }, 502);
  }
});
