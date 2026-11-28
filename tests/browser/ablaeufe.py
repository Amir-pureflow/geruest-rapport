"""
Phase 3 — Abläufe mit Klicks (lokal). Jeder Ablauf prüft danach in der lokalen Datenbank, was angekommen ist.
Start:  node tests/lokal/testdaten.mjs && python tests/browser/ablaeufe.py
"""
import json
import os
import subprocess
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

APP = 'http://127.0.0.1:3000'
PASSWORT = 'Lokal-Test-1234'
AUS = r'C:\Users\El Dragon\Render-Cache\Rapporto Pruefung\ablaeufe'
TOKEN_A = 'aaaaaaaa-0000-4000-8000-00000000aaaa'
os.makedirs(AUS, exist_ok=True)
ergebnis = []


def sql(q):
    return subprocess.run(['docker', 'exec', '-i', 'supabase_db_lokal', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'],
                          input=q, capture_output=True, text=True, encoding='utf-8').stdout.strip()


def sperre(route):
    host = urlparse(route.request.url).hostname or ''
    if host in ('127.0.0.1', 'localhost'):
        return route.continue_()
    if host.endswith('supabase.co') or 'vercel.app' in host:
        print('GESPERRT (Abbruch):', route.request.url, file=sys.stderr)
        os._exit(2)
    return route.abort()


def kontext(browser, w, h, mic=False):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, service_workers='block', accept_downloads=True)
    ctx.route('**/*', sperre)
    # Ersatz für die kostenpflichtige Spracherkennung/Übersetzung
    ctx.route('**/functions/v1/transkribieren', lambda r: r.fulfill(status=200, content_type='application/json',
              body=json.dumps({'text': 'Abbiamo montato il ponteggio', 'deutsch': 'Wir haben das Gerüst montiert', 'ok': True})))
    return ctx


def anmelden(page, mail, ansicht=None):
    page.goto(APP + '/')
    page.fill('input[type=email]', mail)
    page.fill('input[type=password]', PASSWORT)
    page.click('button[type=submit]')
    page.wait_for_timeout(2500)
    if ansicht:
        page.evaluate(f"localStorage.setItem('ansicht', '{ansicht}')")


def notiere(name, ok, detail=''):
    ergebnis.append({'ablauf': name, 'ok': ok, 'detail': detail})
    print(('OK   ' if ok else 'FEHL ') + name + (' — ' + detail if detail else ''))


def tag_melden(browser, w, h):
    """Teamgerät: Tag fürs ganze Team melden, 7:00–12:00 + 13:00–16:24 = 8.4 h je Person (kein Überstunden-Dialog)."""
    sql("delete from zeiteintrag where tagesmeldung_id in (select id from tagesmeldung where team_id='aaaaaaaa-0000-4000-8000-0000000000a1' and datum=current_date); delete from tagesmeldung where team_id='aaaaaaaa-0000-4000-8000-0000000000a1' and datum=current_date;")
    ctx = kontext(browser, w, h)
    page = ctx.new_page()
    fehler = []
    page.on('pageerror', lambda e: fehler.append(str(e)))
    anmelden(page, 'chef@testbau-a.test')
    page.goto(APP + '/erfassung')
    page.wait_for_timeout(2500)
    bis = page.locator('input[aria-label=bis]').nth(1)
    # Tippfehler-Probe: «1775» (Minute 75 gibt es nicht)
    bis.click(); bis.press_sequentially('1775'); bis.press('Enter')
    page.wait_for_timeout(300)
    probe = bis.input_value()
    notiere(f'Uhrzeit «1775» wird abgelehnt statt still 17:59 ({w}px)', probe not in ('17:59',), f'Feld zeigt {probe!r}')
    bis.click(); bis.press_sequentially('1624'); bis.press('Enter')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(AUS, f'tag_melden_{w}_vorher.png'), full_page=True)
    page.get_by_role('button', name='Tag melden').click()
    page.wait_for_timeout(5000)
    page.screenshot(path=os.path.join(AUS, f'tag_melden_{w}_nachher.png'), full_page=True)
    r = sql("select count(*)||'/'||coalesce(sum(z.normal_min+z.ueber_min),0) from zeiteintrag z join tagesmeldung t on t.id=z.tagesmeldung_id where t.team_id='aaaaaaaa-0000-4000-8000-0000000000a1' and t.datum=current_date;")
    # 3 Personen × (300 + 204) = 3 × 504 = 1512 Min.
    notiere(f'Teamgerät meldet Tag ({w}px)', r == '3/1512' and not fehler, f'DB: {r} (erwartet 3/1512) {fehler[:2]}')
    ctx.close()


def nachtarbeit(browser, w, h):
    """Teamgerät: Nachtschicht 22:00–02:00 (Entscheid Amir 28.11.2026: zählt zum Starttag)."""
    sql("delete from zeiteintrag where tagesmeldung_id in (select id from tagesmeldung where team_id='aaaaaaaa-0000-4000-8000-0000000000a1' and datum=current_date); delete from tagesmeldung where team_id='aaaaaaaa-0000-4000-8000-0000000000a1' and datum=current_date;")
    ctx = kontext(browser, w, h)
    page = ctx.new_page()
    anmelden(page, 'chef@testbau-a.test')
    page.goto(APP + '/erfassung')
    page.wait_for_timeout(2500)
    page.get_by_role('button', name='Zeit entfernen').first.click()  # Nachmittag weg, nur noch eine Zeit
    von = page.locator('input[aria-label=von]').first
    von.click(); von.press_sequentially('2200'); von.press('Enter')
    bis = page.locator('input[aria-label=bis]').first
    bis.click(); bis.press_sequentially('0200'); bis.press('Enter')
    page.wait_for_timeout(500)
    plus1 = page.get_by_text('+1', exact=True).count() > 0
    page.screenshot(path=os.path.join(AUS, f'nacht_{w}.png'), full_page=True)
    page.get_by_role('button', name='Tag melden').click()
    page.wait_for_timeout(5000)
    r = sql("select count(*)||'/'||coalesce(sum(z.normal_min+z.ueber_min),0)||'/'||coalesce(max(z.bis_min),0) from zeiteintrag z join tagesmeldung t on t.id=z.tagesmeldung_id where t.team_id='aaaaaaaa-0000-4000-8000-0000000000a1' and t.datum=current_date;")
    notiere(f'Nachtarbeit 22:00–02:00 ({w}px)', r == '3/720/1560' and plus1, f'DB {r} (erwartet 3/720/1560), «+1» sichtbar: {plus1}')
    ctx.close()


def kunde_bestaetigt(browser, w, h):
    # Zurücksetzen am Sperr-Trigger vorbei (bestätigt ist seit 0056 eingefroren) — nur Testvorbereitung
    sql(f"set session_replication_role = replica; update regierapport set status='versendet', bestaetigt_am=null, bestaetigt_betrag_rappen=null where link_token='{TOKEN_A}'; set session_replication_role = origin;")
    ctx = kontext(browser, w, h)
    page = ctx.new_page()
    page.goto(f'{APP}/b/{TOKEN_A}')
    page.get_by_text("3'699.19").first.wait_for(timeout=20000)
    page.screenshot(path=os.path.join(AUS, f'kunde_{w}_offen.png'), full_page=True)
    page.get_by_role('button', name='Bestätigen').click()
    page.get_by_role('button', name='Ja, bestätigen').click()
    page.wait_for_timeout(4000)
    page.screenshot(path=os.path.join(AUS, f'kunde_{w}_bestaetigt.png'), full_page=True)
    s = sql(f"select status||'/'||betrag_rappen from regierapport where link_token='{TOKEN_A}';")
    notiere(f'Kunde bestätigt über den Link ({w}px)', s == 'bestaetigt/369919', s)
    ctx.close()


def excel(browser):
    ctx = kontext(browser, 1366, 860)
    page = ctx.new_page()
    anmelden(page, 'buero@testbau-a.test', 'sekretariat')
    page.goto(APP + '/export')
    page.wait_for_timeout(3000)
    page.screenshot(path=os.path.join(AUS, 'export_1366.png'), full_page=True)
    knoepfe = page.get_by_role('button').filter(has_text='Excel')
    if knoepfe.count() == 0:
        notiere('Excel herunterladen', False, 'kein Knopf mit «Excel» gefunden')
        return ctx.close()
    with page.expect_download(timeout=30000) as dl:
        knoepfe.first.click()
    pfad = os.path.join(AUS, dl.value.suggested_filename)
    dl.value.save_as(pfad)
    notiere('Excel herunterladen', os.path.getsize(pfad) > 1000, dl.value.suggested_filename)
    ctx.close()
    return pfad


def regie_bearbeiten(browser, w, h):
    """Regie-Entwurf: Etappenzuschlag per Doppelklick weg → DB rechnet Miete und Total nach, nichts doppelt (Reparatur 1)."""
    rid = 'aaaaaaaa-0000-4000-8000-000000000091'
    sql(f"""set session_replication_role = replica;
      update regierapport set status='entwurf', bestaetigt_am=null, bestaetigt_betrag_rappen=null where id='{rid}';
      insert into regie_position (regierapport_id, tarif_code, bezeichnung, menge_hundertstel, ansatz_rappen, betrag_rappen)
        select '{rid}', 'etappe', 'Etappenzuschlag', 100, 28000, 28000
        where not exists (select 1 from regie_position where regierapport_id='{rid}' and tarif_code='etappe');
      update regie_position set betrag_rappen=30544, ansatz_rappen=30544 where regierapport_id='{rid}' and tarif_code='materialmiete';
      set session_replication_role = origin;
      update regierapport set betrag_rappen = 0 where id='{rid}';""")  # letzte Zeile: DB rechnet den Kopf neu (3'699.20)
    ctx = kontext(browser, w, h)
    page = ctx.new_page()
    anmelden(page, 'buero@testbau-a.test', 'bauf')
    page.goto(APP + '/regie/aaaaaaaa-0000-4000-8000-000000000091')
    page.get_by_text("3'699.20").first.wait_for(timeout=20000)
    page.screenshot(path=os.path.join(AUS, f'regie_{w}_vorher.png'), full_page=True)
    page.get_by_role('button', name='Etappenzuschlag').dblclick()
    page.wait_for_timeout(3000)
    page.screenshot(path=os.path.join(AUS, f'regie_{w}_nachher.png'), full_page=True)
    s = sql("select (select count(*) from regie_position where regierapport_id='aaaaaaaa-0000-4000-8000-000000000091' and tarif_code='etappe')||'/'||betrag_rappen from regierapport where id='aaaaaaaa-0000-4000-8000-000000000091';")
    # ohne Etappe: 3'113.75 + Miete 280.24 = 3'393.99 → 3'394.00
    sichtbar = page.get_by_text("3'394.00").count() > 0
    notiere(f'Regie: Doppelklick Etappe, Total aus der DB ({w}px)', s == '0/339400' and sichtbar, f'DB {s} (erwartet 0/339400), Anzeige 3394.00: {sichtbar}')
    ctx.close()


def zusatzauftrag(browser, w, h):
    ctx = kontext(browser, w, h)
    page = ctx.new_page()
    anmelden(page, 'buero@testbau-a.test', 'bauf')
    page.goto(APP + '/zusatzauftrag')
    page.wait_for_timeout(2500)
    page.screenshot(path=os.path.join(AUS, f'zusatzauftrag_{w}.png'), full_page=True)
    knoepfe = [b.strip() for b in page.locator('button').all_inner_texts() if b.strip()]
    notiere(f'Zusatzauftrag-Seite lädt ({w}px)', len(knoepfe) > 3, ' | '.join(knoepfe[:12]))
    ctx.close()


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h in [(360, 740), (390, 844), (1366, 860)]:
            tag_melden(b, w, h)
        for w, h in [(360, 740), (1366, 860)]:
            nachtarbeit(b, w, h)
        for w, h in [(360, 740), (1366, 860)]:
            kunde_bestaetigt(b, w, h)
        x = excel(b)
        for w, h in [(390, 844), (1366, 860)]:
            regie_bearbeiten(b, w, h)
        for w, h in [(390, 844), (1366, 860)]:
            zusatzauftrag(b, w, h)
        b.close()
    with open(os.path.join(AUS, 'ergebnis.json'), 'w', encoding='utf-8') as f:
        json.dump({'ergebnis': ergebnis, 'excel': x}, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
