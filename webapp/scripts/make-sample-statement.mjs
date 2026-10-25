// Generates public/sample-statement.csv: a realistic 12-month statement (Georgian headers, ";" separators,
// DD.MM.YYYY dates, decimal commas, GEL + USD accounts with balances). Deterministic (seeded).
import { writeFileSync } from 'node:fs';

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100) / 100;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const rows = [];
const add = (y, m, d, desc, amount, cur) => rows.push({ date: new Date(y, m - 1, d), desc, amount, cur });

const start = new Date(2025, 10, 1); // Nov 2025
const end = new Date(2026, 9, 20); // Oct 20, 2026
for (let i = 0; i < 12; i++) {
  const y = start.getFullYear() + Math.floor((start.getMonth() + i) / 12);
  const m = ((start.getMonth() + i) % 12) + 1;
  add(y, m, 1, 'კონვერტაცია - USD ანგარიშზე', -1880, 'GEL');
  add(y, m, 1, 'Conversion from GEL account', 700, 'USD');
  add(y, m, 1, 'Rent payment - apartment Vake', -700, 'USD');
  add(y, m, 3, 'Transfer to own account - savings', -800, 'GEL');
  add(y, m, 10, 'სესხის დაფარვა - სამომხმარებლო სესხი', -380, 'GEL');
  add(y, m, 25, 'ხელფასი - შპს ტექნო სოლუშენს', 5200, 'GEL');
  if (rnd() < 0.5) add(y, m, Math.ceil(between(5, 27)), 'Upwork Escrow payment', between(300, 650), 'USD');
  for (let k = 0; k < 10; k++) add(y, m, Math.ceil(between(1, 28)), pick(['Nikora', 'Carrefour Tbilisi Mall', 'SPAR', 'Goodwill', 'ორი ნაბიჯი']), -between(18, 110), 'GEL');
  add(y, m, 14, 'Telasi - electricity', -between(55, 120), 'GEL');
  add(y, m, 15, 'GWP - water', -between(22, 38), 'GEL');
  add(y, m, 16, 'Magti mobile', -35, 'GEL');
  add(y, m, 17, 'Silknet internet', -45, 'GEL');
  for (let k = 0; k < 8; k++) add(y, m, Math.ceil(between(1, 28)), 'Bolt ride', -between(6, 24), 'GEL');
  add(y, m, 8, 'Wissol fuel', -between(70, 95), 'GEL');
  for (let k = 0; k < 5; k++) add(y, m, Math.ceil(between(1, 28)), 'Wolt order', -between(22, 58), 'GEL');
  add(y, m, Math.ceil(between(5, 25)), pick(['Restaurant Barbarestan', 'Cafe Littera', 'Fabrika bar']), -between(70, 160), 'GEL');
  add(y, m, 20, 'Netflix', -12.99, 'USD');
  add(y, m, Math.ceil(between(1, 28)), 'PSP pharmacy', -between(15, 60), 'GEL');
}

const fmt = (n) => n.toFixed(2).replace('.', ',');
const day = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
const balance = { GEL: 6000, USD: 3000 };
const lines = ['თარიღი;დანიშნულება;თანხა;ვალუტა;ნაშთი'];
for (const r of rows.filter((r) => r.date <= end).sort((a, b) => a.date - b.date)) {
  balance[r.cur] = Math.round((balance[r.cur] + r.amount) * 100) / 100;
  lines.push([day(r.date), `"${r.desc}"`, fmt(r.amount), r.cur, fmt(balance[r.cur])].join(';'));
}
writeFileSync(new URL('../public/sample-statement.csv', import.meta.url), '﻿' + lines.join('\r\n') + '\r\n');
console.log(`${lines.length - 1} rows; end balances`, balance);
