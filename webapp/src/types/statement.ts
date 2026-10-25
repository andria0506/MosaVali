// Types for the on-device statement analysis (services/statement.ts). Kept for
// the phase-2 statement import; nothing here comes from or goes to the backend.
import type { Currency, ISODate, Money, MonthlyPoint } from './common';

/** One row of an imported bank statement. Amount is signed: + money in, − money out. */
export interface StatementTransaction {
  date: ISODate;
  amount: Money;
  description: string;
  /** Account balance after this transaction, when the statement has one. */
  balance?: Money;
  /** Account id or number, when the file covers several accounts. */
  account?: string;
  /** The bank's own category label, when the export has one (e.g. "groceries", "own_transfer"). */
  category?: string;
}

/** A bank statement the user exported themselves (parsed on their device). */
export interface StatementImport {
  transactions: StatementTransaction[];
  /** Total savings today; prefilled from the statement's last balance when present. */
  savings: Money;
}

export interface SpendingCategory {
  code: 'rent' | 'groceries' | 'utilities' | 'transport' | 'loan' | 'leisure' | 'other';
  monthly: Money;
  currency: Currency; // currency the bill is actually paid in (e.g. rent in USD)
}

/** Fallback-path answers, derivable from a statement (phase 2). */
export interface QuestionnaireAnswers {
  incomeType: 'salaried' | 'freelance' | 'mixed';
  monthlyIncome: Money;
  monthlySpending: Money;
  rentCurrency?: Currency;
  savings: Money;
  hasLoans: boolean;
  monthlyLoanPayment?: Money;
}

/** Real figures measured from a bank statement. */
export interface MeasuredFinances {
  incomeHistory: MonthlyPoint[];
  spendingHistory: MonthlyPoint[];
  savingsHistory?: MonthlyPoint[];
  byCategory: SpendingCategory[];
  essentialMonthly: number;
  lowIncomeMonths: number;
  stabilityScore: number;
  incomeUsdShare: number;
  spendingUsdShare: number;
  /** Share of savings held in USD, from the statement's latest balances (when it has them). */
  savingsUsdShare?: number;
  detail: { transactions: number; from: ISODate; to: ISODate };
}
