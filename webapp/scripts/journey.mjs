// End-to-end journey through the real webapp UI against a running backend.
// Clicks through the actual product: demo session -> goals -> plan flow -> decide
// (ack, approve, AFF-01 edit block, instruction) -> privacy/audit + revoke ->
// bank-timeout fallback -> Lamara blocked mission -> crisis simulator -> stocks.
// Fails loudly on page errors or horizontal overflow at 390 px and 1440 px.
// Usage: node scripts/journey.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , base = 'http://127.0.0.1:8000', outArg = '../.shots'] = process.argv;
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => localStorage.setItem('danazogi.locale', 'en'));
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const text = (s) => page.waitForFunction((x) => document.body.innerText.includes(x), s, { timeout: 45000 });
const clickBtn = async (name) => {
  const b = page.getByRole('button', { name }).first();
  await b.waitFor({ state: 'visible', timeout: 20000 });
  await b.click();
};

async function shot(name) {
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: w < 600 ? 844 : 1000 });
    await page.waitForTimeout(600);
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1))
      errors.push(`horizontal overflow on ${name} at ${w}px`);
    await page.screenshot({ path: `${out}/webapp-${name}-${w}.png` });
    console.log(`  shot webapp-${name}-${w}.png`);
  }
}

console.log('1. demo -> home');
await page.goto(`${base}/app/welcome`, { waitUntil: 'domcontentloaded' });
await text('Start with your numbers');
if (await page.locator('details').first().getAttribute('open') !== null) throw new Error('Sample profiles should be secondary on first run');
await page.getByText('Explore sample profiles', { exact: true }).click();
await text('Choose a customer');
await shot('welcome');
await page.goto(`${base}/app/demo/nino?next=/app`, { waitUntil: 'domcontentloaded' });
await text('Protected reserve');
await text('Cash-need model');
await shot('analysis');

console.log('2. plan tab -> plan flow');
await page.getByRole('link', { name: 'Plan', exact: true }).locator('visible=true').first().click();
await text('Monthly amount');
await text('How risky it is');
await shot('plan');
// Apply the backend's affordable next step, then confirm a non-default monthly amount.
await page.getByRole('button', { name: /^Use .* a month$/ }).click();
await page.waitForFunction(() => {
  const stored = JSON.parse(sessionStorage.getItem('danazogi.session.v1') || 'null');
  return stored && !document.body.innerText.includes('recalculating');
});
await page.getByRole('link', { name: /Build my plan/ }).first().click();
await text('What stays safe');
await shot('buffer');
await clickBtn('Continue');
await text('Choose your mission');
await page.getByRole('radio', { name: /^Goal/ }).click();
await text('Where your savings would go');
await shot('mission');
await clickBtn('Continue');
await text('Stress test');
await page.waitForTimeout(1200);
await shot('stress');
await clickBtn('Continue');
await text('Guardrails');
await page.waitForSelector('summary:text("Read the full explanation")');
await page.locator('summary').filter({ hasText: 'Read the full explanation' }).click();
await page.locator('summary').filter({ hasText: 'Technical details:' }).click();
await text('exact Shapley values');
await shot('decide-checks');

console.log('3. confirm -> approve -> AFF-01 block -> instruction');
await clickBtn('Confirm mission and draft trades');
await text('Trades for your approval');
await shot('decide-trades');
// approve the first one-off trade (cards without the monthly label)
const oneOff = page.locator('main .app-card').filter({ hasNotText: 'GEL per month' }).filter({ hasText: 'Approve' }).first();
await oneOff.getByRole('button', { name: 'Approve' }).click();
await page.waitForFunction(() => /\d+ \/ \d+ approved/.test(document.body.innerText), null, { timeout: 20000 });
// edit the recurring trade above the limit -> AFF-01 blocks it
const recurring = page.locator('main .app-card').filter({ hasText: 'GEL per month' }).first();
await recurring.locator('input[type=number]').fill('9999');
await recurring.getByRole('button', { name: 'Save' }).click();
await page.waitForFunction(() => /AFF-01|Blocked/.test(document.body.innerText), null, { timeout: 20000 });
await shot('decide-aff01');
// A blocked edit must be recoverable, including an edit smaller than one lari.
await recurring.locator('input[type=number]').fill('270.25');
await recurring.getByRole('button', { name: 'Save', exact: true }).click();
await recurring.getByRole('button', { name: 'Approve', exact: true }).waitFor({ state: 'visible' });
await page.waitForFunction(() => document.body.innerText.includes('270.25 GEL'));
await recurring.getByRole('button', { name: 'Approve', exact: true }).click();
await page.waitForFunction(() => document.body.innerText.includes('2 / '));
const saved = await page.evaluate(async () => {
  const { s } = JSON.parse(sessionStorage.getItem('danazogi.session.v1'));
  const r = await fetch(`/api/sessions/${s.consent_id}/trades`, { headers: { 'X-Consent-Token': s.token } });
  return r.json();
});
if (saved.monthly === 270 || saved.trades.filter((t) => t.status === 'approved').length !== 2)
  throw new Error('Expected a non-default confirmed monthly amount and two approvals');
await page.reload({ waitUntil: 'domcontentloaded' });
await text('2 / ');
const summary = page.locator('main .app-card').filter({ hasText: 'Monthly' }).first();
if (!(await summary.innerText()).includes(String(saved.monthly))) throw new Error('Confirmed monthly amount was lost on reload');
await clickBtn('Prepare signed-ready instruction');
await text('Instruction draft');
await shot('instruction');

console.log('4. privacy -> revoke');
await page.getByRole('link', { name: 'Profile', exact: true }).locator('visible=true').first().click();
await text('Audit log and models');
await shot('profile');
await page.getByRole('link', { name: /Audit log and models/ }).first().click();
await text('Timeline');
await text('verifies');
await shot('privacy');
await clickBtn('Revoke consent');
await clickBtn('Yes, revoke');
await text('Access revoked');
await shot('privacy-revoked');
await clickBtn('Back to the start');
await text('Start with your numbers');

console.log('5. timeout fallback');
await page.goto(`${base}/app/demo/nino?timeout=RI&next=/app`, { waitUntil: 'domcontentloaded' });
await text('Protected reserve');
await text('Partial data');
await shot('analysis-timeout');

console.log('6. lamara growth blocked');
await page.goto(`${base}/app/demo/lamara?next=/app/plan/mission`, { waitUntil: 'domcontentloaded' });
await text('Choose your mission');
await page.getByRole('radio', { name: /Growth/ }).click();
await clickBtn('Continue');
await text('Stress test');
await clickBtn('Continue');
await text('blocked and cannot be confirmed');
await shot('decide-lamara-blocked');

console.log('7. simulator growth 2014-15 sell');
await page.goto(`${base}/app/demo/nino?next=/app/sandbox`, { waitUntil: 'domcontentloaded' });
await text('Start the replay');
await page.locator('[role=radiogroup]').first().getByRole('radio', { name: /Growth/ }).click();
await page.getByRole('button', { name: /2014–15/ }).click();
await clickBtn('Start the replay');
await text('What do you do?');
await shot('sim-decision');
await clickBtn('Sell to cash');
for (let i = 0; i < 16; i++) {
  if (await page.evaluate(() => document.body.innerText.includes('Your debrief'))) break;
  if (await page.evaluate(() => document.body.innerText.includes('What do you do?')))
    await page.getByRole('button', { name: /^Hold/ }).click();
  await page.waitForTimeout(1200);
}
await text('Your debrief');
await shot('sim-debrief');

console.log('8. stocks');
await page.goto(`${base}/app/stocks`, { waitUntil: 'domcontentloaded' });
await text('Explore stocks');
await shot('stocks');
await page.goto(`${base}/app/stocks/NVDA`, { waitUntil: 'domcontentloaded' });
await text('Effect on your plan');
await page.waitForFunction(() => /Plan \+ NVDA|news unavailable|via /.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {
  console.log('  (live market data slow/unavailable — tolerated)');
});
await shot('stocks-nvda');

console.log('9. news');
await page.getByRole('link', { name: 'News', exact: true }).locator('visible=true').first().click();
await text('Updates for you');
await page.getByRole('tab', { name: 'NVDA' }).click();
await page.waitForFunction(() => /via |news unavailable|unavailable/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {
  console.log('  (live news slow/unavailable — tolerated)');
});
await shot('news');

await browser.close();
if (errors.length) {
  console.error(`\nFAIL — ${errors.length} problem(s):`);
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}
console.log('\nJourney OK — all steps passed, no page errors, no overflow.');
