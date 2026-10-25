// "Start with your numbers": typed values → synthetic customer → consent → Analysis.
// Also checks that bad input gets a plain-language message instead of a failed request.
// Usage: node scripts/own-numbers.mjs <baseUrl>
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const [, , base = 'http://127.0.0.1:8000'] = process.argv;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(() => localStorage.setItem('danazogi.locale', 'en'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
const text = (s) => page.waitForFunction((x) => document.body.innerText.includes(x), s, { timeout: 45000 });
const field = (label) => page.getByLabel(label, { exact: true });
const submit = () => page.getByRole('button', { name: 'Create my synthetic customer' }).click();

await page.goto(`${base}/app/welcome`, { waitUntil: 'domcontentloaded' });
await page.getByRole('link', { name: /Start with your numbers/ }).or(page.getByRole('button', { name: /Start with your numbers/ })).first().click();
await text('Create my synthetic customer');

// Years past the backend's 15 are capped while typing.
await field('Years').fill('30');
if ((await field('Years').inputValue()) !== '15') throw new Error(`years not capped: ${await field('Years').inputValue()}`);
// A loan instalment without a balance gets a clear message, no request.
await field('USD loan instalment /mo').fill('300');
await submit();
await text('enter both the monthly instalment');
console.log('1. bad input explained without a failed request');
await field('USD loan instalment /mo').fill('0');

await field('Monthly income').fill('3200').catch(() => undefined);
await submit();
await page.waitForURL(/\/app\/connect/);
await page.getByRole('button', { name: 'Allow read-only access' }).click();
await text('See my financial profile');
await page.getByRole('button', { name: 'See my financial profile' }).click();
await text('Your analysis');
await text('Cash-need model');
console.log('2. typed customer → consent → Analysis with model output');

await browser.close();
if (errors.length) {
  console.error('FAIL', errors);
  process.exit(1);
}
console.log('Own-numbers flow OK');
