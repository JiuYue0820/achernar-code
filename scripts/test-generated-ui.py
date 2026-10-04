"""Independent UI acceptance. Never patches either agent's deliverable."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path('D:/User/Desktop/Project/Test-CLI/ui-generation-20260926')
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    try:
        for variant in ['achernar', 'opencode']:
            evidence = ROOT / variant
            page = browser.new_page(viewport={'width': 1366, 'height': 900}, color_scheme='light', reduced_motion='reduce')
            errors, requests, checks = [], [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            def block(route):
                requests.append(route.request.url)
                route.abort()
            page.route('http://**/*', block)
            page.route('https://**/*', block)
            row = '.item' if variant == 'achernar' else '.row'
            panel = '#detail' if variant == 'achernar' else '#panel-body'
            def record(name, condition):
                checks.append({'check': name, 'passed': bool(condition)})
            try:
                page.goto((evidence / 'project/index.html').as_uri())
                page.wait_for_load_state('networkidle')
                record('three initial books', page.locator(row).count() == 3)
                record('title', 'Library desk' in page.title())
                record('search has accessible label', bool(page.get_by_role('searchbox').get_attribute('aria-label') or page.locator('label').count()))
                for width in [1366, 390]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    for scheme in ['light', 'dark']:
                        if page.locator('html').get_attribute('data-theme') != scheme:
                            page.locator('#theme').click()
                        record(f'{width}px {scheme}: no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                        page.screenshot(path=str(evidence / f'acceptance-{scheme}-{width}.png'), full_page=True)
                page.reload()
                record('theme persists', page.locator('html').get_attribute('data-theme') == 'dark')
                page.locator('[data-filter]').filter(has_text='Reading').click()
                record('reading filter', page.locator(row).count() == 2)
                page.get_by_role('searchbox').fill('Philosophy')
                record('combined search + reading', page.locator(row).count() == 1)
                page.locator(row).click()
                record('selected details', 'A Philosophy of Software Design' in page.locator(panel).inner_text())
                page.locator('[data-filter]').filter(has_text='Queued').click()
                record('combined filter produces explicit empty state', page.locator(row).count() == 0 and page.locator('.empty').first.is_visible())
                page.get_by_role('searchbox').fill('')
                record('queued filter after clear', page.locator(row).count() == 1 and 'The Pragmatic Programmer' in page.locator(row).inner_text())
                page.locator('[data-filter]').filter(has_text='All').click()
                if variant == 'opencode':
                    page.locator(row + '[tabindex="0"]').focus()
                    page.keyboard.press('End')
                else:
                    page.locator(row).last.focus()
                page.keyboard.press('Enter')
                record('keyboard selects details', 'A Philosophy of Software Design' in page.locator(panel).inner_text())
                page.get_by_role('searchbox').fill('<img src=x onerror=alert(1)>')
                record('search text is not executable markup', page.locator('img').count() == 0)
                record('no page errors', not errors)
                record('no external requests', not requests)
            except Exception as e:
                checks.append({'check': 'browser test completed', 'passed': False, 'error': str(e)})
            result = {'variant': variant, 'checks': checks, 'pagePassed': all(c['passed'] for c in checks), 'pageErrors': errors, 'requests': requests, 'readmeExists': (evidence / 'project/README.md').exists()}
            (evidence / 'browser-acceptance.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            results.append(result)
            page.close()
    finally:
        browser.close()
print(json.dumps(results, indent=2))
