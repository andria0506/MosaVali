import type { StockProfile } from '../types';

/** Stocks the app can explore: live prices via the Yahoo relay, and the backend's stock-check profile for each. */
export const STOCKS: { ticker: string; name: string; profile: StockProfile; keywords: string[] }[] = [
  { ticker: 'AAPL', name: 'Apple', profile: 'big_tech', keywords: ['Apple'] },
  { ticker: 'MSFT', name: 'Microsoft', profile: 'big_tech', keywords: ['Microsoft'] },
  { ticker: 'NVDA', name: 'NVIDIA', profile: 'big_tech', keywords: ['NVIDIA', 'Nvidia'] },
  { ticker: 'GOOGL', name: 'Alphabet', profile: 'big_tech', keywords: ['Alphabet', 'Google'] },
  { ticker: 'AMZN', name: 'Amazon', profile: 'big_tech', keywords: ['Amazon'] },
  { ticker: 'BGEO.L', name: 'Bank of Georgia Group', profile: 'ge_bank', keywords: ['Bank of Georgia', 'BGEO'] },
  { ticker: 'TBCG.L', name: 'TBC Bank Group', profile: 'ge_bank', keywords: ['TBC Bank', 'TBCG'] },
];
