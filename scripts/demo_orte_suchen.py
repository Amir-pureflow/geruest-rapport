"""Demo-Baustellen (src/lib/demo.ts, BAUSTELLEN_NAMEN) bekommen echte Adressen in der Region Bern — gesucht mit der
Adresssuche des Bundes (geo.admin.ch SearchServer, wie die App). Ausgabe: TypeScript-Zeilen für DEMO_ORTE.
   python scripts/demo_orte_suchen.py
Nur für den Demo-Betrieb (We-Plan): erfundene Projekte an echten Adressen, damit Tageskarte und Wetter etwas zeigen."""
import json, re, sys, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding='utf-8')
# Name → Suchtext (Adresse in der Bezeichnung, sonst eine passende Adresse im genannten Quartier/Ort)
SUCHE = {
    'Wohnüberbauung Brünnenpark, Haus B': 'Gilberte-de-Courgenay-Platz 4 Bern',
    'Mehrfamilienhaus Lorrainestrasse 18': 'Lorrainestrasse 18 Bern',
    'Neubau Wankdorffeld, Baufeld C': 'Wankdorffeldstrasse 98 Bern',
    'Dachsanierung Kramgasse 41': 'Kramgasse 41 Bern',
    'Siedlung Holenacker, Etappe 2': 'Holenackerstrasse 65 Bern',
    'Gewerbehaus Liebefeld Süd': 'Schwarzenburgstrasse 160 Liebefeld',
    'Fassade Kirchenfeldstrasse 27': 'Kirchenfeldstrasse 27 Bern',
    'Alterszentrum Ostermundigen, Anbau': 'Bernstrasse 70 Ostermundigen',
    'Fassade Monbijoustrasse 55': 'Monbijoustrasse 55 Bern',
    'Reihenhäuser Muri, Thunstrasse': 'Thunstrasse 50 Muri bei Bern',
    'Schulanlage Zollikofen, Turnhalle': 'Bernstrasse 100 Zollikofen',
    'Bürohaus Weltpoststrasse 9': 'Weltpoststrasse 9 Bern',
    'Brückensanierung Worblaufen': 'Tiefenaustrasse 2 Ittigen',
    'Wohnüberbauung Ittigen Talmatt': 'Talgut-Zentrum 5 Ittigen',
    'Dachstock Gerechtigkeitsgasse 12': 'Gerechtigkeitsgasse 12 Bern',
    'Mehrfamilienhaus Wabern, Gurtenweg 6': 'Gurtenweg 6 Wabern',
    'Hotel Aarblick, Fassade': 'Aarstrasse 76 Bern',
    'Pflegeheim Lindenegg, Neubau': 'Lindenrain 4 Bern',
    'Lagerhalle Niederwangen': 'Freiburgstrasse 590 Niederwangen',
    'Wohnhaus Belp, Aemmenmatt 3': 'Aemmenmattstrasse 3 Belp',
    'Sanierung Breitenrainplatz 4': 'Breitenrainplatz 42 Bern',
    'Neubau Köniz Zentrum, Haus A': 'Stapfenstrasse 13 Köniz',
    'Fassade Bollwerk 21': 'Bollwerk 21 Bern',
    'Villa Elfenauweg 8': 'Elfenauweg 8 Bern',
    'Schulhaus Steigerhubel, Dach': 'Steigerhubelstrasse 65 Bern',
    'Mehrfamilienhaus Burgdorf, Kirchbühl 7': 'Kirchbühl 7 Burgdorf',
    'Turmgerüst Kirche Münsingen': 'Schlossstrasse 4 Münsingen',
    'Wohnüberbauung Thun Lerchenfeld': 'Lerchenfeldstrasse 20 Thun',
    'Gewerbebau Lyss, Industriering 14': 'Industriering 14 Lyss',
    'Balkonsanierung Bethlehem, Block 4': 'Bethlehemstrasse 150 Bern',
    'Fassade Schwarztorstrasse 70': 'Schwarztorstrasse 70 Bern',
    'Wohnhaus Bremgarten, Kalchackerstr. 5': 'Kalchackerstrasse 5 Bremgarten bei Bern',
    'Neubau Worb, Bahnhofareal': 'Bahnhofstrasse 10 Worb',
    'Treppenhaus Länggasse, Fabrikstrasse 12': 'Fabrikstrasse 12 Bern',
    'Dachsanierung Ostermundigen Rüti': 'Rütiweg 10 Ostermundigen',
    'Kindergarten Wylerfeld': 'Wylerfeldstrasse 20 Bern',
    'Mehrfamilienhaus Spiegel, Föhrenweg 7': 'Föhrenweg 7 Spiegel bei Bern',
    'Lift-Anbau Seftigenstrasse 41': 'Seftigenstrasse 41 Bern',
    'Fassade Effingerstrasse 30': 'Effingerstrasse 30 Bern',
    'Reparatur Vordach Bümpliz Nord': 'Bümplizstrasse 100 Bern',
    'Wohnhaus Hinterkappelen, Aumatt 2': 'Aumattstrasse 2 Hinterkappelen',
    'Sanierung Schosshalde, Laubeggstrasse 9': 'Laubeggstrasse 9 Bern',
    'Dachfenster Marktgasse 16': 'Marktgasse 16 Bern',
    'Neubau Gümligen, Feldstrasse 3': 'Feldstrasse 3 Gümligen',
}
BERN = (46.948, 7.447)


def suche(text):
    q = urllib.parse.urlencode({'searchText': text, 'type': 'locations', 'origins': 'address', 'sr': '4326', 'limit': '3'})
    with urllib.request.urlopen('https://api3.geo.admin.ch/rest/services/api/SearchServer?' + q, timeout=20) as r:
        return json.load(r).get('results', [])


def teile(label):
    label = re.sub(r'<[^>]+>', '', label).strip()                 # «Kramgasse 41 3011 Bern»
    m = re.match(r'^(.*?)\s+(\d{4})\s+(.+)$', label)
    return (m.group(1), m.group(2), m.group(3)) if m else (label, '', '')


zeilen, fehler = [], []
for name, text in SUCHE.items():
    r = suche(text)
    if not r:
        fehler.append(name); print('KEIN TREFFER:', name, '|', text); continue
    a = r[0]['attrs']; strasse, plz, ort = teile(a['label'])
    lat, lon = float(a['lat']), float(a['lon'])
    # Steht eine Adresse im Namen («Monbijoustrasse 55», «Kirchbühl 7»), zeigt die Karte genau diese —
    # die Koordinaten kommen vom nächsten Treffer derselben Strasse (nicht jede erfundene Nummer gibt es)
    m = re.search(r'([A-ZÄÖÜ][\wäöüéÄÖÜ\.-]*(?:strasse|gasse|weg|platz|str\.|bühl|werk|matt|ring)\s+\d+\w?)\b', name)
    if m: strasse = m.group(1).replace('str.', 'strasse')
    km = ((lat - BERN[0]) * 111) ** 2 + ((lon - BERN[1]) * 76) ** 2
    print(f'{name:45s} → {strasse}, {plz} {ort}  ({lat:.5f}, {lon:.5f})  {km ** 0.5:.1f} km')
    zeilen.append(f"  {json.dumps(name, ensure_ascii=False)}: [{json.dumps(strasse, ensure_ascii=False)}, '{plz}', {json.dumps(ort, ensure_ascii=False)}, {lat:.6f}, {lon:.6f}],")
print('\n'.join(zeilen))
print('Fehler:', fehler)
