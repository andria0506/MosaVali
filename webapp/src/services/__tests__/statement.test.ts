import { describe, expect, it } from 'vitest';
import { StatementError, analyseStatement, decodeStatement, parseStatementCsv } from '../statement';
import sample from '../../../public/sample-statement.csv?raw';

describe('parseStatementCsv', () => {
  it('reads the Georgian sample: ";" separator, DD.MM.YYYY, decimal commas, balances', () => {
    const p = parseStatementCsv(sample);
    expect(p.transactions).toHaveLength(444);
    expect(p.skipped).toBe(0);
    expect(p.columns).toEqual(['თარიღი', 'დანიშნულება', 'თანხა', 'ვალუტა', 'ნაშთი']);
    expect(p.transactions[0].date).toBe('2025-11-01');
    expect(p.lastBalance).toEqual({ GEL: 10320.47, USD: 4870.84 });
  });

  it('reads English headers, "," separator, ISO dates and separate debit/credit columns', () => {
    const csv = 'Date,Description,Debit,Credit,Currency\n2026-09-25,Salary ACME,,"4,000.00",GEL\n2026-09-26,Nikora,85.40,,GEL\n2026-10-01,Rent,600,,USD\n';
    const p = parseStatementCsv(csv);
    expect(p.transactions.map((t) => [t.date, t.amount.amount, t.amount.currency])).toEqual([
      ['2026-09-25', 4000, 'GEL'],
      ['2026-09-26', -85.4, 'GEL'],
      ['2026-10-01', -600, 'USD'],
    ]);
  });

  it('skips other currencies and unreadable rows instead of guessing', () => {
    const csv = 'Date;Description;Amount;Currency\n01/10/2026;Card;-10,00;EUR\nnot a date;x;5;GEL\n02/10/2026;Bolt ride;-12,50;GEL\n';
    const p = parseStatementCsv(csv);
    expect(p.transactions).toHaveLength(1);
    expect(p.skipped).toBe(1);
    expect(p.otherCurrency).toBe(1);
  });

  it('rejects files without date and amount columns, naming the columns it saw', () => {
    expect(() => parseStatementCsv('Name,Value\na,1\nb,2\n')).toThrow(StatementError);
    try {
      parseStatementCsv('Name,Value\na,1\nb,2\n');
    } catch (e) {
      expect((e as StatementError).code).toBe('columns');
      expect((e as StatementError).detail.columns).toEqual(['Name', 'Value']);
    }
  });

  it('reads the organisers\' transaction export: snake_case headers, several customers, accounts and EUR', () => {
    const csv = [
      'transaction_id,account_id,customer_id,booking_date,currency,category,amount,balance_after,counterparty,description',
      'TX-1,ACC-1,CUS-001,2026-04-22,GEL,groceries,-39.86,5623.90,Carrefour,Grocery purchase',
      'TX-2,ACC-9,CUS-001,2026-04-23,USD,fx_conversion,100.00,300.00,,FX conversion',
      'TX-3,ACC-1,CUS-001,2026-04-25,GEL,salary,2150.00,7773.90,Employer LLC,Salary',
      'TX-4,ACC-7,CUS-001,2026-04-26,EUR,shopping,-20.00,80.00,Zara,Clothing',
      'TX-5,ACC-2,CUS-002,2026-04-22,GEL,groceries,-12.00,900.00,Nikora,Grocery purchase',
    ].join('\n');
    const p = parseStatementCsv(csv);
    expect(p.customers).toEqual(['CUS-001', 'CUS-002']);
    expect(p.customer).toBe('CUS-001');
    expect(p.transactions).toHaveLength(3);
    expect(p.otherCurrency).toBe(1);
    expect(p.transactions[0]).toMatchObject({ date: '2026-04-22', account: 'ACC-1', category: 'groceries', description: 'Carrefour — Grocery purchase' });
    expect(p.lastBalance).toEqual({ GEL: 7773.9, USD: 300 });
    expect(parseStatementCsv(csv, { customer: 'CUS-002' }).transactions).toHaveLength(1);
  });

  it('finds the header below preamble lines and reads quoted line breaks, US dates and trailing minus signs', () => {
    const csv = 'Account statement\nIBAN: GE00TB0000000000000000\n\n"Transaction Date","Details","Amount (GEL)"\n"10/25/2026","Wolt\norder 123","45.10-"\n"10/26/2026","Salary","1,200.00"\n';
    const p = parseStatementCsv(csv);
    expect(p.transactions.map((t) => [t.date, t.amount.amount, t.description])).toEqual([
      ['2026-10-25', -45.1, 'Wolt\norder 123'],
      ['2026-10-26', 1200, 'Salary'],
    ]);
  });

  it('decodes UTF-16 exports and refuses Excel workbooks with a specific error', () => {
    const text = 'Date\tDescription\tAmount\n2026-10-01\tBolt\t-5\n';
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) utf16[2 + i * 2] = text.charCodeAt(i);
    expect(parseStatementCsv(decodeStatement(utf16.buffer)).transactions).toHaveLength(1);
    expect(() => decodeStatement(new Uint8Array([0x50, 0x4b, 3, 4]).buffer)).toThrow(StatementError);
  });

  it('says why when no row is usable', () => {
    expect(() => parseStatementCsv('Date;Amount;Currency\n01.10.2026;-5;EUR\n')).toThrow(expect.objectContaining({ code: 'currency' }));
    expect(() => parseStatementCsv('Date;Amount\nsoon;-5\n')).toThrow(expect.objectContaining({ code: 'rows' }));
  });
});

describe('analyseStatement with bank categories and several accounts', () => {
  it('uses the category column, ignores internal moves and sums balances over accounts', () => {
    const rows = ['account_id,booking_date,currency,category,amount,balance_after,description'];
    for (const m of ['05', '06', '07', '08']) {
      rows.push(`A,2026-${m}-01,GEL,salary,2000,3000,Pay`);
      rows.push(`A,2026-${m}-03,GEL,own_transfer,-500,2500,To savings`);
      rows.push(`S,2026-${m}-03,GEL,own_transfer,500,${Number(m) * 500},From current`);
      rows.push(`A,2026-${m}-10,GEL,dining,-100,2400,Dinner`);
    }
    rows.push('A,2026-08-30,GEL,groceries,-1,2399,Bread');
    const p = parseStatementCsv(rows.join('\n'));
    const a = analyseStatement(p.transactions, 6399, 2.7);
    expect(p.lastBalance).toEqual({ GEL: 2399 + 4000 });
    expect(a.answers.monthlyIncome.amount).toBe(2000);
    expect(a.measured.byCategory.find((c) => c.code === 'leisure')?.monthly.amount).toBe(100);
    expect(a.measured.incomeHistory.map((x) => x.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
  });
});

describe('unsigned amounts with a type column', () => {
  // Shape of a common synthetic/budgeting export: positive amounts, Income/Expense in its own column.
  const csv = [
    'date,person,transaction_type,category,merchant,amount,currency,recurrence,description,synthetic_data',
    ...['2026-06', '2026-07', '2026-08'].flatMap((m) => [
      `${m}-01,Giorgi,Income,Salary,Employer Payroll,3000.0,GEL,Monthly,Monthly salary,True`,
      `${m}-03,Giorgi,Expense,Housing,Landlord / Rent,750.0,GEL,Monthly,Monthly rent,True`,
      `${m}-10,Giorgi,Expense,Dining & Fun,Cafe,120.5,GEL,,Dinner,True`,
      `${m}-20,Giorgi,Expense,Transportation,Bolt,40,GEL,,Taxi,True`,
      `${m}-28,Giorgi,Expense,Groceries,Nikora,300,GEL,,Weekly shop,True`,
    ]),
  ].join('\n');

  it('signs expenses as money out and maps the bank categories', () => {
    const p = parseStatementCsv(csv);
    expect(p.transactions).toHaveLength(15);
    expect(p.transactions.filter((t) => t.amount.amount < 0)).toHaveLength(12);
    const a = analyseStatement(p.transactions, 5000, 2.7);
    expect(a.answers.monthlyIncome.amount).toBe(3000);
    expect(a.answers.monthlySpending.amount).toBe(1211);
    const cat = (code: string) => a.measured.byCategory.find((c) => c.code === code)?.monthly.amount;
    expect(cat('rent')).toBe(750);
    expect(cat('leisure')).toBe(121);
    expect(cat('transport')).toBe(40);
    expect(cat('groceries')).toBe(300);
  });
});

describe('analyseStatement', () => {
  const p = parseStatementCsv(sample);
  const a = analyseStatement(p.transactions, 22974, 2.5978);

  it('measures income and spending over complete months, excluding own-account transfers and conversions', () => {
    expect(a.measured.incomeHistory).toHaveLength(11); // Nov–Sep; October ends on the 20th, before payday
    expect(a.answers.monthlyIncome.amount).toBe(5571);
    expect(a.answers.monthlySpending.amount).toBe(3590);
  });

  it('recognises a steady salary, USD rent and the loan', () => {
    expect(a.answers.incomeType).toBe('salaried');
    expect(a.measured.lowIncomeMonths).toBe(0);
    expect(a.answers.rentCurrency).toBe('USD');
    expect(a.answers.monthlyLoanPayment?.amount).toBe(380);
    const rent = a.measured.byCategory.find((c) => c.code === 'rent');
    expect(rent?.currency).toBe('USD');
  });

  it('takes the savings split and history from the balances', () => {
    expect(a.measured.savingsUsdShare).toBeCloseTo(0.55, 2);
    expect(a.measured.savingsHistory?.at(-1)?.value).toBe(22974);
  });
});
