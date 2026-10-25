// Accessibility check of the webapp's key screens with axe-core (WCAG 2.1 A/AA).
// Session screens are reached through the /app/demo/nino deep link, which creates
// a real consent session first.
// Usage: node scripts/a11y.mjs [baseUrl] [locale=en|ka]   (run once per locale)
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const [, , base = 'http://127.0.0.1:8000', locale = 'ka'] = process.argv;
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const demo = (path) => `/app/demo/nino?next=${encodeURIComponent(path)}`;
const pages = [
  ['/', 1440],
  ['/app/welcome', 390],
  ['/app/questionnaire', 390],
  ['/app/import', 390],
  [demo('/app'), 390],
  [demo('/app/profile'), 390],
  [demo('/app/analysis'), 390],
  [demo('/app/plan'), 390],
  [demo('/app/news'), 390],
  [demo('/app/stocks/NVDA'), 390],
  [demo('/app/plan/buffer'), 390],
  [demo('/app/plan/mission'), 390],
  [demo('/app/plan/stress'), 390],
  [demo('/app/plan/decide'), 390],
  [demo('/app/profile/privacy'), 390],
  [demo('/app/stocks'), 390],
  [demo('/app/sandbox'), 390],
  [demo('/app'), 1440],
  ['/design', 1440],
];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
let total = 0;
for (const [path, width] of pages) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
  await context.addInitScript((l) => localStorage.setItem('danazogi.locale', l), locale);
  const page = await context.newPage();
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.length > 300, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () =>
    // @ts-expect-error axe is injected above
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
  );
  const violations = result.violations;
  total += violations.length;
  console.log(`${violations.length ? '✗' : '✓'} ${path} (${width}px)`);
  for (const v of violations) {
    console.log(`   [${v.impact}] ${v.id}: ${v.help} — ${v.nodes.length} element(s)`);
    for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')} :: ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`);
  }
  await context.close();
}
await browser.close();
console.log(total ? `\n${total} rule violation group(s)` : '\nNo violations');
