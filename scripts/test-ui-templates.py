"""Browser acceptance for bundled templates; outputs evidence outside source."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'extensions/skills/achernar/achernar-ui-design/assets/templates'
OUT = Path('D:/User/Desktop/Project/Test-CLI/ui-templates-20260926')
OUT.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    try:
        for name in ['workbench', 'data-overview', 'editorial']:
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto((ASSETS / f'{name}.html').as_uri())
            page.wait_for_load_state('networkidle')
            for scheme in ['light', 'dark']:
                page.emulate_media(color_scheme=scheme, reduced_motion='reduce')
                if page.locator('html').get_attribute('data-theme') != scheme:
                    page.locator('#theme').click()
                for width in [1366, 390]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (name, scheme, width)
                    page.screenshot(path=str(OUT / f'{name}-{scheme}-{width}.png'), full_page=True)
                    results.append({'template': name, 'theme': scheme, 'width': width, 'overflow': False})
            page.reload()
            assert page.locator('html').get_attribute('data-theme') == 'dark'
            if name == 'workbench':
                page.get_by_role('button', name='Planned', exact=True).click()
                assert page.locator('.item').count() == 2
                page.locator('.item').last.click()
                assert 'Archive and handover' in page.locator('#detail').inner_text()
                page.get_by_role('searchbox').fill('no-match')
                assert page.locator('.item').count() == 0
                assert 'No projects match' in page.locator('#list').inner_text()
                page.get_by_role('searchbox').fill('studio')
                assert page.locator('.item').count() == 1
                page.locator('.item').focus()
                page.keyboard.press('Enter')
                assert page.locator('.item').evaluate('(el)=>el===document.activeElement')
            elif name == 'data-overview':
                assert page.locator('#total').inner_text() == '226'
                page.get_by_label('Reporting period').select_option('previous')
                assert page.locator('#total').inner_text() == '179'
                assert page.locator('#rows tr').count() == 7
                assert 'Mon: 18' in page.locator('#graphDescription').text_content()
            else:
                page.get_by_role('button', name='Practice', exact=True).click()
                assert page.locator('.article').count() == 1
                page.locator('summary').focus()
                page.keyboard.press('Enter')
                assert page.locator('.article[open]').count() == 1
                page.get_by_role('searchbox').fill('no-match')
                assert page.locator('.article').count() == 0
            assert not errors, errors
            results.append({'template': name, 'interactions': 'passed', 'themePersistence': 'passed', 'pageErrors': errors})
            page.close()
    finally:
        browser.close()
(OUT / 'browser-validation.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps({'checks': len(results), 'evidence': str(OUT)}))
