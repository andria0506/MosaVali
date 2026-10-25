export type MissionKey = "protect" | "goal" | "balance" | "growth";
export type Status = "pass" | "warn" | "block" | "info";

export interface Bank { code: string; name: string; name_ka: string }
export type GoalKind = "car" | "apartment" | "education" | "preserve" | "retirement" | "business";
export interface Goal { kind: string; years: number; amount_usd?: number; amount_gel?: number; usd_indexed: number }
export interface GoalInput { kind: GoalKind; amount: number; currency: "GEL" | "USD"; years: number }
export interface Persona {
  id: string; name_ka: string; name_en: string; age: number; city_ka: string; city_en: string;
  occupation_ka: string; occupation_en: string; summary_ka: string; summary_en: string;
  banks: Bank[]; goal: Goal; default_mission: MissionKey; cash_at_home: number; source?: string;
}
export interface TbcSandboxStatus {
  sandbox_url: string; docs_url: string; status_url: string;
  http_status: number; code: string; detail: string; latency_ms: number;
  live_available: boolean; fallback_mode: string; checked_at: string;
}
export interface OrganiserProfileRow {
  profile: string; n: number; mean_income_gel: number; mean_spend_gel: number;
  mean_cash_need_gel: number; mean_next_spend_gel: number; mean_buffer_months: number; mean_savings_opportunity_gel: number;
}
export interface OrganiserDatasetEval {
  file: string; period: string; customers: number; accounts: number; deposits: number; transactions: number;
  mean_cash_need_gel: number; mean_next_spend_gel: number; high_need_count: number; mean_buffer_months: number; peer_groups_covered: number;
  customers_with_savings_opportunity: number; mean_savings_opportunity_gel: number;
  by_profile: OrganiserProfileRow[]; validation_kind: string; limitations: string;
}
export interface Session { consent_id: string; token: string; persona_id: string }
export interface TraceItem { agent: string; ms: number; summary: Record<string, unknown> }
export interface Account {
  id: string; bank: string; bank_name: string; bank_name_ka: string; iban: string; product: string; currency: string;
  balance: number; balance_gel: number; rate: number | null; maturity: string | null; days_to_maturity: number | null; asset: string | null;
}
export interface Category { key: string; label_ka: string; label_en: string; sensitivity: string; essential: boolean; monthly: number }
export interface Contribution { key: string; feature: string; label_ka: string; label_en: string; value: number; effect_gel: number }
export interface Alert { kind: string; tone: string; ka: string; en: string }
export interface PeerRow {
  category: string; label_ka: string; label_en: string; you: number; p50: number; p75: number;
  discretionary: boolean; above_p75: boolean; monthly_saving: number;
}
export interface Profile {
  consent: { banks: string[]; scopes: string[]; expires: string; bank_status: Record<string, string>; cash_at_home: number };
  ingestion: {
    psu: { name_ka: string; name_en: string; age: number; city_ka: string; city_en: string };
    accounts: Account[]; cash_at_home: number; transaction_count: number; months_of_history: number;
    holdings_gel: Record<string, number>;
    totals: { assets_gel: number; liabilities_gel: number; usd_share: number; cash_share: number; liquid_gel: number };
    income_type: string; pay_day: number;
    metrics: { monthly_income: number; monthly_spend: number; essential_spend: number; savings_velocity: number; idle_cash_gel: number };
    categories: Category[];
  };
  liquidity: {
    expected_need_gel: number; cautious_need_gel: number; horizon_months: number; coverage_target: number;
    high_need: boolean; buffer_months: number; funded_buffer_months: number; buffer_gel: number;
    required_buffer_gel: number; buffer_shortfall_gel: number; buffer_share: number;
    minimum_months: number; minimum_gel: number; bound_collapsed: boolean; reserve_basis: ReserveBasis;
    free_to_invest_gel: number; contributions: Contribution[]; explanation_method: string;
    fallback: { active: boolean; reasons: string[]; needs_review: boolean }; model_version: string;
  };
  spending: {
    expected_gel: number; cautious_gel: number; coverage_target: number; horizon_months: number;
    income_reference_gel: number; affordable_monthly_gel: number; income_basis: string;
    contributions: Contribution[]; explanation_method: string;
    fallback: { active: boolean; reasons: string[]; needs_review: boolean }; model_version: string;
  };
  profile: {
    goal: Goal & { ka: string; en: string; target_today_gel: number };
    horizon: number; usd_liability_share: number;
    capacity: { score: number; level: number; equity_cap: number; parts: Record<string, number>; weights: Record<string, number> };
    alerts: Alert[];
  };
  peers: { group: { id: number; name: { ka: string; en: string }; size: number; median_income: number }; rows: PeerRow[]; monthly_total: number; model_version: string };
  inflation: { personal: number; national: number; gap: number; rows: { key: string; label_ka: string; label_en: string; share: number; inflation: number; contribution: number }[]; source: string };
  idle_cash_loss_per_year: number;
  default_monthly: number;
  default_mission: MissionKey;
  goal_source: "customer" | "custom_input" | "organiser_assumed" | "persona";
  partial_data: boolean;
  trace: TraceItem[];
  models: Record<string, string>;
}
export interface Check { rule: string; status: Status; title_ka: string; title_en: string; ka: string; en: string }
export interface Compliance { mission: MissionKey; checks: Check[]; blocked: boolean; blocking_rules: string[]; needs_acknowledgment: string[] }
export interface Mission {
  key: MissionKey; rank: number; ka: string; en: string; objective_ka: string; objective_en: string; level: number; glide: boolean;
  weights: Record<string, number>; glide_path: Record<string, number>[]; probability: number;
  terminal: { p10: number; median: number; p90: number }; terminal_real: { p10: number; median: number; p90: number };
  plan_return: number; cvar95: number; worst5_loss_gel: number; replay_2015_gel: number; replay_2015: number; equity_share: number;
  compliance: Compliance;
}
export interface Strategy {
  key: string; label_ka: string; label_en: string; probability: number; worst5_shortfall_gel: number;
  lari_shock_2015: number; lari_shock_2015_gel: number; monthly_needed_80: number | null; median_annual_return: number; months_to_goal: number | null;
}
export interface Levers {
  target_probability: number; probability: number; on_track: boolean;
  savings_boost?: { extra_monthly: number; probability: number; months_to_goal_before: number | null; months_to_goal_after: number | null; months_sooner: number | null };
  extra_monthly?: number | null; extra_months?: number; cheaper_target_by?: number; target_at_80?: number;
}
export interface Asset { key: string; code: string; name_ka: string; name_en: string; currency: string; rate: number; source: string }
export type ReserveBasis = "cash_need_model" | "minimum_rule" | "fallback_minimum" | "all_assets";
export type RecommendationReason = "preserve_goal" | "only_safe_allowed" | "none_reach" | "all_reach_lowest_risk" | "best_chance";
export interface MissionsView {
  monthly: number; recommended: MissionKey; selected: MissionKey | null; capacity: { level: number; equity_cap: number };
  behaviour_score: number | null; missions: Mission[];
  recommendation_reason: RecommendationReason; recommendation_text: { ka: string; en: string };
  current: { weights: Record<string, number>; metrics: { cvar95: number }; worst5_loss_gel: number };
  strategies: Strategy[]; levers: Levers; focus: MissionKey; target_today: number; goal_inflation: number;
  assets: Asset[]; market: { fx_spot: number }; trace: TraceItem[];
}
export interface Trade {
  id: string; kind: "one_off" | "recurring"; asset: string; asset_ka: string; asset_en: string;
  amount_gel: number; proposed_gel: number; amount_usd: number; convert: boolean; date: string; timing: string;
  from: { account: string; bank: string; bank_ka: string; iban: string; product_ka: string; product_en: string; currency: string };
  action_ka: string; action_en: string; when_ka: string; when_en: string;
  status: "proposed" | "approved" | "rejected" | "edited" | "blocked"; checks: Check[]; split?: Record<string, number>;
}
export interface PlanResult { mission: Mission; trades: Trade[]; levers: Levers; acknowledged: string[]; monthly: number }
export interface Sentence { id: string; ka: string; en: string; evidence: { code: string; value: string }[]; tone?: string }
export interface Explanation {
  mission: MissionKey;
  features: { key: string; label_ka: string; label_en: string; user_ka: string; user_en: string; reference_ka: string; reference_en: string }[];
  phi: Record<string, Record<string, number>>; base_weights: Record<string, number>; final_weights: Record<string, number>;
  coalitions: number; narrative: Sentence[]; liquidity_contributions: Contribution[]; trace: TraceItem[];
}
export interface Instruction {
  id: string; created: string; client_ka: string; client_en: string; mission: { key: MissionKey; ka: string; en: string; probability: number };
  steps: Trade[]; total_gel: number; monthly_total_gel: number; acknowledged_warnings: string[]; fx_rate: number; disclaimer_ka: string; disclaimer_en: string;
}
export type ChapterCode = "S08" | "S15" | "S20" | "S22";
export interface FlightPoint {
  month: string; value: number; passive: number; buying_power: number; passive_buying_power: number; fx: number; drawdown: number; chapter: string;
  ghosts?: Record<string, number>;
}
export interface FlightDecision {
  month: string; chapter: ChapterCode; chapter_ka: string; chapter_en: string; drawdown: number; context_ka: string; context_en: string;
  equity_since_start: number; lari_since_start: number; prices_since_start: number; fx_level: number;
}
export interface FlightResult {
  score: number | null; evidence: boolean; max_drawdown: number; tolerated_drawdown: number; panic_sells: number; bought_dips: number; chased_gains: number;
  final_value: number; passive_value: number; final_buying_power: number; passive_buying_power: number; actions_cost_gel: number;
  fits: MissionKey[]; ghost_buying_power: Record<string, number>; measured_in: string;
}
export interface Flight {
  id: string; mission: MissionKey; month_index: number; months: number; chapters: ChapterCode[]; done: boolean; value: number; history: FlightPoint[];
  next: { month: string; chapter: ChapterCode; chapter_ka: string; chapter_en: string } | null;
  decision: FlightDecision | null;
  available: Record<"hold" | "sell" | "rebalance" | "buy", { ok: boolean; reason_ka: string; reason_en: string }>;
  coach: { month: string; kind: string; ka: string; en: string }[];
  actions: { month: string; action: string; drawdown: number }[];
  result: FlightResult | null;
  source: string;
}
export type Episodes = Record<ChapterCode, number>;
export interface Outcome {
  probability: number; median_real_value: number; worst5_real_value: number; worst5_shortfall_gel: number; prob_loss: number;
  median_annual_return: number; yearly_swing: number; episodes: Episodes;
}
export interface FundRow extends Outcome {
  key: string; code: string; name_ka: string; name_en: string; desc_ka: string; desc_en: string; currency: string;
  fee: number; fx_cost: number; assumed_return: number; source: string; asset: string | null;
}
export interface FundsView {
  funds: FundRow[]; plan: Outcome & { key: MissionKey }; monthly: number; start: number; target_today: number; horizon: number;
  preserve: boolean; mission: MissionKey; source: string; disclaimer_ka: string; disclaimer_en: string; trace: TraceItem[];
}
export type StockProfile = "big_tech" | "ge_bank" | "local_small";
export interface StockCheck {
  profile: { key: StockProfile; name_ka: string; name_en: string; desc_ka: string; desc_en: string; currency: string; source: string };
  share: number; mission: MissionKey; amount_gel: number; monthly: number;
  plan: Outcome; with_stock: Outcome;
  stock: { halving_probability: number; worst_year_p5: number; median_annual_return: number; episodes: Episodes };
  rule: { code: string; ka: string; en: string };
}
export interface AuditEntry { seq: number; ts: string; actor: string; event: string; details: Record<string, unknown>; models: Record<string, string>; prev: string; hash: string }
export interface AuditView { entries: AuditEntry[]; verification: { valid: boolean; entries?: number; head?: string; broken_at?: number } }
export interface RegressionMetric {
  mae_gel: number; rmse_gel: number; r2: number; mean_actual_gel: number; mean_predicted_gel: number;
  underprediction_rate: number; n: number; upper_coverage?: number; mean_upper_gel?: number;
}
export interface RegressionCard {
  version: string; winner: string; decision: string; decision_ka: string;
  features: { key: string; label_ka: string; label_en: string }[];
  coverage_target: number; baseline_rule: string;
  metrics: {
    validation: Record<string, RegressionMetric>;
    test: { champion: RegressionMetric; challenger: RegressionMetric; selected: RegressionMetric; baseline: RegressionMetric };
    stress_regime: { champion: RegressionMetric; challenger: RegressionMetric; selected: RegressionMetric; baseline: RegressionMetric };
  };
  fairness: {
    protected_attributes_used_as_inputs: boolean; note: string;
    tables: Record<string, (RegressionMetric & { group: string })[]>;
  };
  data: { label: string; source: string; split: string; stress_source: string; limitations: string;
          train_n: number; validation_n: number; calibration_n: number; test_n: number; stress_n: number };
  diagnostics?: {
    model_version?: string; notes?: string[];
    reserve_effect?: {
      test?: { model_sets_reserve_share: number; mean_uplift_over_rule_gel: number;
               reserve_coverage_with_model: number; reserve_coverage_rule_only: number };
      stress?: { model_sets_reserve_share: number; mean_uplift_over_rule_gel: number;
                 reserve_coverage_with_model: number; reserve_coverage_rule_only: number };
    };
  };
}
export interface ModelCards {
  liquidity: RegressionCard;
  spending: RegressionCard;
  peers: { version: string; k: number; stability_ari: number; min_group: number; max_gender_dominance: number; groups: { id: number; name: { ka: string; en: string }; size: number }[]; inputs: string[] };
  organiser_dataset?: OrganiserDatasetEval | null;
}
export interface Receipt { consent_id: string; revoked_at: string; purged: Record<string, number>; audit_head: string }

export interface CustomCustomerIn {
  label?: string; age?: number; region?: "tbilisi" | "adjara" | "imereti" | "other"; household?: number; bank?: string;
  income_kind?: "salary" | "pension" | "business"; monthly_income?: number; pay_day?: number;
  rent?: number; utilities?: number; groceries?: number; transport?: number;
  delivery?: number; dining?: number; taxi?: number; other?: number;
  usd_loan_instalment?: number; usd_loan_balance?: number;
  gel_current?: number; gel_savings?: number; gel_term_deposit?: number; usd_savings?: number; cash_at_home?: number;
  goal: GoalInput;
}
