/**
 * Real bank data from a statement the user exports themselves (CSV), parsed and analysed on their
 * device — nothing is uploaded. Pure functions: a backend can run the same analysis on open-banking
 * transactions later.
 *
 * Parsing auto-detects: encoding (UTF-8, UTF-16 "Unicode text" exports from Excel), delimiter
 * (, ; tab |), a header row below any preamble lines, Georgian/English headers (also snake_case
 * exports such as the organisers' `booking_date,amount,balance_after,customer_id…`), date formats
 * (DD/MM/YYYY, DD.MM.YY, MM/DD/YYYY, YYYY-MM-DD, "15 Oct 2026", Excel serials), one signed amount
 * column or separate debit/credit columns, decimal commas, quoted fields with line breaks, an
 * optional balance column, several accounts, and several customers in one file.
 */
import type { Currency, MeasuredFinances, Money, MonthlyPoint, QuestionnaireAnswers, SpendingCategory, StatementTransaction } from '../types';


// ---------- Parsing ----------

/** Why a file could not be read; the import page turns the code into a specific message. */
export class StatementError extends Error {
  constructor(
    public code: 'empty' | 'excel' | 'columns' | 'rows' | 'currency',
    public detail: { columns?: string[]; skipped?: number; otherCurrency?: number } = {},
  ) {
    super(code);
  }
}

/** Header aliases per field, tried in order (most specific first) on lower-cased headers with `_-./()` turned into spaces. */
const HEADERS: Record<'date' | 'description' | 'counterparty' | 'amount' | 'debit' | 'credit' | 'currency' | 'balance' | 'account' | 'customer' | 'category' | 'direction', RegExp[]> = {
  date: [
    /^(date|booking date|transaction date|operation date|თარიღი|ოპერაციის თარიღი|ტრანზაქციის თარიღი|გატარების თარიღი)$/,
    /^(posting date|value date|date time|datetime|transaction time)$/,
    /(date|თარიღ)/,
  ],
  description: [
    /^(description|details|narrative|purpose|transaction details|დანიშნულება|აღწერა|დეტალები|ოპერაციის შინაარსი|ოპერაციის დანიშნულება)$/,
    /(description|details|purpose|narrative|დანიშნულ|აღწერ|შინაარს)/,
  ],
  counterparty: [/^(counterparty|merchant|payee|beneficiary|partner|კონტრაგენტი|მიმღები|ბენეფიციარი|პარტნიორი)( name)?$/],
  amount: [
    /^(amount|sum|transaction amount|თანხა|ოპერაციის თანხა)( (gel|usd|₾|\$))?$/,
    /(amount|თანხ)/,
  ],
  debit: [/^(debit|withdrawal|withdrawals|out|outflow|paid out|money out|დებეტი|გასავალი)( (amount|gel|usd))?$/, /(debit|დებეტ|გასავ)/],
  credit: [/^(credit|deposit|deposits|in|inflow|paid in|money in|კრედიტი|შემოსავალი)( (amount|gel|usd))?$/, /(credit|კრედიტ|შემოს)/],
  currency: [/^(currency|ccy|currency code|ვალუტა)$/],
  balance: [/^(balance|running balance|balance after|closing balance|ნაშთი|ბალანსი)( (gel|usd))?$/, /(balance|ნაშთ)/],
  account: [/^(account|account id|account number|account no|iban|ანგარიში|ანგარიშის ნომერი)$/],
  customer: [/^(customer|customer id|client|client id|კლიენტი)$/],
  category: [/^(category|კატეგორია)$/],
  // Exports with unsigned amounts say which way the money went in a separate column.
  direction: [/^(transaction type|type|direction|dr cr|cr dr|debit credit|income expense|in out|ტიპი|ოპერაციის ტიპი|ტრანზაქციის ტიპი)$/],
};
type Field = keyof typeof HEADERS;

export interface ParseOptions {
  defaultCurrency?: Currency;
  /** For files with a customer column: whose transactions to read (default: the first customer in the file). */
  customer?: string;
}

export interface ParsedStatement {
  transactions: StatementTransaction[];
  skipped: number;
  /** Rows left out because they are in a currency other than GEL/USD. */
  otherCurrency: number;
  columns: string[];
  /** Latest balance per currency (summed over accounts), when the statement has a balance column. */
  lastBalance?: Partial<Record<Currency, number>>;
  /** Customers in the file, when it has a customer column with more than one value. */
  customers?: string[];
  customer?: string;
}

/** Bytes → text. Handles the UTF-16 that Excel writes for "Unicode Text" and refuses XLSX files saved with a .csv name. */
export function decodeStatement(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) throw new StatementError('excel'); // "PK": a zip, i.e. .xlsx
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  // UTF-16 without a BOM: every other byte is zero for Latin text.
  if (b.length > 3 && b[1] === 0 && b[3] === 0) return new TextDecoder('utf-16le').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

export function parseStatementCsv(text: string, opts: ParseOptions = {}): ParsedStatement {
  const clean = text.replace(/^﻿/, '');
  const found = findHeader(clean);
  if (!found) {
    const first = clean.split(/\r?\n/).find((l) => l.trim());
    if (!first || clean.split(/\r?\n/).filter((l) => l.trim()).length < 2) throw new StatementError('empty');
    throw new StatementError('columns', { columns: splitRows(first, guessDelimiter(first))[0]?.map((h) => h.trim()).filter(Boolean) });
  }
  const { rows, headerRow, header, idx } = found;
  const body = rows.slice(headerRow + 1).filter((r) => r.some((c) => c.trim()));
  if (!body.length) throw new StatementError('empty');

  // A currency in the amount header ("Amount (USD)") is the default for rows without a currency cell.
  const headerCur = normCurrency(header[idx.amount >= 0 ? idx.amount : Math.max(idx.debit, idx.credit)]?.match(/\b(gel|usd|eur|₾|\$)\b|[₾$]/i)?.[0] ?? '');
  const defaultCurrency = headerCur || opts.defaultCurrency || 'GEL';

  let customers: string[] | undefined;
  let customer: string | undefined;
  let data = body;
  if (idx.customer >= 0) {
    const all = [...new Set(body.map((r) => (r[idx.customer] ?? '').trim()).filter(Boolean))];
    if (all.length > 1) {
      customers = all;
      customer = opts.customer && all.includes(opts.customer) ? opts.customer : all[0];
      data = body.filter((r) => (r[idx.customer] ?? '').trim() === customer);
    }
  }

  const monthFirst = isMonthFirst(data.map((r) => r[idx.date] ?? ''));
  const transactions: StatementTransaction[] = [];
  let skipped = 0;
  let otherCurrency = 0;
  for (const cells of data) {
    const date = parseDate(cells[idx.date] ?? '', monthFirst);
    let amount =
      idx.amount >= 0
        ? parseNumber(cells[idx.amount])
        : (Math.abs(parseNumber(cells[idx.credit]) ?? 0) - Math.abs(parseNumber(cells[idx.debit]) ?? 0)) || undefined;
    const sign = idx.direction >= 0 ? directionSign(cells[idx.direction] ?? '') : 0;
    if (amount !== undefined && sign) amount = sign * Math.abs(amount);
    if (!date || amount === undefined || amount === 0) {
      skipped++;
      continue;
    }
    const cur = idx.currency >= 0 ? normCurrency(cells[idx.currency] ?? '') || (cells[idx.currency] ?? '').trim().toUpperCase() : '';
    if (cur && cur !== 'USD' && cur !== 'GEL') {
      otherCurrency++; // other currencies (EUR…) are left out of this prototype
      continue;
    }
    const currency: Currency = (cur || defaultCurrency) as Currency;
    const balance = idx.balance >= 0 ? parseNumber(cells[idx.balance]) : undefined;
    const desc = (cells[idx.description] ?? '').trim();
    const party = (cells[idx.counterparty] ?? '').trim();
    transactions.push({
      date,
      amount: { amount, currency },
      description: party && !desc.toLowerCase().includes(party.toLowerCase()) ? (desc ? `${party} — ${desc}` : party) : desc,
      balance: balance === undefined ? undefined : { amount: balance, currency },
      account: idx.account >= 0 ? (cells[idx.account] ?? '').trim() || undefined : undefined,
      category: idx.category >= 0 ? (cells[idx.category] ?? '').trim().toLowerCase() || undefined : undefined,
    });
  }
  if (!transactions.length) {
    if (otherCurrency) throw new StatementError('currency', { otherCurrency });
    throw new StatementError('rows', { skipped, columns: header });
  }
  // Stable sort keeps the file's order within a day, so the last row of a day carries its closing balance.
  const ordered = transactions.map((t, i) => ({ t, i }));
  if (ordered.length > 1 && ordered[0].t.date > ordered[ordered.length - 1].t.date) ordered.reverse(); // newest-first exports
  ordered.sort((a, b) => a.t.date.localeCompare(b.t.date));
  const sorted = ordered.map((o) => o.t);
  const lastBalance = latestBalances(sorted);
  return { transactions: sorted, skipped, otherCurrency, columns: header, lastBalance, customers, customer };
}

/** Closing balance per account, summed per currency. */
function latestBalances(txs: StatementTransaction[]): Partial<Record<Currency, number>> | undefined {
  const perAccount = new Map<string, { currency: Currency; amount: number }>();
  for (const t of txs) if (t.balance) perAccount.set(`${t.account ?? ''}|${t.balance.currency}`, t.balance);
  if (!perAccount.size) return undefined;
  const out: Partial<Record<Currency, number>> = {};
  for (const b of perAccount.values()) out[b.currency] = Math.round(((out[b.currency] ?? 0) + b.amount) * 100) / 100;
  return out;
}

/** +1 for money in, -1 for money out, 0 when the cell doesn't say (the amount's own sign is kept). */
function directionSign(raw: string): number {
  const v = raw.trim().toLowerCase();
  if (/^(income|credit|cr|c|in|inflow|deposit|incoming|received|refund|შემოსავალი|შემოსული|კრედიტი|ჩარიცხვა)$/.test(v)) return 1;
  if (/^(expense|debit|dr|d|out|outflow|withdrawal|outgoing|payment|purchase|spending|გასავალი|ხარჯი|დებეტი|გადახდა|ჩამოჭრა)$/.test(v)) return -1;
  return 0;
}

function normHeader(h: string): string {
  return h.replace(/^﻿/, '').toLowerCase().replace(/[_\-./()[\]:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapColumns(header: string[]): Record<Field, number> {
  const norm = header.map(normHeader);
  const used = new Set<number>();
  const take = (field: Field, loose = true): number => {
    const res = loose ? HEADERS[field] : HEADERS[field].slice(0, 1);
    for (const re of res) {
      const i = norm.findIndex((h, j) => h && !used.has(j) && re.test(h));
      if (i >= 0) {
        used.add(i);
        return i;
      }
    }
    return -1;
  };
  // Order matters: exact names claim their columns before the loose "contains" patterns run.
  const idx = {} as Record<Field, number>;
  for (const f of ['currency', 'account', 'customer', 'category', 'counterparty', 'direction'] as Field[]) idx[f] = take(f);
  idx.date = take('date');
  idx.amount = take('amount', false);
  idx.debit = idx.amount >= 0 ? -1 : take('debit');
  idx.credit = idx.amount >= 0 ? -1 : take('credit');
  if (idx.amount < 0 && idx.debit < 0 && idx.credit < 0) idx.amount = take('amount');
  idx.balance = take('balance');
  idx.description = take('description');
  return idx;
}

/** Finds the delimiter and the header row (bank exports often put the account holder and period above it). */
function findHeader(text: string) {
  const head = text.split(/\r?\n/).slice(0, 40).join('\n');
  for (const d of [';', '\t', ',', '|']) {
    const rows = splitRows(head, d);
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      if (rows[r].length < 2) continue;
      const idx = mapColumns(rows[r]);
      if (idx.date >= 0 && (idx.amount >= 0 || idx.debit >= 0 || idx.credit >= 0)) {
        return { rows: splitRows(text, d), headerRow: r, header: rows[r].map((h) => h.trim()), idx };
      }
    }
  }
  return undefined;
}

function guessDelimiter(line: string): string {
  return [';', '\t', ',', '|'].map((d) => [d, splitRows(line, d)[0]?.length ?? 0] as const).sort((a, b) => b[1] - a[1])[0][0];
}

/** RFC 4180-style split: quoted fields may contain the delimiter, doubled quotes and line breaks. */
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && !cur.trim()) {
      quoted = true;
      cur = '';
    } else if (ch === delimiter) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** True when the file writes dates as MM/DD/YYYY: some second part exceeds 12 and no first part does. */
function isMonthFirst(raws: string[]): boolean {
  let firstOver = false;
  let secondOver = false;
  for (const r of raws) {
    const m = r.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver = true;
    if (Number(m[2]) > 12) secondOver = true;
  }
  return secondOver && !firstOver;
}

function parseDate(raw: string, monthFirst = false): string | undefined {
  const s = raw.trim().replace(/^"|"$/g, '');
  const iso = (y: number, mo: number, d: number) =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?!\d)/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return monthFirst ? iso(y, +m[1], +m[2]) : iso(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*\.?[\s,-]+(\d{4})/i); // 15 Oct 2026
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i); // Oct 15, 2026
  if (m && MONTHS.includes(m[1].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = s.match(/^(\d{5})(\.\d+)?$/); // Excel serial day number
  if (m && +m[1] > 32000 && +m[1] < 73000) {
    const d = new Date(Date.UTC(1899, 11, 30) + +m[1] * 86_400_000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return undefined;
}

function normCurrency(raw: string): Currency | '' {
  const s = raw.trim().toUpperCase();
  if (/^(GEL|₾|LARI|ლარი|ლ)$/.test(s)) return 'GEL';
  if (/^(USD|\$|US\$|დოლარი)$/.test(s)) return 'USD';
  return '';
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  let s = raw.trim().replace(/[−–]/g, '-');
  const parens = /^\(.*\)$/.test(s);
  const trailingMinus = /\d-$/.test(s);
  s = s.replace(/[^\d,.+-]/g, '').replace(/-$/, '');
  if (!s || !/\d/.test(s)) return undefined;
  // "1.234,56" → 1234.56 ; "1,234.56" → 1234.56 ; "1234,56" → 1234.56
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return parens || trailingMinus ? -Math.abs(n) : n;
}

// ---------- Analysis ----------

type Category = SpendingCategory['code'] | 'income' | 'salary' | 'transfer';

// Georgian and international merchants/keywords. First match wins.
const RULES: [Category, RegExp][] = [
  ['transfer', /(own account|between (my )?accounts|საკუთარ ანგარიშ|კონვერტაცია|conversion|currency exchange|გადარიცხვა საკუთარ|deposit top.?up|savings transfer)/i],
  ['salary', /(salary|payroll|ხელფას|wage)/i],
  ['loan', /(loan|სესხ|instal?ment|credit repayment|განვადება)/i],
  ['rent', /(rent|ქირა|landlord|apartment)/i],
  ['groceries', /(carrefour|nikora|ნიკორა|spar|goodwill|agrohub|ori nabiji|ორი ნაბიჯი|fresco|ფრესკო|magniti|supermarket|market|სუპერმარკეტ)/i],
  ['utilities', /(telasi|energo.?pro|gwp|tbilisi energy|tbilisi water|თბილისის წყალ|magti|მაგთი|silknet|სილქნეტ|cellfie|beeline|te.?ge|utility|კომუნალ|gas)/i],
  ['transport', /(bolt(?! food)|yandex go|uber|taxi|ტაქსი|wissol|gulf|rompetrol|socar|lukoil|metro|მეტრო|parking|პარკინგ)/i],
  ['leisure', /(restaurant|რესტორან|cafe|კაფე|bar|cinema|netflix|spotify|steam|wolt|glovo|bolt food|booking|airbnb|hotel|travel|ticket|pub)/i],
];

// The bank's own category labels (e.g. the organisers' export), mapped to ours. Internal moves follow
// INTERNAL_TX_CATEGORIES in backend/danazogi/data/organiser_xlsx.py.
const BANK_CATEGORIES: Record<string, Category> = {
  own_transfer: 'transfer', fx_conversion: 'transfer', deposit_funding: 'transfer', deposit_maturity: 'transfer',
  interest_payout: 'transfer', cash_withdrawal: 'transfer', cash_deposit: 'transfer', refund: 'transfer',
  salary: 'salary', pension: 'income', business_income: 'income', freelance_income: 'income', seasonal_income: 'income', interest: 'income',
  rent: 'rent', loan: 'loan', loan_repayment: 'loan', groceries: 'groceries', utilities: 'utilities', telecom: 'utilities',
  transport: 'transport', fuel: 'transport', dining: 'leisure', subscription: 'leisure', entertainment: 'leisure', travel: 'leisure',
  housing: 'rent', transportation: 'transport', dining_fun: 'leisure', restaurants: 'leisure', income: 'income', transfer: 'transfer',
};

function categorize(t: StatementTransaction): Category {
  const bank = t.category && BANK_CATEGORIES[t.category.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')];
  if (bank) return bank;
  const rule = RULES.find(([, re]) => re.test(t.description));
  if (rule) return rule[0];
  return t.amount.amount > 0 ? 'income' : 'other';
}

const ESSENTIAL: SpendingCategory['code'][] = ['rent', 'groceries', 'utilities', 'transport', 'loan'];

export interface StatementAnalysis {
  answers: QuestionnaireAnswers;
  measured: MeasuredFinances;
}

/**
 * Turns transactions into the profile inputs: monthly income and spending (last 12 full or partial
 * months), stability, weak months, category averages, loan, rent currency, USD shares and — when the
 * statement has balances — real month-end savings.
 */
export function analyseStatement(transactions: StatementTransaction[], savings: number, usdGelRate: number): StatementAnalysis {
  if (!transactions.length) throw new Error('no transactions');
  const toGel = (t: StatementTransaction) => (t.amount.currency === 'USD' ? t.amount.amount * usdGelRate : t.amount.amount);
  // Use complete months only: a statement that ends mid-month (e.g. before payday) would
  // otherwise make its last month look like a weak-income month.
  const lastDate = transactions[transactions.length - 1].date;
  const lastMonth = Number(lastDate.slice(8, 10)) >= 28 ? lastDate.slice(0, 7) : monthsBack(lastDate.slice(0, 7), 2)[0];
  // Likewise a statement that starts mid-month would understate its first month.
  const firstDate = transactions[0].date;
  const firstMonth = Number(firstDate.slice(8, 10)) <= 5 ? firstDate.slice(0, 7) : nextMonth(firstDate.slice(0, 7));
  let months = monthsBack(lastMonth, 12).filter((m) => m >= firstMonth);
  // Very short statements: fall back to every month they touch rather than measuring nothing.
  if (!months.length) months = monthsBack(lastDate.slice(0, 7), 12).filter((m) => m >= firstDate.slice(0, 7));
  const inWindow = transactions.filter((t) => months.includes(t.date.slice(0, 7)));

  const income = new Map(months.map((m) => [m, 0]));
  const spending = new Map(months.map((m) => [m, 0]));
  const byCat = new Map<SpendingCategory['code'], { total: number; usd: number }>();
  const salaryMonths = new Set<string>();
  let incomeUsd = 0;
  let incomeTotal = 0;
  let spendUsd = 0;
  let spendTotal = 0;

  for (const t of inWindow) {
    const cat = categorize(t);
    if (cat === 'transfer') continue;
    const m = t.date.slice(0, 7);
    const gel = toGel(t);
    if (gel > 0) {
      income.set(m, income.get(m)! + gel);
      incomeTotal += gel;
      if (t.amount.currency === 'USD') incomeUsd += gel;
      if (cat === 'salary') salaryMonths.add(m);
    } else {
      const out = -gel;
      const code = cat === 'income' || cat === 'salary' ? 'other' : cat;
      spending.set(m, spending.get(m)! + out);
      spendTotal += out;
      if (t.amount.currency === 'USD') spendUsd += out;
      const c = byCat.get(code) ?? { total: 0, usd: 0 };
      c.total += out;
      if (t.amount.currency === 'USD') c.usd += out;
      byCat.set(code, c);
    }
  }

  const n = Math.max(1, months.length);
  const incomeSeries: MonthlyPoint[] = months.map((m) => ({ month: m, value: Math.round(income.get(m)!) }));
  const spendingSeries: MonthlyPoint[] = months.map((m) => ({ month: m, value: Math.round(spending.get(m)!) }));
  const avgIncome = incomeTotal / n;
  const avgSpending = spendTotal / n;
  const cv = avgIncome ? std(incomeSeries.map((p) => p.value)) / avgIncome : 1;
  const lowIncomeMonths = incomeSeries.filter((p) => p.value < avgIncome * 0.6).length;
  const salaryShare = salaryMonths.size / n;
  const incomeType: QuestionnaireAnswers['incomeType'] =
    salaryShare >= 0.8 && cv < 0.25 ? 'salaried' : salaryShare >= 0.5 ? 'mixed' : cv < 0.2 ? 'salaried' : 'freelance';

  const byCategory: SpendingCategory[] = [...byCat.entries()]
    .map(([code, c]) => ({
      code,
      monthly: { amount: Math.round(c.total / n), currency: 'GEL' as const },
      currency: (c.usd > c.total / 2 ? 'USD' : 'GEL') as Currency,
    }))
    .filter((c) => c.monthly.amount > 0)
    .sort((a, b) => b.monthly.amount - a.monthly.amount);
  const loan = byCategory.find((c) => c.code === 'loan')?.monthly.amount ?? 0;
  const essentialMonthly = byCategory.filter((c) => ESSENTIAL.includes(c.code)).reduce((s, c) => s + c.monthly.amount, 0);
  const rentCurrency = byCategory.find((c) => c.code === 'rent')?.currency ?? 'GEL';

  return {
    answers: {
      incomeType,
      monthlyIncome: { amount: Math.round(avgIncome), currency: 'GEL' },
      monthlySpending: { amount: Math.round(avgSpending), currency: 'GEL' },
      rentCurrency,
      savings: { amount: Math.round(savings), currency: 'GEL' },
      hasLoans: loan > 0,
      monthlyLoanPayment: loan ? { amount: loan, currency: 'GEL' } : undefined,
    },
    measured: {
      incomeHistory: incomeSeries,
      spendingHistory: spendingSeries,
      savingsHistory: savingsFromBalances(transactions, months, savings, usdGelRate),
      byCategory,
      essentialMonthly: essentialMonthly || avgSpending * 0.75,
      lowIncomeMonths,
      stabilityScore: Math.round(Math.max(5, Math.min(98, 100 - cv * 120))),
      incomeUsdShare: incomeTotal ? incomeUsd / incomeTotal : 0,
      spendingUsdShare: spendTotal ? spendUsd / spendTotal : 0,
      savingsUsdShare: savingsUsdShare(transactions, usdGelRate),
      detail: { transactions: inWindow.length, from: inWindow[0]?.date ?? transactions[0].date, to: transactions[transactions.length - 1].date },
    },
  };
}

/** USD share of the latest balances in the statement (undefined without a balance column). */
function savingsUsdShare(txs: StatementTransaction[], rate: number): number | undefined {
  const last = new Map<string, Money>();
  for (const t of txs) if (t.balance) last.set(balanceKey(t), t.balance);
  const sum = (c: Currency) => [...last.values()].filter((b) => b.currency === c).reduce((s, b) => s + Math.max(0, b.amount), 0);
  const usd = sum('USD') * rate;
  const total = sum('GEL') + usd;
  return total > 0 ? Math.round((usd / total) * 100) / 100 : undefined;
}

/** One running balance per account and currency. */
const balanceKey = (t: StatementTransaction) => `${t.account ?? ''}|${t.balance?.currency}`;

/** Month-end balances (all accounts in the file, in GEL), scaled so the last point equals today's savings. */
function savingsFromBalances(txs: StatementTransaction[], months: string[], savings: number, rate: number): MonthlyPoint[] | undefined {
  if (!txs.some((t) => t.balance)) return undefined;
  const last = new Map<string, Money>();
  const points: MonthlyPoint[] = [];
  let i = 0;
  for (const m of months) {
    for (; i < txs.length && txs[i].date.slice(0, 7) <= m; i++) {
      const b = txs[i].balance;
      if (b) last.set(balanceKey(txs[i]), b);
    }
    points.push({ month: m, value: [...last.values()].reduce((s, b) => s + (b.currency === 'USD' ? b.amount * rate : b.amount), 0) });
  }
  const end = points[points.length - 1]?.value || 1;
  // The statement may cover one account only; scale its shape to the user's total savings.
  return points.map((p) => ({ ...p, value: Math.round((p.value / end) * savings) }));
}

function monthsBack(lastMonth: string, count: number): string[] {
  const [y, m] = lastMonth.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y, m - 1 - (count - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function std(values: number[]): number {
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, values.length - 1));
}
