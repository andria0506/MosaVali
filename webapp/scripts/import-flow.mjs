// Statement import end to end: sample CSV → review numbers → synthetic customer → consent → ML profile in Analysis.
// Usage: node scripts/import-flow.mjs <baseUrl> <outDir> [path/to/statement.csv]
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , base = 'http://127.0.0.1:8000', outArg = '../.shots', csv] = process.argv;
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(() => localStorage.setItem('danazogi.locale', 'en'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const text = (s) => page.waitForFunction((x) => document.body.innerText.includes(x), s, { timeout: 45000 });

await page.goto(`${base}/app/import`, { waitUntil: 'domcontentloaded' });
if (csv) await page.locator('input[type=file]').setInputFiles(resolve(csv));
else await page.getByText('Load the sample statement').click();
await text('Create my synthetic customer');
await page.screenshot({ path: `${out}/import-review.png`, fullPage: true });
console.log('1. statement parsed, form prefilled');

await page.getByRole('button', { name: 'Create my synthetic customer' }).click();
await page.waitForURL(/\/app\/connect/);
await page.getByRole('button', { name: 'Allow read-only access' }).click();
console.log('2. synthetic customer created, consent given');

await text('See my financial profile');
await page.getByRole('button', { name: 'See my financial profile' }).click();
await text('Your analysis');
await text('Cash-need model');
const figures = await page.evaluate(() => document.body.innerText.match(/Protected reserve\n[^\n]+\n[^\n]+/)?.[0]);
await page.screenshot({ path: `${out}/import-analysis.png`, fullPage: true });
console.log('3. ML profile shown:', figures?.replace(/\n/g, ' | '));

await browser.close();
if (errors.length) {
  console.error('FAIL', errors);
  process.exit(1);
}
console.log('Import flow OK');
