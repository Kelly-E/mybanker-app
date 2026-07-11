"use client";

import { storage, startCheckout, getPremiumProfile, openBillingPortal, getCurrentUser, updateEmail, updatePassword, upgradeToEmailAccount, signInWithEmail, signOut, requestPasswordReset } from "../lib/storage";
import React, { useState, useMemo, useEffect } from "react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const fmt = (n) => Math.round(n || 0).toLocaleString("ja-JP");

// Supabaseから返ってくる英語のエラーメッセージを日本語に変換する
const toJaError = (err) => {
  const msg = err?.message || "";
  if (msg.includes("already registered") || msg.includes("User already registered") || msg.includes("already been registered")) return "このメールアドレスはすでに登録されています。ログインしてください。";
  if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials")) return "メールアドレスまたはパスワードが正しくありません。";
  if (msg.includes("Email not confirmed")) return "メール認証が完了していません。届いたメール内のリンクを開いてください。";
  if (msg.includes("Password should be at least")) return "パスワードは6文字以上にしてください。";
  if (msg.includes("Unable to validate email address")) return "メールアドレスの形式が正しくありません。";
  if (msg.includes("Email rate limit exceeded") || msg.includes("over_email_send_rate_limit")) return "メールの送信が多すぎます。しばらく待ってから再試行してください。";
  if (msg.includes("Token has expired") || msg.includes("expired")) return "リンクの有効期限が切れています。もう一度お試しください。";
  if (msg.includes("User not found")) return "このメールアドレスは登録されていません。";
  if (msg.includes("New password should be different")) return "新しいパスワードは現在のパスワードと異なるものにしてください。";
  if (msg.includes("signup is disabled")) return "現在、新規登録を受け付けていません。";
  return "エラーが発生しました。時間をおいて再試行してください。";
};
const fmtManOku = (v) => {
  const oku = 100000000;
  if (Math.abs(v) >= oku) {
    return `${(Math.round((v / oku) * 100) / 100).toLocaleString("ja-JP")}億`;
  }
  return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
};
const pct = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);

// スマホのタッチ操作だと、指を離してもRechartsのツールチップが残ってしまうことがある。
// touchEnd時にチャートを強制的に再マウントし、ツールチップの内部状態をリセットする。
function TouchDismissChart({ children }) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <div onTouchEnd={() => setResetKey((k) => k + 1)} onTouchCancel={() => setResetKey((k) => k + 1)}>
      <div key={resetKey}>{children}</div>
    </div>
  );
}

// スタック型の積み上げグラフ用：ポイントした時点の合計金額を一番上に表示するツールチップ
function TotalTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div style={styles.tooltipBox}>
      <p style={styles.tooltipLabel}>{label}</p>
      <p style={styles.tooltipTotal}>合計：¥{fmt(total)}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ ...styles.tooltipRow, color: p.color }}>{p.name}：¥{fmt(p.value)}</p>
      ))}
    </div>
  );
}

function LogoIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <ellipse cx="24" cy="32" rx="18" ry="8" fill="#E3A547" stroke="#B5582E" strokeWidth="1.5" />
      <ellipse cx="24" cy="29" rx="18" ry="8" fill="#F2C66B" stroke="#B5582E" strokeWidth="1.5" />
      <path d="M24 29 C24 22, 24 18, 24 13" stroke="#2F6B4F" strokeWidth="2" strokeLinecap="round" />
      <path d="M24 18 C24 13, 30 10, 35 12 C33 18, 28 19, 24 18 Z" fill="#5FA86A" stroke="#2F6B4F" strokeWidth="1.2" />
      <path d="M24 22 C24 18, 19 16, 15 18 C17 23, 21 24, 24 22 Z" fill="#7FC086" stroke="#2F6B4F" strokeWidth="1.2" />
    </svg>
  );
}

const RISK_PROFILES = {
  aggressive: { label: "積極運用", rate: 0.07, mix: "株式投資（NISAなど）・その他運用は全世界株式100%を想定", defaultRatios: { savings: 0.15, nisa: 0.75, free: 0.10 } },
  balanced: { label: "バランス運用", rate: 0.04, mix: "株式投資（NISAなど）・その他運用は株式50%・債券50%を想定", defaultRatios: { savings: 0.35, nisa: 0.50, free: 0.15 } },
  safe: { label: "安全運用", rate: 0.015, mix: "株式投資（NISAなど）・その他運用は国内債券中心など低リスクの投資信託を想定", defaultRatios: { savings: 0.60, nisa: 0.25, free: 0.15 } },
};

const REVIEW_SPANS = { daily: "毎日", weekly: "毎週", monthly: "毎月", quarterly: "四半期ごと", halfyear: "半年ごと", yearly: "一年ごと" };

const DEFAULT_EXPENSES = [
  { key: "rent", label: "家賃・住居費", amount: "" },
  { key: "food", label: "食費", amount: "" },
  { key: "social", label: "交際費", amount: "" },
  { key: "subs", label: "通信・サブスク", amount: "" },
  { key: "beauty", label: "美容（美容院・ネイル・化粧品・衣服）", amount: "" },
  { key: "insurance", label: "保険", amount: "" },
];

// 単身世帯・年代別の金融資産統計（万円）と平均月間消費支出（万円）の目安。
// 金融資産（平均値・中央値）出典：金融経済教育推進機構(J-FLEC)「家計の金融行動に関する世論調査」の単身世帯データ（複数年版・令和4〜7年の公表値を組み合わせた概算であり、単一年次の精密な値ではありません）。
// 月間消費支出 出典：総務省統計局「家計調査（家計収支編）2024年 単身世帯」（年齢階級別の公表値。同調査は34歳以下／35〜59歳／60歳以上の3区分のため、各年代に割り当てて概算）。
// いずれも厳密な分布データではなく、公表されている平均値・中央値・統計値から簡易的に推定するための参考値です。
const AGE_STATS = {
  // 10歳刻みの元データ
  20: { mean: 176, median: 20, monthlyExpense: 17.6 },
  30: { mean: 494, median: 75, monthlyExpense: 18.0 },
  40: { mean: 825, median: 250, monthlyExpense: 18.5 },
  50: { mean: 1253, median: 300, monthlyExpense: 18.5 },
  60: { mean: 1819, median: 700, monthlyExpense: 15.9 },
  70: { mean: 1633, median: 700, monthlyExpense: 15.9 },
  // 5歳刻み(LP簡易診断用)
  // 20代前半: 学生・社会人なりたてが多くほぼゼロから。20代全体平均より低め
  "20-24": { mean: 60, median: 5, label: "20代前半（20〜24歳）" },
  // 20代後半: 数年働いて積み上がり始める時期
  "25-29": { mean: 230, median: 50, label: "20代後半（25〜29歳）" },
  // 30代前半
  "30-34": { mean: 350, median: 80, label: "30代前半（30〜34歳）" },
  // 30代後半
  "35-39": { mean: 620, median: 180, label: "30代後半（35〜39歳）" },
  // 40代前半
  "40-44": { mean: 720, median: 220, label: "40代前半（40〜44歳）" },
  // 40代後半
  "45-49": { mean: 950, median: 310, label: "40代後半（45〜49歳）" },
  // 50代前半
  "50-54": { mean: 1100, median: 320, label: "50代前半（50〜54歳）" },
  // 50代後半
  "55-59": { mean: 1420, median: 380, label: "50代後半（55〜59歳）" },
  // 60代以上は従来通り
  "60+": { mean: 1819, median: 700, label: "60代以上" },
};

// 年収（万円）の年代別目安。
// 出典：パーソルキャリア「doda 平均年収ランキング2025」（2025年12月発表、2024年9月〜2025年8月にdodaへ登録した約60万人の正社員データ。20代・30代・40代・50代以上の4区分）。
// 60代・70代は同調査の対象範囲（20〜65歳）外のため、退職後の収入減少傾向を踏まえた独自の概算値です。
const INCOME_STATS = {
  20: { mean: 365, median: 350 },
  30: { mean: 454, median: 410 },
  40: { mean: 517, median: 450 },
  50: { mean: 601, median: 500 },
  60: { mean: 400, median: 330 },
  70: { mean: 280, median: 230 },
};

// 単身世帯の消費支出の費目別シェア（%）の目安。出典：総務省「家計調査（家計収支編）2024年 単身世帯」の費目別データを参考にした概算。
const EXPENSE_CATEGORY_SHARE = {
  食費: 0.26, 住居費: 0.13, 通信費: 0.06, 交際費: 0.05, 美容: 0.04, 保険: 0.05, その他: 0.41,
};

// 平均的な貯蓄率（収入に対する貯蓄・投資の割合, %）の年代別目安。
// 出典：金融経済教育推進機構(J-FLEC)「家計の金融行動に関する世論調査」の年間収入からの貯蓄割合データ（複数年版の公表値を組み合わせた概算）。
const SAVINGS_RATE_STATS = {
  20: 12, 30: 15, 40: 16, 50: 17, 60: 14, 70: 10,
};

// 年収帯別の総資産・支出・貯蓄率の目安。
// ※直接的に「年収帯別×総資産×支出×貯蓄率」を同時に調査した単一の公的統計は無いため、
// J-FLECの年収別資産データ・総務省家計調査の収入別消費支出データの傾向を踏まえて組み合わせた推定モデルです。
const INCOME_BRACKET_STATS = [
  { label: "300万円未満", min: 0, max: 300, assetMean: 320, assetMedian: 90, monthlyExpense: 15.5, savingsRate: 8 },
  { label: "300〜500万円", min: 300, max: 500, assetMean: 620, assetMedian: 220, monthlyExpense: 18.0, savingsRate: 13 },
  { label: "500〜700万円", min: 500, max: 700, assetMean: 1020, assetMedian: 420, monthlyExpense: 21.0, savingsRate: 17 },
  { label: "700〜1000万円", min: 700, max: 1000, assetMean: 1650, assetMedian: 700, monthlyExpense: 25.5, savingsRate: 21 },
  { label: "1000万円以上", min: 1000, max: Infinity, assetMean: 2900, assetMedian: 1300, monthlyExpense: 32.0, savingsRate: 26 },
];
function getIncomeBracket(annualIncomeMan) {
  return INCOME_BRACKET_STATS.find((b) => annualIncomeMan >= b.min && annualIncomeMan < b.max) || INCOME_BRACKET_STATS[INCOME_BRACKET_STATS.length - 1];
}

// 東証プライム上場企業社員の目安データ。
// 年収 出典：株式会社帝国データバンク「上場企業の『平均年間給与』動向調査（2024年度決算）」東証プライム上場企業平均763.3万円。
// 中央値・総資産・支出・貯蓄率は直接の公表統計が無いため、上記年収水準と一般的な収入・資産の相関傾向を踏まえた推定値です。
const PRIME_STATS = {
  incomeMean: 763.3, incomeMedian: 660,
  assetMean: 2100, assetMedian: 950,
  monthlyExpense: 26.5,
  savingsRate: 23,
};

// 東証プライム上場企業社員の「年代別」データは公表されておらず、一般的な大企業の年功カーブを踏まえた概算の係数。
// PRIME_STATS（全年代平均）に、この係数を掛けて年代ごとの目安値を推定する。
const PRIME_AGE_FACTOR = {
  20: 0.62, 30: 0.92, 40: 1.18, 50: 1.32, 60: 0.95, 70: 0.65,
};
function getPrimeStatsForAge(decade) {
  const f = PRIME_AGE_FACTOR[decade] || 1;
  return {
    incomeMean: Math.round(PRIME_STATS.incomeMean * f),
    incomeMedian: Math.round(PRIME_STATS.incomeMedian * f),
    assetMean: Math.round(PRIME_STATS.assetMean * f),
    assetMedian: Math.round(PRIME_STATS.assetMedian * f),
    monthlyExpense: Math.round(PRIME_STATS.monthlyExpense * Math.min(f, 1.15) * 10) / 10,
    savingsRate: PRIME_STATS.savingsRate,
  };
}

// 年収帯（万円）に応じた手取り率（%）の目安テーブル。社会保険料・所得税（累進）・住民税を踏まえた
// 一般的な「年収別手取り早見表」の概算値を参考にしています（独身・扶養なしを想定した簡易モデル）。
// 厳密な税額計算ではなく、年収帯によって手取り率が変わることを反映するための近似です。
const TAKEHOME_RATIO_TABLE = [
  { gross: 100, ratio: 0.92 },
  { gross: 200, ratio: 0.84 },
  { gross: 300, ratio: 0.81 },
  { gross: 400, ratio: 0.79 },
  { gross: 500, ratio: 0.77 },
  { gross: 600, ratio: 0.76 },
  { gross: 700, ratio: 0.75 },
  { gross: 800, ratio: 0.74 },
  { gross: 900, ratio: 0.73 },
  { gross: 1000, ratio: 0.72 },
  { gross: 1200, ratio: 0.70 },
  { gross: 1500, ratio: 0.68 },
  { gross: 2000, ratio: 0.65 },
];

function getTakeHomeRatio(annualGrossMan) {
  const t = TAKEHOME_RATIO_TABLE;
  if (annualGrossMan <= t[0].gross) return t[0].ratio;
  if (annualGrossMan >= t[t.length - 1].gross) return t[t.length - 1].ratio;
  for (let i = 0; i < t.length - 1; i++) {
    if (annualGrossMan >= t[i].gross && annualGrossMan <= t[i + 1].gross) {
      const span = t[i + 1].gross - t[i].gross;
      const progress = (annualGrossMan - t[i].gross) / span;
      return t[i].ratio + (t[i + 1].ratio - t[i].ratio) * progress;
    }
  }
  return 0.78;
}

function getAgeDecade(age) {
  if (age < 30) return 20;
  if (age < 40) return 30;
  if (age < 50) return 40;
  if (age < 60) return 50;
  if (age < 70) return 60;
  return 70;
}

// 5歳刻みの資産統計キーを返す
function getAge5Key(age) {
  if (age < 25) return "20-24";
  if (age < 30) return "25-29";
  if (age < 35) return "30-34";
  if (age < 40) return "35-39";
  if (age < 45) return "40-44";
  if (age < 50) return "45-49";
  if (age < 55) return "50-54";
  if (age < 60) return "55-59";
  return "60+";
}

// 5歳刻みの資産統計を返す
function getAge5Stats(age) {
  return AGE_STATS[getAge5Key(age)];
}

// 標準正規分布の累積分布関数（誤差関数の近似）
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

// 平均値・中央値から対数正規分布を仮定して、上位何%に位置するかを推定する簡易モデル
function estimatePercentile(value, mean, median) {
  if (value <= 0) return 100;
  const mu = Math.log(median);
  const ratio = mean / median;
  const sigma2 = 2 * Math.log(ratio > 1 ? ratio : 1.01);
  const sigma = Math.sqrt(sigma2);
  const z = (Math.log(value) - mu) / sigma;
  const percentileBelow = normalCdf(z) * 100;
  const topPercent = Math.max(1, Math.min(99, Math.round(100 - percentileBelow)));
  return topPercent;
}

// 平均値・中央値から対数正規分布を仮定して、簡易的な分布（ヒストグラム）を生成する。
// 実際の刻み別統計データではなく、推定モデルによる概算カーブです。
function generateDistributionCurve(mean, median, bucketCount = 10) {
  const mu = Math.log(median);
  const ratio = mean / median;
  const sigma2 = 2 * Math.log(ratio > 1 ? ratio : 1.01);
  const sigma = Math.sqrt(sigma2);
  const maxX = median * Math.exp(2.2 * sigma); // 概ね上位数%までをカバーする範囲
  const step = maxX / bucketCount;
  const buckets = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = step * i;
    const hi = step * (i + 1);
    const mid = (lo + hi) / 2 || step / 4;
    const z = (Math.log(mid) - mu) / sigma;
    const density = (1 / (mid * sigma * Math.sqrt(2 * Math.PI))) * Math.exp((-z * z) / 2);
    buckets.push({ label: `${Math.round(lo)}〜${Math.round(hi)}`, value: Math.max(density * step * 100, 0), rangeLo: lo, rangeHi: hi });
  }
  const sum = buckets.reduce((s, b) => s + b.value, 0) || 1;
  buckets.forEach((b) => { b.pct = Math.round((b.value / sum) * 1000) / 10; });
  return buckets;
}

function findBucketIndex(buckets, valueInManYen) {
  for (let i = 0; i < buckets.length; i++) {
    if (valueInManYen >= buckets[i].rangeLo && valueInManYen < buckets[i].rangeHi) return i;
  }
  if (buckets.length > 0 && valueInManYen >= buckets[buckets.length - 1].rangeHi) return buckets.length - 1;
  return -1;
}

const SAMPLE_DISTRIBUTION = [
  { label: "0〜100", pct: 28 }, { label: "100〜200", pct: 19 }, { label: "200〜350", pct: 16 },
  { label: "350〜550", pct: 13 }, { label: "550〜800", pct: 9 }, { label: "800〜1100", pct: 6 },
  { label: "1100〜1500", pct: 4 }, { label: "1500〜2000", pct: 2.5 }, { label: "2000〜2800", pct: 1.5 }, { label: "2800〜", pct: 1 },
];

const SAMPLE_INCOME_DISTRIBUTION = [
  { label: "200〜300", pct: 12 }, { label: "300〜400", pct: 22 }, { label: "400〜500", pct: 20 },
  { label: "500〜600", pct: 15 }, { label: "600〜700", pct: 11, highlight: true }, { label: "700〜800", pct: 8 },
  { label: "800〜900", pct: 5 }, { label: "900〜1000", pct: 3 }, { label: "1000〜1200", pct: 2 }, { label: "1200〜", pct: 1 },
];
const SAMPLE_INCOME_PERCENTILE = 32;


const HOLDING_PRESETS = [
  { name: "eMAXIS Slim 全世界株式（オール・カントリー）", rate: 6.5, category: "投資信託" },
  { name: "eMAXIS Slim 米国株式（S&P500）", rate: 7.0, category: "投資信託" },
  { name: "eMAXIS Slim 先進国株式インデックス", rate: 6.0, category: "投資信託" },
  { name: "楽天・全世界株式インデックス・ファンド", rate: 6.5, category: "投資信託" },
  { name: "SBI・V・S&P500インデックス・ファンド", rate: 7.0, category: "投資信託" },
  { name: "金（ゴールド）", rate: 4.0, category: "コモディティ" },
];

const OTHER_ASSET_PRESETS = [
  { name: "ビットコイン（BTC）", rate: 15.0 },
  { name: "イーサリアム（ETH）", rate: 13.0 },
  { name: "リップル（XRP）", rate: 10.0 },
];

const STORAGE_KEY = "mybanker:profile:v6";

export default function MyBanker() {
  const [appPhase, setAppPhase] = useState("onboarding"); // onboarding | dashboard
  const [dashView, setDashView] = useState("overview");
  const [planningFlow, setPlanningFlow] = useState(null); // null | "risk" | "simulator"
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [detailedExpense, setDetailedExpense] = useState(false);
  const [expenses, setExpenses] = useState(DEFAULT_EXPENSES);
  const [riskProfile, setRiskProfile] = useState("balanced");
  const [incomeMode, setIncomeMode] = useState("gross");
  const [bonusHandling, setBonusHandling] = useState("smooth");
  const [bonusInputType, setBonusInputType] = useState("gross"); // net | gross
  const [reviewSpan, setReviewSpan] = useState("monthly");
  const [email, setEmail] = useState("");
  const [assetLogs, setAssetLogs] = useState([]);
  const [assetInput, setAssetInput] = useState({ savings: "" });
  const [otherAssets, setOtherAssets] = useState([]);
  const [incomeLogs, setIncomeLogs] = useState([]);
  const [incomeLogInput, setIncomeLogInput] = useState({ month: String(new Date().getMonth() + 1), gross: "", takehome: "", hasBonus: false, bonus: "" });
  const [holdings, setHoldings] = useState([]); // {id, name, amount, rate, category}
  const [nisaPlanIds, setNisaPlanIds] = useState([]); // 株式投資の積立対象に選んだholdingsのid一覧
  const [otherPlanKeys, setOtherPlanKeys] = useState([]); // その他運用の積立対象に選んだotherAssetsのkey一覧
  const [sideIncomes, setSideIncomes] = useState([]); // 副業 {id, name, amount}
  const [sideIncomeInput, setSideIncomeInput] = useState({ name: "", amount: "" });
  const [showSideIncome, setShowSideIncome] = useState(false);
  const sideIncomeMonthlyTotal = sideIncomes.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const [holdingsLogs, setHoldingsLogs] = useState([]); // {id, date, items, total}
  const [expenseLogs, setExpenseLogs] = useState([]); // {id, month, mode, total, items}
  const [expenseLogInput, setExpenseLogInput] = useState({ month: String(new Date().getMonth() + 1), mode: "simple", total: "" });
  const [expenseLogItems, setExpenseLogItems] = useState([
    { key: "rent", label: "家賃・住居費", amount: "" },
    { key: "food", label: "食費", amount: "" },
    { key: "social", label: "交際費", amount: "" },
  ]);
  const [holdingInput, setHoldingInput] = useState({ name: "", amount: "", rate: "" });
  const [showSuggest, setShowSuggest] = useState(false);
  const [otherHoldingInput, setOtherHoldingInput] = useState({ name: "", amount: "", rate: "" });
  const [showOtherSuggest, setShowOtherSuggest] = useState(false);
  const [isPremium, setIsPremium] = useState(false); // ※実際の決済状態がわかるまでの初期値
  const [myReferralCode, setMyReferralCode] = useState(null);
  const [incomingReferralCode, setIncomingReferralCode] = useState(null);
  const [premiumUntil, setPremiumUntil] = useState(null);
  const [premiumSource, setPremiumSource] = useState(null);
  const [isAnonymousUser, setIsAnonymousUser] = useState(false);

  useEffect(() => {
    const loadProfile = (attempt = 0) => {
      getPremiumProfile()
        .then((p) => {
          const stillValid = p.premium_until ? new Date(p.premium_until) > new Date() : p.is_premium;
          setIsPremium(!!stillValid);
          setMyReferralCode(p.referral_code);
          setPremiumUntil(p.premium_until || null);
          setPremiumSource(stillValid ? p.premium_source : null);
          // referral_codeがまだ生成されていない場合(DBトリガーが遅れているケース)、
          // 1.5秒後・4秒後の2回リトライする
          if (!p.referral_code && attempt < 2) {
            const delays = [1500, 4000];
            setTimeout(() => loadProfile(attempt + 1), delays[attempt]);
          }
        })
        .catch(() => {});
    };
    loadProfile();

    getCurrentUser().then((u) => setIsAnonymousUser(!u?.email));

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref) setIncomingReferralCode(ref);
    }
  }, []);


  const [form, setForm] = useState({
    monthlyIncome: "350000",
    baseSalary: "300000",
    overtimeHours: "10",
    isManager: false,
    fixedCostSimple: "180000",
    bonusAnnual: "600000",
    bonusCount: "2",
    birthDate: "1992-06-15",
  });

  const [alloc, setAlloc] = useState({ savings: "60000", nisa: "80000", other: "0", free: "30000" });
  const [allocTouched, setAllocTouched] = useState(false);
  const [goalAmount, setGoalAmount] = useState("");
  const [planBaseline, setPlanBaseline] = useState(null); // { date, total, monthlyRate } 最初に立てた計画を固定保持
  const [bonusAlloc, setBonusAlloc] = useState({ savings: "30", nisa: "50", other: "0", free: "20" });
  const [nisaSplits, setNisaSplits] = useState({}); // { [holdingId]: amountString }
  const [otherSplits, setOtherSplits] = useState({}); // { [otherHoldingId]: pctString }

  useEffect(() => {
    (async () => {
      try {
        const result = await storage.get(STORAGE_KEY, false);
        if (result && result.value) {
          const d = JSON.parse(result.value);
          if (d.form) setForm(d.form);
          if (d.expenses) setExpenses(d.expenses);
          if (d.detailedExpense !== undefined) setDetailedExpense(d.detailedExpense);
          if (d.riskProfile) setRiskProfile(d.riskProfile);
          if (d.incomeMode) setIncomeMode(d.incomeMode);
          if (d.bonusHandling) setBonusHandling(d.bonusHandling);
          if (d.bonusInputType) setBonusInputType(d.bonusInputType);
          if (d.reviewSpan) setReviewSpan(d.reviewSpan);
          if (d.email) setEmail(d.email);
          if (d.alloc) { setAlloc(d.alloc); setAllocTouched(true); }
          if (d.bonusAlloc) setBonusAlloc(d.bonusAlloc);
          if (d.nisaSplits) setNisaSplits(d.nisaSplits);
          if (d.otherSplits) setOtherSplits(d.otherSplits);
          if (d.assetLogs) {
            const logs = d.assetLogs.map((l, i) => (l.id ? l : { ...l, id: Date.now() + i }));
            setAssetLogs(logs);
            const lastLog = [...logs].sort((a, b) => a.id - b.id)[logs.length - 1];
            if (lastLog) setAssetInput({ savings: lastLog.savings });
          }
          if (d.incomeLogs) setIncomeLogs(d.incomeLogs);
          if (d.holdings) setHoldings(d.holdings);
          if (d.nisaPlanIds) setNisaPlanIds(d.nisaPlanIds);
          if (d.otherPlanKeys) setOtherPlanKeys(d.otherPlanKeys);
          if (d.sideIncomes) setSideIncomes(d.sideIncomes);
          if (d.goalAmount) setGoalAmount(d.goalAmount);
          if (d.planBaseline) setPlanBaseline(d.planBaseline);
          if (d.otherAssets) setOtherAssets(d.otherAssets);
          if (d.holdingsLogs) setHoldingsLogs(d.holdingsLogs);
          if (d.isPremium) setIsPremium(d.isPremium);
          if (d.expenseLogs) setExpenseLogs(d.expenseLogs);
          if (d.appPhase) setAppPhase(d.appPhase);
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const data = { form, expenses, detailedExpense, riskProfile, incomeMode, bonusHandling, bonusInputType, reviewSpan, email, alloc, bonusAlloc, assetLogs, incomeLogs, holdings, appPhase, otherAssets, holdingsLogs, expenseLogs, nisaSplits, isPremium, otherSplits, sideIncomes, goalAmount, planBaseline, nisaPlanIds, otherPlanKeys };
    storage.set(STORAGE_KEY, JSON.stringify(data), false).catch(() => {});
  }, [form, expenses, detailedExpense, riskProfile, incomeMode, bonusHandling, bonusInputType, reviewSpan, email, alloc, bonusAlloc, assetLogs, incomeLogs, holdings, appPhase, otherAssets, holdingsLogs, expenseLogs, nisaSplits, isPremium, otherSplits, sideIncomes, goalAmount, planBaseline, nisaPlanIds, otherPlanKeys, loaded]);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const updateExpense = (key) => (e) => setExpenses(expenses.map((x) => (x.key === key ? { ...x, amount: e.target.value } : x)));
  const addExpenseRow = () => setExpenses([...expenses, { key: "custom-" + Date.now(), label: "", amount: "0", custom: true }]);
  const updateLabel = (key) => (e) => setExpenses(expenses.map((x) => (x.key === key ? { ...x, label: e.target.value } : x)));
  const removeExpense = (key) => setExpenses(expenses.filter((x) => x.key !== key));

  const updateOtherAsset = (key) => (e) => setOtherAssets(otherAssets.map((x) => (x.key === key ? { ...x, amount: e.target.value } : x)));
  const updateOtherAssetLabel = (key) => (e) => setOtherAssets(otherAssets.map((x) => (x.key === key ? { ...x, label: e.target.value } : x)));
  const updateOtherAssetRate = (key) => (e) => setOtherAssets(otherAssets.map((x) => (x.key === key ? { ...x, rate: e.target.value } : x)));
  const addOtherAssetRow = () => setOtherAssets([...otherAssets, { key: "custom-" + Date.now(), label: "", amount: "0", rate: "0", custom: true }]);
  const removeOtherAsset = (key) => setOtherAssets(otherAssets.filter((x) => x.key !== key));
  const addHoldingRow = () => setHoldings([...holdings, { id: Date.now(), name: "", amount: "0", rate: "0" }]);
  const updateHoldingField = (id, field) => (e) => setHoldings(holdings.map((h) => h.id === id ? { ...h, [field]: e.target.value } : h));
  const removeHoldingRow = (id) => setHoldings(holdings.filter((h) => h.id !== id));
  const otherAssetsTotal = otherAssets.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const totalExpense = useMemo(
    () => (detailedExpense ? expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0) : Number(form.fixedCostSimple) || 0),
    [detailedExpense, expenses, form.fixedCostSimple]
  );

  const monthlyGrossComputed = useMemo(() => {
    if (incomeMode === "takehome") {
      const net = Number(form.monthlyIncome) || 0;
      // 手取りから額面を逆算（1回目は0.78で仮置きし、その年収帯のレートで再計算）
      let guessGross = net / 0.78;
      const ratio = getTakeHomeRatio((guessGross * 12) / 10000);
      return Math.round(net / ratio);
    }
    const base = Number(form.baseSalary) || 0;
    const hours = form.isManager ? 0 : Number(form.overtimeHours) || 0;
    const hourlyRate = (base / 160) * 1.25;
    return Math.round(base + hourlyRate * hours);
  }, [incomeMode, form]);

  const bonusAnnualInputRaw = Number(form.bonusAnnual) || 0;

  const takeHomeRatio = useMemo(() => {
    // ボーナスを含めた年収帯で手取り率を判定する（額面ボーナスはそのまま、手取りボーナスは仮の率で額面換算してから合算）
    const provisionalRatio = getTakeHomeRatio((monthlyGrossComputed * 12) / 10000);
    const bonusGrossApprox = bonusInputType === "gross" ? bonusAnnualInputRaw : bonusAnnualInputRaw / provisionalRatio;
    const totalAnnualGrossApprox = monthlyGrossComputed * 12 + bonusGrossApprox;
    return getTakeHomeRatio(totalAnnualGrossApprox / 10000);
  }, [monthlyGrossComputed, bonusAnnualInputRaw, bonusInputType]);

  const monthlyIncomeComputed = useMemo(() => {
    if (incomeMode === "takehome") return Number(form.monthlyIncome) || 0;
    return Math.round((monthlyGrossComputed || 0) * takeHomeRatio);
  }, [incomeMode, form, monthlyGrossComputed, takeHomeRatio]);

  const bonusAnnualNet = bonusInputType === "gross" ? Math.round(bonusAnnualInputRaw * takeHomeRatio) : bonusAnnualInputRaw;
  const bonusAnnualGross = bonusInputType === "gross" ? bonusAnnualInputRaw : Math.round(bonusAnnualInputRaw / takeHomeRatio);

  const annualIncomeEstimateNet = monthlyIncomeComputed * 12 + bonusAnnualNet + sideIncomeMonthlyTotal * 12;
  const annualIncomeEstimateGross = monthlyGrossComputed * 12 + bonusAnnualGross + sideIncomeMonthlyTotal * 12;

  const monthlyFree = useMemo(() => {
    if (bonusHandling === "smooth") {
      return Math.max((annualIncomeEstimateNet - totalExpense * 12) / 12, 0);
    }
    return Math.max(monthlyIncomeComputed + sideIncomeMonthlyTotal - totalExpense, 0);
  }, [bonusHandling, annualIncomeEstimateNet, totalExpense, monthlyIncomeComputed, sideIncomeMonthlyTotal]);

  const insuranceExpense = useMemo(() => {
    if (!detailedExpense) return 0;
    const row = expenses.find((x) => x.key === "insurance");
    return row ? Number(row.amount) || 0 : 0;
  }, [detailedExpense, expenses]);
  const insuranceRatio = monthlyIncomeComputed > 0 ? insuranceExpense / monthlyIncomeComputed : 0;

  useEffect(() => {
    if (!allocTouched && loaded) {
      const r = RISK_PROFILES[riskProfile].defaultRatios;
      const savingsPct = Math.round(r.savings * 100);
      const nisaPct = Math.round(r.nisa * 100);
      const freePct = Math.max(100 - savingsPct - nisaPct, 0);
      setAlloc({ savings: String(savingsPct), nisa: String(nisaPct), other: "0", free: String(freePct) });
    }
  }, [monthlyFree, riskProfile, loaded]); // eslint-disable-line

  const allocPctTotal = (Number(alloc.savings) || 0) + (Number(alloc.nisa) || 0) + (Number(alloc.other) || 0) + (Number(alloc.free) || 0);
  const allocOver = allocPctTotal > 100.5;
  const allocUnder = allocPctTotal < 99.5;
  const allocTotal = allocPctTotal; // 後方互換のため%合計をそのまま使う

  const allocNums = {
    savings: monthlyFree * ((Number(alloc.savings) || 0) / 100),
    nisa: monthlyFree * ((Number(alloc.nisa) || 0) / 100),
    other: monthlyFree * ((Number(alloc.other) || 0) / 100),
    free: monthlyFree * ((Number(alloc.free) || 0) / 100),
  };

  const bonusAllocNums = useMemo(() => {
    const p = (k) => (Number(bonusAlloc[k]) || 0) / 100;
    return { savings: bonusAnnualNet * p("savings"), nisa: bonusAnnualNet * p("nisa"), other: bonusAnnualNet * p("other"), free: bonusAnnualNet * p("free") };
  }, [bonusAlloc, bonusAnnualNet]);
  const bonusPctTotal = (Number(bonusAlloc.savings) || 0) + (Number(bonusAlloc.nisa) || 0) + (Number(bonusAlloc.other) || 0) + (Number(bonusAlloc.free) || 0);

  const profile = RISK_PROFILES[riskProfile];
  const baselineSavings = useMemo(() => {
    if (assetLogs.length === 0) return 0;
    const sorted = [...assetLogs].sort((a, b) => (a.id || 0) - (b.id || 0));
    return Number(sorted[sorted.length - 1].savings) || 0;
  }, [assetLogs]);
  const baselineStocks = useMemo(() => (assetLogs[0] ? Number(assetLogs[0].stocks) || 0 : 0), [assetLogs]);

  // nisaSplitsは「株式投資の金額のうち何%をこの銘柄に割り当てるか」を保持する
  const nisaSplitPctTotal = useMemo(
    () => nisaPlanIds.reduce((s, id) => s + (Number(nisaSplits[id]) || 0), 0),
    [nisaPlanIds, nisaSplits]
  );
  const nisaSplitOver = nisaSplitPctTotal > 100.5;
  const nisaUnassignedPct = Math.max(100 - nisaSplitPctTotal, 0);
  const nisaUnassignedAmount = allocNums.nisa * (nisaUnassignedPct / 100);
  const nisaSplitTotal = allocNums.nisa * (Math.min(nisaSplitPctTotal, 100) / 100); // 円換算（表示用）

  // otherSplitsは「その他運用の金額のうち何%をこの項目に割り当てるか」を保持する（otherAssetsのkeyで管理）
  const otherSplitPctTotal = useMemo(
    () => otherPlanKeys.reduce((s, key) => s + (Number(otherSplits[key]) || 0), 0),
    [otherPlanKeys, otherSplits]
  );
  const otherSplitOver = otherSplitPctTotal > 100.5;
  const otherUnassignedPct = Math.max(100 - otherSplitPctTotal, 0);
  const otherUnassignedAmount = allocNums.other * (otherUnassignedPct / 100);
  const otherSplitTotal = allocNums.other * (Math.min(otherSplitPctTotal, 100) / 100);

  const projection = useMemo(() => {
    const years = [1, 3, 5, 10, 15, 20, 25, 30];
    let savings = baselineSavings;
    let unassignedBal = 0;
    let otherUnassignedBal = 0;
    const unassignedRate = profile.rate / 12;
    const unassignedMonthly = nisaUnassignedAmount;
    const otherUnassignedMonthly = otherUnassignedAmount;

    // 銘柄ごとの残高（保有資産の保有額からスタートし、各銘柄自身の年率で計算。積立対象でなくても保有分はそのまま成長する）
    const holdingBalances = {};
    holdings.forEach((h) => { holdingBalances[h.id] = Number(h.amount) || 0; });
    const otherBalances = {};
    otherAssets.forEach((x) => { otherBalances[x.key] = Number(x.amount) || 0; });

    const data = [];
    const snapshot = (label, yearsElapsed) => {
      const point = { year: label, 貯金: Math.round(savings) };
      holdings.forEach((h) => { point[h.name] = Math.round(holdingBalances[h.id] || 0); });
      otherAssets.forEach((x) => { if (x.label) point[x.label] = Math.round(otherBalances[x.key] || 0); });
      if (unassignedMonthly > 0) point["新規投資（未割り当て）"] = Math.round(unassignedBal);
      if (otherUnassignedMonthly > 0) point["その他運用（未割り当て）"] = Math.round(otherUnassignedBal);
      return point;
    };
    data.push(snapshot("現在", 0));

    for (let y = 1; y <= 30; y++) {
      for (let m = 0; m < 12; m++) {
        savings += allocNums.savings;

        holdings.forEach((h) => {
          const hRate = (Number(h.rate) || 0) / 100 / 12;
          const monthlyAdd = nisaPlanIds.includes(h.id) ? allocNums.nisa * ((Number(nisaSplits[h.id]) || 0) / 100) : 0;
          holdingBalances[h.id] = (holdingBalances[h.id] || 0) * (1 + hRate) + monthlyAdd;
        });

        otherAssets.forEach((x) => {
          const xRate = (Number(x.rate) || 0) / 100 / 12;
          const monthlyAdd = otherPlanKeys.includes(x.key) ? allocNums.other * ((Number(otherSplits[x.key]) || 0) / 100) : 0;
          otherBalances[x.key] = (otherBalances[x.key] || 0) * (1 + xRate) + monthlyAdd;
        });

        unassignedBal = unassignedBal * (1 + unassignedRate) + unassignedMonthly;
        otherUnassignedBal = otherUnassignedBal * (1 + unassignedRate) + otherUnassignedMonthly;
      }
      if (bonusHandling === "lump") {
        savings += bonusAllocNums.savings;
        otherUnassignedBal += bonusAllocNums.other;
        unassignedBal += bonusAllocNums.nisa;
      }
      if (years.includes(y)) data.push(snapshot(`${y}年後`, y));
    }
    return data;
  }, [allocNums, baselineSavings, holdings, otherAssets, profile, bonusHandling, bonusAllocNums, nisaSplits, otherSplits, nisaPlanIds, otherPlanKeys, nisaUnassignedAmount, otherUnassignedAmount]);

  // 目標金額まで何ヶ月かかるかを、同じ前提（積立・利率）で月次シミュレーションして求める
  const monthsToGoal = useMemo(() => {
    const goal = Number(goalAmount) || 0;
    if (goal <= 0) return null;
    let savings = baselineSavings;
    let unassignedBal = 0;
    let otherUnassignedBal = 0;
    const unassignedRate = profile.rate / 12;
    const holdingBalances = {};
    holdings.forEach((h) => { holdingBalances[h.id] = Number(h.amount) || 0; });
    const otherBalances = {};
    otherAssets.forEach((x) => { otherBalances[x.key] = Number(x.amount) || 0; });

    const currentTotal = () => {
      let t = savings + unassignedBal + otherUnassignedBal;
      holdings.forEach((h) => { t += holdingBalances[h.id] || 0; });
      otherAssets.forEach((x) => { t += otherBalances[x.key] || 0; });
      return t;
    };

    if (currentTotal() >= goal) return 0;

    const maxMonths = 600; // 50年でキャップ
    for (let m = 1; m <= maxMonths; m++) {
      savings += allocNums.savings;
      holdings.forEach((h) => {
        const hRate = (Number(h.rate) || 0) / 100 / 12;
        const monthlyAdd = nisaPlanIds.includes(h.id) ? allocNums.nisa * ((Number(nisaSplits[h.id]) || 0) / 100) : 0;
        holdingBalances[h.id] = (holdingBalances[h.id] || 0) * (1 + hRate) + monthlyAdd;
      });
      otherAssets.forEach((x) => {
        const xRate = (Number(x.rate) || 0) / 100 / 12;
        const monthlyAdd = otherPlanKeys.includes(x.key) ? allocNums.other * ((Number(otherSplits[x.key]) || 0) / 100) : 0;
        otherBalances[x.key] = (otherBalances[x.key] || 0) * (1 + xRate) + monthlyAdd;
      });
      unassignedBal = unassignedBal * (1 + unassignedRate) + nisaUnassignedAmount;
      otherUnassignedBal = otherUnassignedBal * (1 + unassignedRate) + otherUnassignedAmount;
      if (currentTotal() >= goal) return m;
    }
    return null; // 50年以内に到達しない見込み
  }, [goalAmount, baselineSavings, holdings, otherAssets, allocNums, nisaSplits, otherSplits, nisaPlanIds, otherPlanKeys, nisaUnassignedAmount, otherUnassignedAmount]);

  const projectionSeriesKeys = useMemo(() => {
    const keys = holdings.map((h) => h.name);
    if (nisaUnassignedAmount > 0) keys.push("新規投資（未割り当て）");
    otherAssets.forEach((x) => { if (x.label) keys.push(x.label); });
    if (otherUnassignedAmount > 0) keys.push("その他運用（未割り当て）");
    return keys;
  }, [holdings, nisaUnassignedAmount, otherAssets, otherUnassignedAmount]);

  const SERIES_COLORS = ["#3D5A99", "#B5582E", "#9A4A8C", "#5C8A99", "#C9A227", "#6B4F9A", "#4F8FA8", "#A8527A"];

  const furusatoApprox = useMemo(() => Math.round((annualIncomeEstimateGross * 0.022) / 1000) * 1000, [annualIncomeEstimateGross]);

  const addAssetLog = () => {
    const stocksFromHoldings = holdings.reduce((s, h) => s + (Number(h.amount) || 0), 0);
    const total = (Number(assetInput.savings) || 0) + stocksFromHoldings + otherAssetsTotal;
    const todayKey = new Date().toLocaleDateString("ja-JP");
    const existingIdx = assetLogs.findIndex((l) => l.date === todayKey);
    const entry = {
      id: existingIdx >= 0 ? assetLogs[existingIdx].id : Date.now(),
      date: todayKey, savings: assetInput.savings, stocks: String(stocksFromHoldings),
      other: String(otherAssetsTotal), otherItems: otherAssets.map((x) => ({ label: x.label, amount: x.amount })),
      holdingItems: holdings.map((h) => ({ name: h.name, amount: h.amount, rate: h.rate })),
      total,
    };
    if (existingIdx >= 0) {
      const next = [...assetLogs];
      next[existingIdx] = entry;
      setAssetLogs(next);
    } else {
      setAssetLogs([...assetLogs, entry]);
    }
    setAssetInput({ savings: assetInput.savings });
  };

  // 実質支出は保存時に固定せず、毎回その場で計算する（計算式を後で改善しても、古い記録に正しく反映されるように）
  const impliedSpendingInfo = useMemo(() => {
    const sorted = [...assetLogs].sort((a, b) => (a.id || 0) - (b.id || 0));
    if (sorted.length < 2) return null;
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const prevDate = prev.date ? new Date(prev.date.replace(/\//g, "-")) : null;
    const lastDate = last.date ? new Date(last.date.replace(/\//g, "-")) : null;
    const daysElapsed = prevDate && lastDate && !isNaN(prevDate.getTime()) && !isNaN(lastDate.getTime())
      ? Math.max(1, Math.round((lastDate - prevDate) / 86400000)) : 30;
    const proratedIncome = Math.round(monthlyIncomeComputed * (daysElapsed / 30));
    const cashChange = (Number(last.savings) || 0) - (Number(prev.savings) || 0);
    const plannedMonthlyInvestment = (allocNums.nisa || 0) + (allocNums.other || 0);
    const proratedInvestment = Math.round(plannedMonthlyInvestment * (daysElapsed / 30));
    const impliedSpending = Math.round(proratedIncome - cashChange - proratedInvestment);
    return { daysElapsed, proratedIncome, cashChange, proratedInvestment, impliedSpending, prevDate: prev.date, lastDate: last.date, hasPlan: allocTouched };
  }, [assetLogs, monthlyIncomeComputed, allocNums, allocTouched]);


  const updateAssetLog = (id, field, value) => {
    setAssetLogs(assetLogs.map((l) => {
      if (l.id !== id) return l;
      const updated = { ...l, [field]: value };
      updated.total = (Number(updated.savings) || 0) + (Number(updated.stocks) || 0) + (Number(updated.other) || 0);
      return updated;
    }));
  };

  const updateAssetLogItemAmount = (logId, arrKey, idx, value) => {
    setAssetLogs(assetLogs.map((l) => {
      if (l.id !== logId) return l;
      const arr = [...(l[arrKey] || [])];
      arr[idx] = { ...arr[idx], amount: value };
      const sum = arr.reduce((s, it) => s + (Number(it.amount) || 0), 0);
      const updated = { ...l, [arrKey]: arr };
      if (arrKey === "holdingItems") updated.stocks = String(sum);
      if (arrKey === "otherItems") updated.other = String(sum);
      updated.total = (Number(updated.savings) || 0) + (Number(updated.stocks) || 0) + (Number(updated.other) || 0);
      return updated;
    }));
  };

  const deleteAssetLog = (id) => setAssetLogs(assetLogs.filter((l) => l.id !== id));

  const finishOnboarding = () => {
    setAppPhase("dashboard");
    setDashView("overview");
  };

  const sortedAssetLogs = [...assetLogs].sort((a, b) => (a.id || 0) - (b.id || 0));

  // 「計画上の想定」は、最初に立てた時点の総資産・配分ペースで固定する（後で配分を変えても動かない）
  useEffect(() => {
    if (!planBaseline && sortedAssetLogs.length > 0) {
      setPlanBaseline({
        date: sortedAssetLogs[0].date,
        total: sortedAssetLogs[0].total,
        monthlyRate: allocNums.savings + allocNums.nisa + allocNums.other,
      });
    }
  }, [sortedAssetLogs.length]); // eslint-disable-line

  const resetPlanBaseline = () => {
    const latest = sortedAssetLogs[sortedAssetLogs.length - 1];
    if (!latest) return;
    setPlanBaseline({ date: latest.date, total: latest.total, monthlyRate: allocNums.savings + allocNums.nisa + allocNums.other });
  };

  const goalCompareData = planBaseline ? sortedAssetLogs
    .filter((l) => new Date(l.date.replace(/\//g, "-")) >= new Date(planBaseline.date.replace(/\//g, "-")))
    .map((l, i) => ({
      label: l.date,
      実際の資産: l.total,
      計画上の想定: Math.round(planBaseline.total + planBaseline.monthlyRate * i),
    })) : [];

  const resetAllocToDefault = () => {
    const r = RISK_PROFILES[riskProfile].defaultRatios;
    const savingsPct = Math.round(r.savings * 100);
    const nisaPct = Math.round(r.nisa * 100);
    const freePct = Math.max(100 - savingsPct - nisaPct, 0);
    setAlloc({ savings: String(savingsPct), nisa: String(nisaPct), other: "0", free: String(freePct) });
  };

  const incomeProjection = useMemo(() => {
    const monthsLogged = incomeLogs.length;
    const sumTakehome = incomeLogs.reduce((s, l) => s + (Number(l.takehome) || 0), 0);
    const sumGross = incomeLogs.reduce((s, l) => s + (Number(l.gross) || 0), 0);
    const sumBonus = incomeLogs.reduce((s, l) => s + (Number(l.bonus) || 0), 0);
    const avgTakehome = monthsLogged > 0 ? sumTakehome / monthsLogged : monthlyIncomeComputed;
    const avgGross = monthsLogged > 0 ? sumGross / monthsLogged : (monthlyGrossComputed || monthlyIncomeComputed);
    const remainingMonths = Math.max(12 - monthsLogged, 0);
    return {
      monthsLogged, sumTakehome, sumGross, sumBonus,
      avgTakehome, avgGross,
      projectedTakehome: sumTakehome + avgTakehome * remainingMonths,
      projectedGross: sumGross + avgGross * remainingMonths,
    };
  }, [incomeLogs, monthlyIncomeComputed, monthlyGrossComputed]);

  const addIncomeLog = () => {
    const entry = {
      month: incomeLogInput.month,
      gross: incomeLogInput.gross,
      takehome: incomeLogInput.takehome,
      bonus: incomeLogInput.hasBonus ? incomeLogInput.bonus : "0",
    };
    const existingIdx = incomeLogs.findIndex((l) => l.month === entry.month);
    if (existingIdx >= 0) {
      const next = [...incomeLogs];
      next[existingIdx] = entry;
      setIncomeLogs(next);
    } else {
      setIncomeLogs([...incomeLogs, entry].sort((a, b) => Number(a.month) - Number(b.month)));
    }
    setIncomeLogInput({ ...incomeLogInput, gross: "", takehome: "", hasBonus: false, bonus: "" });
  };

  const totalHoldingsValue = holdings.reduce((s, h) => s + (Number(h.amount) || 0), 0);
  const lastLog = assetLogs[assetLogs.length - 1];
  const totalNetWorth = lastLog
    ? (Number(lastLog.savings) || 0) + (Number(lastLog.other) || 0) + totalHoldingsValue
    : baselineSavings + totalHoldingsValue;

  const userAge = useMemo(() => {
    const bd = form.birthDate ? new Date(form.birthDate) : null;
    if (!bd || isNaN(bd.getTime())) return 0;
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    const hasHadBirthdayThisYear = today.getMonth() > bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() >= bd.getDate());
    if (!hasHadBirthdayThisYear) age -= 1;
    return Math.max(age, 0);
  }, [form.birthDate]);
  const ageDecade = getAgeDecade(userAge);
  const ageStats = AGE_STATS[ageDecade]; // 支出・貯蓄率は10年刻みのデータを使用
  const age5Stats = getAge5Stats(userAge); // 資産パーセンタイルは5歳刻みのデータを使用
  const age5Key = getAge5Key(userAge);
  const assetPercentile = useMemo(
    () => estimatePercentile(totalNetWorth / 10000, age5Stats.mean, age5Stats.median),
    [totalNetWorth, age5Stats]
  );
  const peerMonthlyExpense = ageStats.monthlyExpense * 10000;
  const expenseDiffVsPeer = totalExpense - peerMonthlyExpense;
  const expenseDiffPct = peerMonthlyExpense > 0 ? Math.round((expenseDiffVsPeer / peerMonthlyExpense) * 100) : 0;

  const assetDistribution = useMemo(() => generateDistributionCurve(age5Stats.mean, age5Stats.median), [age5Stats]);

  const incomeStats = INCOME_STATS[ageDecade];
  const incomePercentile = useMemo(
    () => estimatePercentile(annualIncomeEstimateGross / 10000, incomeStats.mean, incomeStats.median),
    [annualIncomeEstimateGross, incomeStats]
  );
  const incomeDistribution = useMemo(() => generateDistributionCurve(incomeStats.mean, incomeStats.median), [incomeStats]);

  const expenseCategoryComparison = useMemo(() => {
    return Object.entries(EXPENSE_CATEGORY_SHARE).map(([label, share]) => {
      const peerAmount = peerMonthlyExpense * share;
      const userAmount = totalExpense * share; // 簡易的に同じ比率配分で概算（自分の費目別記録があれば本来はそちらを優先すべき）
      return { label, peerAmount, userAmount, diffPct: peerAmount > 0 ? Math.round(((userAmount - peerAmount) / peerAmount) * 100) : 0 };
    });
  }, [peerMonthlyExpense, totalExpense]);

  const savingsRatePeer = SAVINGS_RATE_STATS[ageDecade];
  const savingsRateUser = annualIncomeEstimateNet > 0 ? Math.round(((allocNums.savings + allocNums.nisa + allocNums.other) * 12 / annualIncomeEstimateNet) * 1000) / 10 : 0;
  const savingsRateDiff = Math.round((savingsRateUser - savingsRatePeer) * 10) / 10;

  const growthRateInfo = useMemo(() => {
    const sorted = [...assetLogs].sort((a, b) => (a.id || 0) - (b.id || 0));
    if (sorted.length < 2) return null;
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first.total || first.total <= 0) return null;
    const growthPct = Math.round(((last.total - first.total) / first.total) * 1000) / 10;
    const benchmark = 5; // 一般的な資産形成ペースの目安（年率5%程度を想定した簡易ベンチマーク）
    return { growthPct, benchmark, aboveBenchmark: growthPct >= benchmark };
  }, [assetLogs]);

  // 同収入との比較（年収帯が同じ人との比較。総資産・支出・貯蓄率）
  const incomeBracket = useMemo(() => getIncomeBracket(annualIncomeEstimateGross / 10000), [annualIncomeEstimateGross]);
  const incomeBracketAssetPercentile = useMemo(
    () => estimatePercentile(totalNetWorth / 10000, incomeBracket.assetMean, incomeBracket.assetMedian),
    [totalNetWorth, incomeBracket]
  );
  const incomeBracketAssetDistribution = useMemo(() => generateDistributionCurve(incomeBracket.assetMean, incomeBracket.assetMedian), [incomeBracket]);
  const incomeBracketPeerMonthlyExpense = incomeBracket.monthlyExpense * 10000;
  const incomeBracketExpenseDiff = totalExpense - incomeBracketPeerMonthlyExpense;
  const incomeBracketExpenseDiffPct = incomeBracketPeerMonthlyExpense > 0 ? Math.round((incomeBracketExpenseDiff / incomeBracketPeerMonthlyExpense) * 100) : 0;
  const incomeBracketSavingsRateDiff = Math.round((savingsRateUser - incomeBracket.savingsRate) * 10) / 10;

  // 東証プライム上場企業社員との比較（総資産・年収・支出・貯蓄率）。年代別の係数で調整した推定値。
  const primeStatsForAge = useMemo(() => getPrimeStatsForAge(ageDecade), [ageDecade]);
  const primeAssetPercentile = useMemo(
    () => estimatePercentile(totalNetWorth / 10000, primeStatsForAge.assetMean, primeStatsForAge.assetMedian),
    [totalNetWorth, primeStatsForAge]
  );
  const primeAssetDistribution = useMemo(() => generateDistributionCurve(primeStatsForAge.assetMean, primeStatsForAge.assetMedian), [primeStatsForAge]);
  const primeIncomePercentile = useMemo(
    () => estimatePercentile(annualIncomeEstimateGross / 10000, primeStatsForAge.incomeMean, primeStatsForAge.incomeMedian),
    [annualIncomeEstimateGross, primeStatsForAge]
  );
  const primeIncomeDistribution = useMemo(() => generateDistributionCurve(primeStatsForAge.incomeMean, primeStatsForAge.incomeMedian), [primeStatsForAge]);
  const primePeerMonthlyExpense = primeStatsForAge.monthlyExpense * 10000;
  const primeExpenseDiff = totalExpense - primePeerMonthlyExpense;
  const primeExpenseDiffPct = primePeerMonthlyExpense > 0 ? Math.round((primeExpenseDiff / primePeerMonthlyExpense) * 100) : 0;
  const primeSavingsRateDiff = Math.round((savingsRateUser - primeStatsForAge.savingsRate) * 10) / 10;

  const addHolding = () => {
    if (!holdingInput.name || !holdingInput.amount) return;
    setHoldings([...holdings, { id: Date.now(), name: holdingInput.name, amount: Number(holdingInput.amount) || 0, rate: Number(holdingInput.rate) || 0 }]);
    setHoldingInput({ name: "", amount: "", rate: "" });
  };
  const removeHolding = (id) => setHoldings(holdings.filter((h) => h.id !== id));
  const pickPreset = (p) => {
    setHoldingInput({ name: p.name, amount: holdingInput.amount, rate: String(p.rate) });
    setShowSuggest(false);
  };

  // 「積立対象」に既存の保有銘柄を選ぶ（保有資産自体は変更しない）
  const addHoldingToPlan = (id) => { if (!nisaPlanIds.includes(id)) setNisaPlanIds([...nisaPlanIds, id]); };
  // 積立対象から外す（保有資産からは削除しない）
  const removeHoldingFromPlan = (id) => {
    setNisaPlanIds(nisaPlanIds.filter((x) => x !== id));
    const next = { ...nisaSplits }; delete next[id]; setNisaSplits(next);
  };
  // まだ持っていない銘柄を、新規に保有資産へ登録した上で積立対象に追加する
  const addNewHoldingToPlan = (name, rate) => {
    if (!name) return;
    const id = Date.now();
    setHoldings([...holdings, { id, name, amount: 0, rate: Number(rate) || 0 }]);
    setNisaPlanIds([...nisaPlanIds, id]);
  };

  const addOtherAssetToPlan = (key) => { if (!otherPlanKeys.includes(key)) setOtherPlanKeys([...otherPlanKeys, key]); };
  const removeOtherAssetFromPlan = (key) => {
    setOtherPlanKeys(otherPlanKeys.filter((x) => x !== key));
    const next = { ...otherSplits }; delete next[key]; setOtherSplits(next);
  };
  const addNewOtherAssetToPlan = (name, rate) => {
    if (!name) return;
    const key = "custom-" + Date.now();
    setOtherAssets([...otherAssets, { key, label: name, amount: "0", rate: String(Number(rate) || 0), custom: true }]);
    setOtherPlanKeys([...otherPlanKeys, key]);
  };

  const addSideIncome = () => {
    if (!sideIncomeInput.amount) return;
    setSideIncomes([...sideIncomes, { id: Date.now(), name: sideIncomeInput.name || "副業", amount: Number(sideIncomeInput.amount) || 0 }]);
    setSideIncomeInput({ name: "", amount: "" });
  };
  const removeSideIncome = (id) => setSideIncomes(sideIncomes.filter((s) => s.id !== id));

  const saveHoldingsSnapshot = () => {
    const todayKey = new Date().toLocaleDateString("ja-JP");
    const existingIdx = holdingsLogs.findIndex((l) => l.date === todayKey);
    const entry = { id: existingIdx >= 0 ? holdingsLogs[existingIdx].id : Date.now(), date: todayKey, items: holdings.map((h) => ({ ...h })), total: totalHoldingsValue };
    if (existingIdx >= 0) {
      const next = [...holdingsLogs];
      next[existingIdx] = entry;
      setHoldingsLogs(next);
    } else {
      setHoldingsLogs([...holdingsLogs, entry]);
    }
  };
  const updateHoldingsLogItem = (logId, itemId, field, value) => {
    setHoldingsLogs(holdingsLogs.map((l) => {
      if (l.id !== logId) return l;
      const items = l.items.map((it) => (it.id === itemId ? { ...it, [field]: value } : it));
      return { ...l, items, total: items.reduce((s, it) => s + (Number(it.amount) || 0), 0) };
    }));
  };
  const deleteHoldingsLog = (logId) => setHoldingsLogs(holdingsLogs.filter((l) => l.id !== logId));

  const expenseItemsTotal = expenseLogItems.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const addExpenseLog = () => {
    const total = expenseLogInput.mode === "simple" ? Number(expenseLogInput.total) || 0 : expenseItemsTotal;
    const entry = {
      month: expenseLogInput.month, mode: expenseLogInput.mode, total,
      items: expenseLogInput.mode === "items" ? expenseLogItems.map((x) => ({ ...x })) : [],
    };
    const existingIdx = expenseLogs.findIndex((l) => l.month === entry.month);
    if (existingIdx >= 0) {
      const next = [...expenseLogs];
      next[existingIdx] = entry;
      setExpenseLogs(next);
    } else {
      setExpenseLogs([...expenseLogs, entry].sort((a, b) => Number(a.month) - Number(b.month)));
    }
    setExpenseLogInput({ ...expenseLogInput, total: "" });
  };
  const expenseProjection = useMemo(() => {
    const monthsLogged = expenseLogs.length;
    const sumTotal = expenseLogs.reduce((s, l) => s + (Number(l.total) || 0), 0);
    const avg = monthsLogged > 0 ? sumTotal / monthsLogged : totalExpense;
    return { monthsLogged, sumTotal, avg, projectedAnnual: sumTotal + avg * Math.max(12 - monthsLogged, 0) };
  }, [expenseLogs, totalExpense]);

  const sharedProps = {
    form, update, incomeMode, setIncomeMode, monthlyIncomeComputed, monthlyGrossComputed, takeHomeRatio,
    bonusHandling, setBonusHandling, bonusInputType, setBonusInputType,
    sideIncomes, setSideIncomes, sideIncomeMonthlyTotal, removeSideIncome,
    detailedExpense, setDetailedExpense, expenses, updateExpense, updateLabel, addExpenseRow, removeExpense, totalExpense, insuranceRatio,
    riskProfile, setRiskProfile,
    monthlyFree, alloc, setAlloc, allocTouched, setAllocTouched, allocNums, allocTotal, allocOver, allocUnder,
    bonusAlloc, setBonusAlloc, bonusAllocNums, bonusPctTotal, bonusAnnualNet,
    projection, furusatoApprox, annualIncomeEstimateNet, annualIncomeEstimateGross, resetAllocToDefault,
    nisaSplits, setNisaSplits, nisaSplitTotal, nisaSplitPctTotal, nisaUnassignedAmount, nisaSplitOver, projectionSeriesKeys, SERIES_COLORS,
    otherHoldingInput, setOtherHoldingInput, nisaPlanIds, setNisaPlanIds, addHoldingToPlan, removeHoldingFromPlan, addNewHoldingToPlan,
    otherPlanKeys, setOtherPlanKeys, addOtherAssetToPlan, removeOtherAssetFromPlan, addNewOtherAssetToPlan,
    otherSplits, setOtherSplits, otherSplitTotal, otherSplitPctTotal, otherUnassignedAmount, otherSplitOver,
    reviewSpan, setReviewSpan, email, setEmail,
    assetInput, setAssetInput, addAssetLog, assetLogs, updateAssetLog, updateAssetLogItemAmount, deleteAssetLog, goalCompareData, impliedSpendingInfo,
    incomeLogInput, setIncomeLogInput, addIncomeLog, incomeLogs, incomeProjection,
    holdings, setHoldings, addHoldingRow, updateHoldingField, removeHoldingRow, holdingInput, setHoldingInput, addHolding, removeHolding, showSuggest, setShowSuggest, pickPreset, totalHoldingsValue,
    otherAssets, updateOtherAsset, updateOtherAssetLabel, updateOtherAssetRate, addOtherAssetRow, removeOtherAsset, otherAssetsTotal,
    holdingsLogs, saveHoldingsSnapshot, updateHoldingsLogItem, deleteHoldingsLog,
    userAge, ageDecade, age5Label: age5Stats.label, assetPercentile, peerMonthlyExpense, expenseDiffVsPeer, expenseDiffPct,
    planningFlow, setPlanningFlow,
    assetDistribution, incomePercentile, incomeDistribution, expenseCategoryComparison,
    savingsRatePeer, savingsRateUser, savingsRateDiff, growthRateInfo, isPremium, setIsPremium,
    myReferralCode, incomingReferralCode, premiumUntil, isAnonymousUser, premiumSource, goalAmount, setGoalAmount, monthsToGoal, resetPlanBaseline,
    incomeBracket, incomeBracketAssetPercentile, incomeBracketAssetDistribution,
    incomeBracketPeerMonthlyExpense, incomeBracketExpenseDiff, incomeBracketExpenseDiffPct, incomeBracketSavingsRateDiff,
    primeAssetPercentile, primeAssetDistribution, primeIncomePercentile, primeIncomeDistribution,
    primePeerMonthlyExpense, primeExpenseDiff, primeExpenseDiffPct, primeSavingsRateDiff, primeStatsForAge,
    expenseLogs, expenseLogInput, setExpenseLogInput, expenseLogItems, setExpenseLogItems, addExpenseLog, expenseProjection,
    totalNetWorth,
  };

  if (appPhase === "dashboard") {
    return <Dashboard dashView={dashView} setDashView={setDashView} {...sharedProps} />;
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {step === 0 || step === -1 ? (
          <div style={styles.header}><div style={styles.brand}><LogoIcon /> MyBanker</div></div>
        ) : (
          <Header step={step} setStep={setStep} />
        )}
        {step === 0 && <Intro onNext={() => setStep(1)} onLogin={() => setStep(-1)} />}
        {step === -1 && <LoginOnly onDone={() => window.location.reload()} onBack={() => setStep(0)} />}
        {step === 1 && <IncomeStep {...sharedProps} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <ExpenseStep {...sharedProps} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && (
          <AssetBaseline assetInput={assetInput} setAssetInput={setAssetInput}
            holdings={holdings} setHoldings={setHoldings} addHoldingRow={addHoldingRow} updateHoldingField={updateHoldingField}
            removeHoldingRow={removeHoldingRow}
            totalHoldingsValue={holdings.reduce((s, h) => s + (Number(h.amount) || 0), 0)}
            otherAssets={otherAssets} updateOtherAsset={updateOtherAsset} updateOtherAssetLabel={updateOtherAssetLabel} updateOtherAssetRate={updateOtherAssetRate}
            addOtherAssetRow={addOtherAssetRow} removeOtherAsset={removeOtherAsset} otherAssetsTotal={otherAssetsTotal}
            onNext={() => { if (assetLogs.length === 0) addAssetLog(); setStep(4); }} onBack={() => setStep(2)} />
        )}
        {step === 4 && <OnboardingRegisterStep onDone={finishOnboarding} onSkip={finishOnboarding} incomingReferralCode={incomingReferralCode} />}
      </div>
    </div>
  );
}

function Header({ step, setStep }) {
  const labels = ["はじめに", "収入", "支出", "現在の資産"];
  return (
    <div style={styles.header}>
      <div style={styles.brand}><LogoIcon /> MyBanker</div>
      <div style={styles.stepRow}>
        {labels.map((l, i) => <span key={l} onClick={() => setStep(i)} style={{ ...styles.stepLabel, opacity: i === step ? 1 : 0.35, cursor: "pointer" }}>{l}</span>)}
      </div>
    </div>
  );
}

function Intro({ onNext, onLogin }) {
  const [age, setAge] = useState("");
  const [assets, setAssets] = useState("");
  const [result, setResult] = useState(null);

  const getAgeKey = (a) => {
    const n = Number(a);
    if (n < 25) return "20-24";
    if (n < 30) return "25-29";
    if (n < 35) return "30-34";
    if (n < 40) return "35-39";
    if (n < 45) return "40-44";
    if (n < 50) return "45-49";
    if (n < 55) return "50-54";
    if (n < 60) return "55-59";
    return "60+";
  };

  const [assetsDisplay, setAssetsDisplay] = useState(""); // 表示用(カンマ付き)

  const handleAssetsChange = (e) => {
    const raw = e.target.value.replace(/,/g, "");
    if (raw === "" || /^\d+$/.test(raw)) {
      setAssets(raw);
      setAssetsDisplay(raw ? Number(raw).toLocaleString("ja-JP") : "");
    }
  };

  const handleDiagnose = () => {
    const a = Number(age);
    const assetMan = Number(assets) / 10000;
    if (!a || !assetMan) return;
    const key = getAgeKey(a);
    const stats = AGE_STATS[key];
    const pct = estimatePercentile(assetMan, stats.mean, stats.median);
    const dist = generateDistributionCurve(stats.mean, stats.median);
    const medal = (p) => p <= 5 ? "💎" : p <= 20 ? "🥇" : p <= 50 ? "🥈" : "🥉";
    const highlightIdx = findBucketIndex(dist, assetMan);
    setResult({ pct, medal: medal(pct), dist, highlightIdx, label: stats.label });
  };

  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const buildShareImage = () => new Promise((resolve) => {
    const W = 600, H = 360;
    const canvas = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    // 背景
    ctx.fillStyle = "#FBFAF0"; ctx.fillRect(0, 0, W, H);
    // ブランドロゴ(セリフ体でMyBankerらしく)
    ctx.fillStyle = "#1F2630";
    ctx.font = `bold 26px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = "center";
    ctx.fillText("MyBanker", W / 2, 44);
    // 区切り線
    ctx.strokeStyle = "#E3E9E4"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 58); ctx.lineTo(W - 40, 58); ctx.stroke();
    // メダル
    ctx.font = "80px serif"; ctx.textAlign = "center";
    ctx.fillText(result.medal, W / 2, 148);
    // 順位
    ctx.fillStyle = "#B5582E";
    ctx.font = `bold 58px Georgia, serif`;
    ctx.fillText(`上位 ${result.pct}%`, W / 2, 218);
    // ラベル
    ctx.fillStyle = "#1F2630"; ctx.font = "bold 17px sans-serif";
    ctx.fillText(result.label + "の総資産ランキング", W / 2, 256);
    // 注釈
    ctx.fillStyle = "#9AA6A0"; ctx.font = "11px sans-serif";
    ctx.fillText("※ J-FLEC「家計の金融行動に関する世論調査」を参考にした概算です", W / 2, 284);
    // 区切り線
    ctx.strokeStyle = "#E3E9E4";
    ctx.beginPath(); ctx.moveTo(40, 304); ctx.lineTo(W - 40, 304); ctx.stroke();
    // URL
    ctx.fillStyle = "#3D5A99"; ctx.font = "13px sans-serif";
    ctx.fillText("mybanker-app.vercel.app", W / 2, 332);
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });

  const handleShare = async () => {
    if (!result) return;
    setShareLoading(true);
    const text = `━━━━━━━━━━\n同年代との資産比較\n資産：${result.medal}上位${result.pct}%\n━━━━━━━━━━\nあなたも無料で順位をチェック👇\nhttps://mybanker-app.vercel.app`;
    try {
      const blob = await buildShareImage();
      const file = blob ? new File([blob], "mybanker_rank.png", { type: "image/png" }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text });
      } else if (navigator.share) {
        await navigator.share({ text });
      } else {
        navigator.clipboard?.writeText(text);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    } catch (e) { /* キャンセル等は無視 */ }
    setShareLoading(false);
  };

  if (result) {
    return (
      <div style={styles.card}>
        <p style={styles.eyebrow}>診断結果</p>
        <div style={{ textAlign: "center", padding: "8px 0 12px" }}>
          <div style={{ fontSize: 48, marginBottom: 4 }}>{result.medal}</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 38, fontWeight: 700, color: "#B5582E" }}>上位 {result.pct}%</div>
          <p style={{ fontSize: 13, color: "#5C6862", margin: "6px 0 0" }}>{result.label}の総資産ランキング</p>
          <p style={{ fontSize: 11, color: "#9AA6A0", marginTop: 2 }}>※ J-FLEC「家計の金融行動に関する世論調査」を参考にした概算です</p>
        </div>

        <TouchDismissChart><ResponsiveContainer width="100%" height={150}>
          <BarChart data={result.dist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#5C6862" }} />
            <YAxis tick={{ fontSize: 10, fill: "#5C6862" }} tickFormatter={(v) => `${v}%`} />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
              {result.dist.map((entry, i) => (
                <Cell key={i} fill={i === result.highlightIdx ? "#B5582E" : "#C7CDD6"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer></TouchDismissChart>
        <p style={{ fontSize: 11, color: "#9AA6A0", marginTop: 4 }}>● オレンジ＝あなたの位置</p>

        <button style={{ ...styles.shareBtn, width: "100%", marginTop: 14 }} onClick={handleShare} disabled={shareLoading}>
          {shareCopied ? "コピーしました ✓" : shareLoading ? "画像を生成中..." : "📤 この結果をシェアする"}
        </button>

        <div style={{ background: "#F7F5EF", borderRadius: 12, padding: "14px 16px", margin: "16px 0" }}>
          <p style={{ fontSize: 13, color: "#1F2630", margin: 0, lineHeight: 1.8 }}>
            登録すると、<strong>年収・支出・貯蓄率・資産成長率</strong>などでも、同年代・同収入・東証プライム社員との詳細比較が見られます。
          </p>
        </div>

        <button style={{ ...styles.primaryBtn, width: "100%", fontSize: 16, padding: "16px" }} onClick={onNext}>無料で登録して全部見る →</button>
        <button style={{ ...styles.ghostBtn, marginTop: 10, width: "100%" }} onClick={() => setResult(null)}>もう一度診断する</button>
        <button style={{ ...styles.smallLinkBtn, display: "block", marginTop: 12, textAlign: "center", width: "100%" }} onClick={onLogin}>すでにアカウントをお持ちの方</button>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>自分の立ち位置がわかる資産管理サービス</p>
      <h1 style={styles.h1}>あなたの資産、<br />同年代で何位？</h1>
      <p style={styles.lead}>年齢と総資産を入れるだけで、同年代の中での順位がわかります。</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>年齢</span>
          <div style={styles.fieldInputRow}>
            <input
              style={{ ...styles.input, fontSize: 18 }}
              type="number" inputMode="numeric" placeholder="28"
              value={age} onChange={(e) => setAge(e.target.value)}
            />
            <span style={styles.suffix}>歳</span>
          </div>
        </label>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>総資産（貯金＋投資など）</span>
          <div style={styles.fieldInputRow}>
            <input
              style={{ ...styles.input, fontSize: 18 }}
              type="text" inputMode="numeric" placeholder="3,000,000"
              value={assetsDisplay} onChange={handleAssetsChange}
            />
            <span style={styles.suffix}>円</span>
          </div>
        </label>
      </div>

      <button
        style={{ ...styles.primaryBtn, width: "100%", fontSize: 17, padding: "16px", opacity: (!age || !assets) ? 0.5 : 1 }}
        onClick={handleDiagnose} disabled={!age || !assets}
      >
        順位を調べる →
      </button>

      <div style={{ marginTop: 20, borderTop: "1px solid #E3E9E4", paddingTop: 16 }}>
        <p style={{ fontSize: 12, color: "#9AA6A0", textAlign: "center", marginBottom: 12 }}>資産・収入・支出まで記録・管理したい方はこちら</p>
        <button style={{ ...styles.ghostBtn, width: "100%" }} onClick={onNext}>詳しく設定して使う</button>
        <button style={{ ...styles.smallLinkBtn, display: "block", marginTop: 10, textAlign: "center", width: "100%" }} onClick={onLogin}>すでにアカウントをお持ちの方</button>
      </div>
    </div>
  );
}

function LoginOnly({ onDone, onBack }) {
  const [mode, setMode] = useState("login"); // login | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await signInWithEmail(email, password);
      onDone();
    } catch (err) {
      setMessage(toJaError(err));
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await requestPasswordReset(email);
      setMessage("パスワード再設定メールを送りました。メール内のリンクを開いてください。");
    } catch (err) {
      setMessage(toJaError(err));
    }
  };

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>ログイン</p>
      <h2 style={styles.h2}>{mode === "login" ? "アカウントにログイン" : "パスワードを再設定"}</h2>

      {mode === "login" ? (
        <form onSubmit={handleLogin}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>メールアドレス</span>
              <div style={styles.fieldInputRow}><input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="example@email.com" /></div>
            </label>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>パスワード</span>
              <div style={styles.fieldInputRow}><input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            </label>
          </div>
          {message && <p style={styles.warnText}>{message}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
            <button style={styles.primaryBtn} type="submit">ログインする</button>
            <button style={styles.ghostBtn} type="button" onClick={onBack}>戻る</button>
            <button style={styles.smallLinkBtn} type="button" onClick={() => { setMode("forgot"); setMessage(""); }}>パスワードをお忘れですか？</button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleForgot}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>登録したメールアドレス</span>
            <div style={styles.fieldInputRow}><input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          </label>
          {message && <p style={styles.hint}>{message}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
            <button style={styles.primaryBtn} type="submit">再設定メールを送る</button>
            <button style={styles.ghostBtn} type="button" onClick={() => { setMode("login"); setMessage(""); }}>ログインに戻る</button>
          </div>
        </form>
      )}
    </div>
  );
}

function OnboardingRegisterStep({ onDone, onSkip, incomingReferralCode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      await upgradeToEmailAccount(email, password);
      const u = await getCurrentUser();
      if (u?.id) {
        fetch("/api/apply-signup-trial", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: u.id }),
        }).catch(() => {});
        fetch("/api/update-reminder-setting", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: u.id, emailReminder: true, reminderEmail: email }),
        }).catch(() => {});
        if (incomingReferralCode) {
          fetch("/api/apply-referral", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: u.id, referralCode: incomingReferralCode }),
          }).catch(() => {});
        }
      }
      onDone();
    } catch (err) {
      setMessage(toJaError(err));
      setLoading(false);
    }
  };

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>STEP 4 — 登録</p>
      <h2 style={styles.h2}>データを保存しましょう</h2>
      <p style={styles.lead}>メールアドレスで登録すると、このデータを他の端末からも見られるようになります。</p>
      <form onSubmit={handleSignup}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>メールアドレス</span>
            <div style={styles.fieldInputRow}><input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="example@email.com" /></div>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>パスワード（6文字以上）</span>
            <div style={styles.fieldInputRow}><input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></div>
          </label>
        </div>
        {message && <p style={styles.warnText}>{message}</p>}
        <button style={{ ...styles.primaryBtn, width: "100%" }} type="submit" disabled={loading}>{loading ? "登録中..." : "登録してメイン画面へ"}</button>
      </form>
      <button style={{ ...styles.smallLinkBtn, display: "block", marginTop: 14, textAlign: "center", width: "100%" }} onClick={onSkip}>今はスキップしてメイン画面へ</button>
      <p style={{ fontSize: 11, color: "#9AA6A0", marginTop: 8, textAlign: "center" }}>スキップした場合、データはこの端末にのみ保存されます</p>
    </div>
  );
}

function Field({ label, value, onChange, suffix, hint, type }) {
  const isNumeric = type !== "text";
  const display = isNumeric && value !== "" && value !== undefined && value !== null
    ? Number(String(value).replace(/,/g, "")).toLocaleString("ja-JP")
    : value;
  const handleChange = (e) => {
    if (!isNumeric) { onChange(e); return; }
    const raw = e.target.value.replace(/[^0-9]/g, "");
    onChange({ target: { value: raw } });
  };
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <div style={styles.fieldInputRow}>
        <input style={styles.input} value={display} onChange={handleChange} inputMode={type === "text" ? "text" : "numeric"} type="text" />
        {suffix && <span style={styles.suffix}>{suffix}</span>}
      </div>
      {hint && <span style={styles.hint}>{hint}</span>}
    </label>
  );
}

function NumInput({ value, onChange, placeholder }) {
  const display = value !== "" && value !== undefined && value !== null
    ? Number(String(value).replace(/,/g, "")).toLocaleString("ja-JP")
    : value;
  const handleChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    onChange({ target: { value: raw } });
  };
  return <input style={styles.input} value={display} onChange={handleChange} inputMode="numeric" placeholder={placeholder} />;
}

function IncomeStep({ form, update, incomeMode, setIncomeMode, monthlyIncomeComputed, monthlyGrossComputed, takeHomeRatio, bonusHandling, setBonusHandling, bonusInputType, setBonusInputType, onNext, onBack, sideIncomes, setSideIncomes, removeSideIncome, sideIncomeMonthlyTotal, saveLabel, showToast }) {
  const bonusAnnualVal = Number(form.bonusAnnual) || 0;
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>STEP 1 — 収入</p>
      <h2 style={styles.h2}>収入を教えてください</h2>

      <label style={styles.field}>
        <span style={styles.fieldLabel}>生年月日</span>
        <div style={styles.fieldInputRow}>
          <input style={styles.input} type="date" value={form.birthDate} onChange={update("birthDate")} />
        </div>
        <span style={styles.hint}>同年代との比較表示に使います</span>
      </label>
      <div style={{ height: 16 }} />

      <div style={styles.toggleRow}>
        <button style={incomeMode === "gross" ? styles.toggleActive : styles.toggleInactive} onClick={() => setIncomeMode("gross")}>基本給・残業から算出</button>
        <button style={incomeMode === "takehome" ? styles.toggleActive : styles.toggleInactive} onClick={() => setIncomeMode("takehome")}>手取りで入力</button>
      </div>
      {incomeMode === "gross" ? (
        <div style={styles.grid2}>
          <Field label="基本給" value={form.baseSalary} onChange={update("baseSalary")} suffix="円" />
          <Field label="月の残業時間" value={form.overtimeHours} onChange={update("overtimeHours")} suffix="時間" />
          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={form.isManager} onChange={(e) => update("isManager")({ target: { value: e.target.checked } })} />
            <span>管理職・見込み残業のため残業代は別途つかない</span>
          </label>
        </div>
      ) : (
        <Field label="月収（手取り）" value={form.monthlyIncome} onChange={update("monthlyIncome")} suffix="円" />
      )}
      {incomeMode === "gross" && (
        <div style={styles.summaryRow}>
          <div style={styles.summaryItem}><span style={styles.summaryLabel}>推定額面月収</span><span style={styles.summaryValue}>¥{fmt(monthlyGrossComputed)}</span></div>
          <div style={styles.summaryItem}><span style={styles.summaryLabel}>推定手取り月収</span><span style={styles.summaryValue}>¥{fmt(monthlyIncomeComputed)}</span></div>
          <div style={styles.summaryItem}><span style={styles.summaryLabel}>推定手取り率</span><span style={styles.summaryValue}>{Math.round(takeHomeRatio * 1000) / 10}%</span></div>
        </div>
      )}
      <p style={styles.hint}>手取り率は年収帯によって変わるため、年収に応じた目安（独身・扶養なし想定の簡易モデル）で計算しています。</p>

      <div style={{ marginTop: 10 }}>
        <div style={styles.nisaTargetBox}>
          <span style={styles.fieldLabel}>副業・副収入（任意）</span>
          {sideIncomes.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {sideIncomes.map((s) => (
                <div key={s.id} style={{ ...styles.otherAssetCard, marginBottom: 8 }}>
                  <div style={styles.otherAssetCardTop}>
                    <input
                      style={styles.otherAssetLabelInput} value={s.name} placeholder="副業名・メモ（任意）"
                      onChange={(e) => setSideIncomes(sideIncomes.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x))}
                    />
                    <button style={styles.removeBtn} onClick={() => removeSideIncome(s.id)}>×</button>
                  </div>
                  <div style={styles.otherAssetCardRow}>
                    <label style={styles.otherAssetFieldWrap}>
                      <span style={styles.fieldLabel}>月収入（手取り）</span>
                      <div style={styles.fieldInputRow}>
                        <NumInput
                          value={s.amount}
                          onChange={(e) => setSideIncomes(sideIncomes.map((x) => x.id === s.id ? { ...x, amount: e.target.value } : x))}
                        />
                        <span style={styles.suffix}>円/月</span>
                      </div>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button style={styles.addRowBtn} onClick={() => setSideIncomes([...sideIncomes, { id: Date.now(), name: "", amount: "" }])}>+ 副業・副収入を追加する</button>
          {sideIncomeMonthlyTotal > 0 && <p style={styles.hint}>副業収入（手取り）合計：月 ¥{fmt(sideIncomeMonthlyTotal)} / 年 ¥{fmt(sideIncomeMonthlyTotal * 12)}（年収・自由資金の計算に含まれます）</p>}
        </div>
      </div>

      <div style={styles.divider} />
      <div style={styles.grid2}>
        <Field label="ボーナス年間総額" value={form.bonusAnnual} onChange={update("bonusAnnual")} suffix="円" />
        <div style={styles.field}>
          <span style={styles.fieldLabel}>このボーナスの金額は</span>
          <div style={styles.toggleRow}>
            <button style={bonusInputType === "gross" ? styles.toggleActiveSm : styles.toggleInactiveSm} onClick={() => setBonusInputType("gross")}>額面</button>
            <button style={bonusInputType === "net" ? styles.toggleActiveSm : styles.toggleInactiveSm} onClick={() => setBonusInputType("net")}>手取り</button>
          </div>
        </div>
      </div>

      <div style={{ ...styles.toggleRow, marginTop: 14 }}>
        <button style={bonusHandling === "smooth" ? styles.toggleActive : styles.toggleInactive} onClick={() => setBonusHandling("smooth")}>毎月に均等按分する</button>
        <button style={bonusHandling === "lump" ? styles.toggleActive : styles.toggleInactive} onClick={() => setBonusHandling("lump")}>ボーナス時にまとめて配分する</button>
      </div>
      <p style={styles.hint}>
        {bonusHandling === "smooth" ? "自由資金 ＝（年収 − 年間支出）÷ 12 として、ボーナスも毎月の配分に含めて計算します。" : "自由資金 ＝ 月収 − 支出 として計算し、ボーナスは受け取った時にまとめて配分する案を別に出します。"}
      </p>

      <div style={styles.btnRow}>
        <button style={styles.ghostBtn} onClick={onBack}>戻る</button>
        <button style={styles.primaryBtn} onClick={onNext}>{saveLabel || "次へ"}</button>
      </div>
      {showToast && <div style={styles.toastBanner}>保存しました ✓</div>}
    </div>
  );
}

function ExpenseStep({ detailedExpense, setDetailedExpense, expenses, updateExpense, updateLabel, addExpenseRow, removeExpense, form, update, totalExpense, insuranceRatio, onNext, onBack, saveLabel, showToast }) {
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>STEP 2 — 支出</p>
      <h2 style={styles.h2}>毎月の支出を教えてください</h2>
      <div style={styles.toggleRow}>
        <button style={!detailedExpense ? styles.toggleActive : styles.toggleInactive} onClick={() => setDetailedExpense(false)}>まとめて入力</button>
        <button style={detailedExpense ? styles.toggleActive : styles.toggleInactive} onClick={() => setDetailedExpense(true)}>項目ごとに入力</button>
      </div>
      {!detailedExpense ? (
        <Field label="月の固定費・支出合計" value={form.fixedCostSimple} onChange={update("fixedCostSimple")} suffix="円" />
      ) : (
        <div style={styles.expenseList}>
          {expenses.map((x) => (
            <div key={x.key} style={styles.otherAssetCard}>
              <div style={styles.otherAssetCardTop}>
                {x.custom ? <input style={styles.otherAssetLabelInput} value={x.label} placeholder="項目名" onChange={updateLabel(x.key)} /> : <span style={styles.expenseLabel}>{x.label}</span>}
                <button style={styles.removeBtn} onClick={() => removeExpense(x.key)}>×</button>
              </div>
              <div style={styles.fieldInputRow}>
                <NumInput value={x.amount} onChange={updateExpense(x.key)} />
                <span style={styles.suffix}>円</span>
              </div>
            </div>
          ))}
          <button style={styles.addRowBtn} onClick={addExpenseRow}>+ 項目を追加する</button>
          <div style={styles.totalLine}>支出合計：<span style={styles.totalValue}>¥{fmt(totalExpense)}</span></div>
          {insuranceRatio > 0.08 && <div style={styles.statusBanner}>保険料が収入の{Math.round(insuranceRatio * 100)}%程度になっています。一般的には収入の5〜8%程度が目安とされることが多く、内容を一度見直してもよいかもしれません。</div>}
        </div>
      )}
      <div style={styles.btnRow}>
        <button style={styles.ghostBtn} onClick={onBack}>戻る</button>
        <button style={styles.primaryBtn} onClick={onNext}>{saveLabel || "次へ"}</button>
      </div>
      {showToast && <div style={styles.toastBanner}>保存しました ✓</div>}
    </div>
  );
}

function RiskStep({ riskProfile, setRiskProfile, onNext, onBack }) {
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>STEP 3 — 運用方針</p>
      <h2 style={styles.h2}>どのくらい積極的に運用したいですか</h2>
      <p style={styles.lead}>これは積立額の大小ではなく、株式投資（NISAなど）・その他運用に入れたお金を、どんな資産配分で運用する想定にするかの選択です。</p>
      <div style={styles.riskGrid}>
        {Object.entries(RISK_PROFILES).map(([key, p]) => (
          <button key={key} onClick={() => setRiskProfile(key)} style={riskProfile === key ? styles.riskCardActive : styles.riskCard}>
            <div style={styles.riskLabel}>{p.label}</div>
            <div style={styles.riskRate}>年率 {(p.rate * 100).toFixed(1)}% 目安</div>
            <div style={styles.riskNote}>{p.mix}</div>
          </button>
        ))}
      </div>
      <div style={styles.btnRow}>
        <button style={styles.ghostBtn} onClick={onBack}>戻る</button>
        <button style={styles.primaryBtn} onClick={onNext}>{saveLabel || "次へ"}</button>
      </div>
    </div>
  );
}

function OtherAssetsEditor({ otherAssets, updateOtherAsset, updateOtherAssetLabel, updateOtherAssetRate, addOtherAssetRow, removeOtherAsset, otherAssetsTotal }) {
  const [suggestKey, setSuggestKey] = useState(null);
  const pickOtherAssetPreset = (key, p) => {
    updateOtherAssetLabel(key)({ target: { value: p.name } });
    updateOtherAssetRate(key)({ target: { value: String(p.rate) } });
    setSuggestKey(null);
  };
  return (
    <div>
      <div style={styles.totalLineTop}>その他資産合計：<span style={styles.totalValue}>¥{fmt(otherAssetsTotal)}</span></div>
      <p style={styles.hint}>暗号資産、FX、ポイントなど、お好きな項目を追加・編集できます。想定年率を入れると、推移予想に複利（年率に応じた指数関数的な成長）で反映されます。</p>
      <div style={styles.otherAssetList}>
        {otherAssets.map((x) => {
          const filtered = OTHER_ASSET_PRESETS.filter((p) => x.label && p.name.toLowerCase().includes(x.label.toLowerCase()));
          return (
            <div key={x.key} style={styles.otherAssetCard}>
              <div style={styles.otherAssetCardTop}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    style={styles.otherAssetLabelInput} value={x.label} placeholder="項目名（例：ビットコイン）"
                    onChange={(e) => { updateOtherAssetLabel(x.key)(e); setSuggestKey(x.key); }}
                    onFocus={() => setSuggestKey(x.key)}
                  />
                  {suggestKey === x.key && filtered.length > 0 && (
                    <div style={styles.suggestBox}>
                      {filtered.map((p) => (
                        <div key={p.name} style={styles.suggestItem} onClick={() => pickOtherAssetPreset(x.key, p)}>
                          <span>{p.name}</span><span style={styles.suggestRate}>年率{p.rate}%目安</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button style={styles.removeBtn} onClick={() => removeOtherAsset(x.key)}>×</button>
              </div>
              <div style={styles.otherAssetCardRow}>
                <label style={styles.otherAssetFieldWrap}>
                  <span style={styles.fieldLabel}>金額</span>
                  <div style={styles.fieldInputRow}>
                    <NumInput value={x.amount} onChange={updateOtherAsset(x.key)} />
                    <span style={styles.suffix}>円</span>
                  </div>
                </label>
                <label style={styles.otherAssetFieldWrap}>
                  <span style={styles.fieldLabel}>想定年率</span>
                  <div style={styles.fieldInputRow}>
                    <NumInput value={x.rate} onChange={updateOtherAssetRate(x.key)} />
                    <span style={styles.suffix}>%</span>
                  </div>
                </label>
              </div>
            </div>
          );
        })}
        <button style={styles.addRowBtn} onClick={addOtherAssetRow}>+ 項目を追加する（例：暗号資産、FX、ポイントなど）</button>
      </div>
    </div>
  );
}

function HoldingsEditor({ holdings, setHoldings, addHoldingRow, updateHoldingField, removeHoldingRow, totalHoldingsValue }) {
  const [suggestId, setSuggestId] = useState(null);
  const pickPresetForRow = (id, p) => {
    // 名前と年率を同時に1回のstate更新で反映(別々に呼ぶと古いstateを参照して上書きされてしまうため)
    setHoldings((prev) => prev.map((h) => h.id === id ? { ...h, name: p.name, rate: String(p.rate) } : h));
    setSuggestId(null);
  };
  return (
    <div>
      <div style={styles.totalLineTop}>株式・投資信託の合計：<span style={styles.totalValue}>¥{fmt(totalHoldingsValue)}</span></div>
      <p style={styles.hint}>投資信託・株式・ETFなどを銘柄ごとに登録できます。商品名を入力すると候補と想定年率が表示されます。</p>
      <div style={styles.otherAssetList}>
        {holdings.map((h) => {
          const filtered = HOLDING_PRESETS.filter((p) => h.name && p.name.toLowerCase().includes(h.name.toLowerCase()));
          return (
            <div key={h.id} style={styles.otherAssetCard}>
              <div style={styles.otherAssetCardTop}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    style={styles.otherAssetLabelInput} value={h.name} placeholder="商品名（例：eMAXIS Slim 全世界株式）"
                    onChange={(e) => { updateHoldingField(h.id, "name")(e); setSuggestId(h.id); }}
                    onFocus={() => setSuggestId(h.id)}
                  />
                  {suggestId === h.id && filtered.length > 0 && (
                    <div style={styles.suggestBox}>
                      {filtered.map((p) => (
                        <div key={p.name} style={styles.suggestItem} onClick={() => pickPresetForRow(h.id, p)}>
                          <span>{p.name}</span><span style={styles.suggestRate}>年率{p.rate}%目安</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button style={styles.removeBtn} onClick={() => removeHoldingRow(h.id)}>×</button>
              </div>
              <div style={styles.otherAssetCardRow}>
                <label style={styles.otherAssetFieldWrap}>
                  <span style={styles.fieldLabel}>保有額</span>
                  <div style={styles.fieldInputRow}>
                    <NumInput value={h.amount} onChange={updateHoldingField(h.id, "amount")} />
                    <span style={styles.suffix}>円</span>
                  </div>
                </label>
                <label style={styles.otherAssetFieldWrap}>
                  <span style={styles.fieldLabel}>想定年率</span>
                  <div style={styles.fieldInputRow}>
                    <NumInput value={h.rate} onChange={updateHoldingField(h.id, "rate")} />
                    <span style={styles.suffix}>%</span>
                  </div>
                </label>
              </div>
            </div>
          );
        })}
        <button style={styles.addRowBtn} onClick={addHoldingRow}>+ 銘柄を追加する</button>
      </div>
    </div>
  );
}

function AssetBaseline({ assetInput, setAssetInput, holdings, setHoldings, addHoldingRow, updateHoldingField, removeHoldingRow, totalHoldingsValue, otherAssets, updateOtherAsset, updateOtherAssetLabel, updateOtherAssetRate, addOtherAssetRow, removeOtherAsset, otherAssetsTotal, onNext, onBack }) {
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>STEP 4 — 現在の資産</p>
      <h2 style={styles.h2}>今の資産を教えてください</h2>
      <p style={styles.lead}>これが資産記録の最初の記録になります。次に配分を決めてから、メイン画面に切り替わります。</p>
      <div style={styles.grid2}>
        <Field label="貯金・現金" value={assetInput.savings} onChange={(e) => setAssetInput({ ...assetInput, savings: e.target.value })} suffix="円" />
      </div>

      <div style={styles.divider} />
      <p style={styles.chartTitle}>その他資産</p>
      <OtherAssetsEditor
        otherAssets={otherAssets} updateOtherAsset={updateOtherAsset} updateOtherAssetLabel={updateOtherAssetLabel} updateOtherAssetRate={updateOtherAssetRate}
        addOtherAssetRow={addOtherAssetRow} removeOtherAsset={removeOtherAsset} otherAssetsTotal={otherAssetsTotal}
      />

      <div style={styles.divider} />
      <p style={styles.chartTitle}>株式・投資信託（個別に登録します）</p>
      <HoldingsEditor
        holdings={holdings} setHoldings={setHoldings} addHoldingRow={addHoldingRow} updateHoldingField={updateHoldingField}
        removeHoldingRow={removeHoldingRow} totalHoldingsValue={totalHoldingsValue}
      />

      <div style={styles.btnRow}>
        <button style={styles.ghostBtn} onClick={onBack}>戻る</button>
        <button style={styles.primaryBtn} onClick={onNext}>メイン画面へ</button>
      </div>
    </div>
  );
}

// ====== ダッシュボード ======

function Glossary({ onClose }) {
  const terms = [
    { term: "NISA（つみたて投資枠・成長投資枠）", desc: "投資で得た利益に税金がかからない制度。年間の投資額に上限があります。" },
    { term: "iDeCo（個人型確定拠出年金）", desc: "自分で出したお金が老後の年金になる制度。出した分が所得控除になり税金が少し安くなりますが、原則60歳まで引き出せません。" },
    { term: "ふるさと納税", desc: "自治体に寄付すると、寄付額のほぼ全額が翌年の税金から控除され、お礼の品(返礼品)が貰える制度。収入により寄付できる上限額が変わります。" },
    { term: "緊急予備資金", desc: "急な出費や収入減少に備えて、すぐ使える形で確保しておくお金。生活費の数ヶ月分が目安とされます。" },
    { term: "投資信託", desc: "多くの人からお金を集めて、運用の専門家が株式や債券などにまとめて投資する商品。1つ買うだけで複数の銘柄に分散投資できます。" },
  ];
  return (
    <div style={styles.glossaryCard}>
      <div style={styles.glossaryHeader}>
        <span style={styles.chartTitle}>用語の説明</span>
        <button style={styles.glossaryClose} onClick={onClose}>閉じる</button>
      </div>
      {terms.map((t) => (
        <div key={t.term} style={styles.glossaryItem}>
          <div style={styles.glossaryTerm}>{t.term}</div>
          <div style={styles.glossaryDesc}>{t.desc}</div>
        </div>
      ))}
    </div>
  );
}

function Dashboard(props) {
  const { dashView, setDashView, planningFlow, setPlanningFlow, riskProfile, setRiskProfile, allocTouched, isAnonymousUser, goalAmount, setGoalAmount, allocOver, allocUnder, nisaSplitOver, otherSplitOver } = props;
  const [showGlossary, setShowGlossary] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const navItems = [
    { key: "overview", label: "概要" },
    { key: "holdings", label: "保有資産" },
    { key: "ranking", label: "ランキング" },
  ];
  const moreItems = [
    { key: "income", label: "収入実績" },
    { key: "expense", label: "支出実績" },
    { key: "settings", label: "設定" },
    { key: "account", label: "アカウント" },
    { key: "contact", label: "お問い合わせ" },
  ];
  const goHome = () => { setPlanningFlow(null); setDashView("overview"); setShowMore(false); };
  const goAccount = () => { setPlanningFlow(null); setDashView("account"); setShowMore(false); };

  const signupBar = isAnonymousUser && (
    <div style={styles.signupBar}>
      <span>このデータは今の端末だけに保存されています。</span>
      <button style={styles.signupBarBtn} onClick={goAccount}>登録して保護する</button>
    </div>
  );

  if (planningFlow) {
    return (
      <div style={styles.page}>
        <div style={styles.shell}>
          <div style={styles.header}>
            <div style={styles.brand} onClick={goHome}><LogoIcon /> MyBanker</div>
          </div>
          {planningFlow === "risk" && (
            <RiskStep riskProfile={riskProfile} setRiskProfile={setRiskProfile}
              onNext={() => setPlanningFlow("simulator")} onBack={() => setPlanningFlow(null)} />
          )}
          {planningFlow === "simulator" && (
            <div>
              <SimulatorPanel {...props} />
              {(allocOver || allocUnder || nisaSplitOver || otherSplitOver) && (
                <p style={styles.warnText}>配分の合計が100%になっていません。エラー表示の箇所を直してから次に進んでください。</p>
              )}
              <div style={{ ...styles.btnRow, marginTop: 18 }}>
                <button style={styles.ghostBtn} onClick={() => setPlanningFlow(null)}>メイン画面に戻る</button>
                <button style={styles.primaryBtn} onClick={() => setPlanningFlow("goal")} disabled={allocOver || allocUnder || nisaSplitOver || otherSplitOver}>次へ（目標金額を設定）</button>
              </div>
            </div>
          )}
          {planningFlow === "goal" && (
            <div style={styles.card}>
              <p style={styles.eyebrow}>目標金額</p>
              <h2 style={styles.h2}>将来、いくらを目指しますか？</h2>
              <Field label="目標金額" value={goalAmount} onChange={(e) => setGoalAmount(e.target.value)} suffix="円" hint="例：3000万円なら「30000000」と入力（未設定でもメイン画面のシミュレーションは表示されます）" />
              {(allocOver || allocUnder || nisaSplitOver || otherSplitOver) && (
                <p style={styles.warnText}>配分の合計が100%になっていません。「配分を直す」から修正してください。</p>
              )}
              <div style={{ ...styles.btnRow, marginTop: 18 }}>
                <button style={styles.ghostBtn} onClick={() => setPlanningFlow("simulator")}>配分を直す</button>
                <button style={styles.primaryBtn} onClick={() => setPlanningFlow(null)} disabled={allocOver || allocUnder || nisaSplitOver || otherSplitOver}>完了してメイン画面へ</button>
              </div>
            </div>
          )}
          {signupBar}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.header}>
          <div style={styles.brand} onClick={goHome}><LogoIcon /> MyBanker</div>
          <button style={styles.glossaryBtn} onClick={() => setShowGlossary(!showGlossary)}>？ 用語の説明</button>
        </div>
        {showGlossary && <Glossary onClose={() => setShowGlossary(false)} />}
        {dashView === "overview" && <Overview {...props} />}
        {dashView === "ranking" && <RankingPanel {...props} />}
        {dashView === "holdings" && <HoldingsPanel {...props} />}
        {dashView === "income" && <IncomeTrackPanel {...props} />}
        {dashView === "expense" && <ExpenseTrackPanel {...props} />}
        {dashView === "settings" && <SettingsPanel {...props} />}
        {dashView === "account" && <AccountPanel {...props} />}
        {dashView === "contact" && <ContactPanel />}

        {showMore && (
          <div style={styles.moreSheet}>
            {moreItems.map((n) => (
              <button key={n.key} onClick={() => { setDashView(n.key); setShowMore(false); }} style={dashView === n.key ? styles.moreItemActive : styles.moreItem}>{n.label}</button>
            ))}
          </div>
        )}

        {signupBar}

        <div style={styles.navBar}>
          {navItems.map((n) => (
            <button key={n.key} onClick={() => { setDashView(n.key); setShowMore(false); }} style={dashView === n.key ? styles.navItemActive : styles.navItem}>{n.label}</button>
          ))}
          <button onClick={() => setShowMore(!showMore)} style={showMore ? styles.navItemActive : styles.navItem}>☰ その他</button>
        </div>
      </div>
    </div>
  );
}

function Overview({ totalNetWorth, totalHoldingsValue, assetLogs, monthlyFree, totalExpense, monthlyIncomeComputed, bonusHandling, annualIncomeEstimateNet, projection, riskProfile, annualIncomeEstimateGross, furusatoApprox, allocNums, holdings, goalCompareData, userAge, ageDecade, age5Label, assetPercentile, projectionSeriesKeys, SERIES_COLORS, setDashView, setPlanningFlow, allocTouched, goalAmount, monthsToGoal, resetPlanBaseline }) {
  const lastCompare = goalCompareData[goalCompareData.length - 1];
  const diff = lastCompare ? lastCompare.実際の資産 - lastCompare.計画上の想定 : null;
  const lastLog = assetLogs[assetLogs.length - 1];
  const [openCard, setOpenCard] = useState(null);
  const toggle = (key) => setOpenCard(openCard === key ? null : key);
  const [chartRange, setChartRange] = useState("near");
  const nearLabels = ["現在", "1年後", "3年後", "5年後"];
  const projectionView = chartRange === "near"
    ? projection.filter((p) => nearLabels.includes(p.year))
    : projection.filter((p) => !["1年後", "3年後"].includes(p.year));

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>概要</p>
      <h2 style={styles.h2}>あなたの資産の今</h2>

      <div style={styles.summaryRow}>
        <div style={styles.summaryItemLg} onClick={() => toggle("total")}>
          <span style={styles.summaryLabel}>総資産　<span style={styles.tapHint}>タップで内訳</span></span>
          <span style={styles.summaryValueLg}>¥{fmt(totalNetWorth)}</span>
        </div>
        <div style={styles.summaryItem} onClick={() => toggle("free")}>
          <span style={styles.summaryLabel}>毎月の自由資金　<span style={styles.tapHint}>タップで根拠</span></span>
          <span style={styles.summaryValue}>¥{fmt(monthlyFree)}</span>
        </div>
      </div>

      {openCard === "total" && (
        <div style={styles.expandCard}>
          <div style={styles.ledger}>
            <div style={styles.ledgerRow}><span style={styles.ledgerLabel}>貯金・現金</span><span style={styles.ledgerValue}>¥{fmt(lastLog ? Number(lastLog.savings) || 0 : 0)}</span></div>
            <div style={styles.ledgerRow}><span style={styles.ledgerLabel}>株式・投資信託</span><span style={styles.ledgerValue}>¥{fmt(totalHoldingsValue)}</span></div>
            <div style={styles.ledgerRow}><span style={styles.ledgerLabel}>その他資産</span><span style={styles.ledgerValue}>¥{fmt(lastLog ? Number(lastLog.other) || 0 : 0)}</span></div>
          </div>
        </div>
      )}

      {openCard === "free" && (
        <div style={styles.expandCard}>
          <p style={styles.calcNote}>
            {bonusHandling === "smooth"
              ? `自由資金 ＝（想定年収（手取り） ¥${fmt(annualIncomeEstimateNet)} − 年間支出 ¥${fmt(totalExpense * 12)}）÷ 12 ＝ ¥${fmt(monthlyFree)}`
              : `自由資金 ＝ 月の手取り ¥${fmt(monthlyIncomeComputed)} − 支出 ¥${fmt(totalExpense)} ＝ ¥${fmt(monthlyFree)}（ボーナスは別枠）`}
          </p>
        </div>
      )}

      {openCard === "holdings" && (
        <div style={styles.expandCard}>
          {holdings.length === 0 ? (
            <p style={styles.hint}>まだ個別の保有資産が登録されていません。</p>
          ) : (
            <div style={styles.ledger}>
              {holdings.map((h) => (
                <div key={h.id} style={styles.ledgerRow}>
                  <div style={styles.ledgerLabel}>{h.name}</div>
                  <div style={styles.ledgerRight}><div style={styles.ledgerValue}>¥{fmt(h.amount)}</div><div style={styles.ledgerPct}>年率{h.rate}%</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={styles.percentileCard}>
        <p style={styles.chartTitle}>{age5Label}との資産比較</p>
        <div style={styles.percentileRow}>
          <div style={styles.percentileBig}>上位 {assetPercentile}%</div>
          <div style={styles.percentileNote}>総資産が同年代の中でこの位置にいる目安です</div>
        </div>
        <p style={styles.chartNote}>※ 金融経済教育推進機構(J-FLEC)の公表値を参考にした簡易的な推定値で、厳密な統計分布ではありません。</p>
        <button style={styles.rankingLinkBtn} onClick={() => setDashView("ranking")}>他のランキングも見る →</button>
      </div>

      <div style={styles.chartCard}>
        <div style={styles.chartTitleRow}>
          <p style={styles.chartTitle}>資産の推移予想</p>
          <button style={styles.planBtn} onClick={() => setPlanningFlow(allocTouched ? "simulator" : "risk")}>{allocTouched ? "積立プラン・目標金額を編集/確認する" : "積立プランを決めて将来の資産推移を見る"}</button>
        </div>
        <div style={styles.rangeToggleRow}>
          <button style={chartRange === "near" ? styles.pillActiveSm : styles.pillSm} onClick={() => setChartRange("near")}>5年後まで</button>
          <button style={chartRange === "far" ? styles.pillActiveSm : styles.pillSm} onClick={() => setChartRange("far")}>5〜30年後</button>
        </div>
        <TouchDismissChart><ResponsiveContainer width="100%" height={220}>
          <AreaChart data={projectionView} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#5C6862" }} />
            <YAxis tick={{ fontSize: 11, fill: "#5C6862" }} tickFormatter={fmtManOku} />
            <Tooltip content={<TotalTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="貯金" stackId="1" stroke="#2F6B4F" fill="#9FC4AC" />
            {projectionSeriesKeys.map((key, i) => (
              <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.45} />
            ))}
          </AreaChart>
        </ResponsiveContainer></TouchDismissChart>
        <p style={styles.chartNote}>※ 株式投資は月次の複利、その他資産（暗号資産・FXなど）は年率の複利で概算しています。想定年率自体の確実性は資産ごとに異なります（特に暗号資産は不確実性が高めです）。</p>
      </div>

      {goalAmount && Number(goalAmount) > 0 && (
        <div style={styles.goalCountdownCard}>
          <span style={styles.goalLabel}>目標金額 ¥{fmt(Number(goalAmount))} まで</span>
          {monthsToGoal === 0 ? (
            <span style={styles.goalValue}>達成済みです 🎉</span>
          ) : monthsToGoal === null ? (
            <span style={styles.goalValue}>このペースでは50年以内の到達が難しい見込みです</span>
          ) : (
            <span style={styles.goalValue}>あと{Math.floor(monthsToGoal / 12)}年{monthsToGoal % 12}ヶ月</span>
          )}
        </div>
      )}

      {goalCompareData.length > 1 && (
        <div style={styles.chartCard}>
          <p style={styles.chartTitle}>資産の推移予想 vs 実際の資産</p>
          <TouchDismissChart><ResponsiveContainer width="100%" height={200}>
            <LineChart data={goalCompareData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5C6862" }} />
              <YAxis tick={{ fontSize: 11, fill: "#5C6862" }} tickFormatter={fmtManOku} />
              <Tooltip formatter={(v) => `¥${fmt(v)}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="計画上の想定" stroke="#9AA6A0" strokeDasharray="4 3" dot={false} name="資産の推移予想" />
              <Line type="monotone" dataKey="実際の資産" stroke="#3D5A99" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer></TouchDismissChart>
          <p style={styles.chartNote}>※ 資産の記録を保存するたびに、この比較グラフが更新されます。「資産の推移予想」は最初に立てた時点のまま固定されます。</p>
          <button style={styles.smallLinkBtn} onClick={resetPlanBaseline}>今の積立設定で、資産の推移予想をリセットする</button>
        </div>
      )}

      {diff !== null && (
        <div style={styles.statusBanner2(diff >= 0)}>
          {diff >= 0 ? `予想より ¥${fmt(diff)} 多く資産が積み上がっています。このペースを維持しましょう。` : `予想より ¥${fmt(Math.abs(diff))} 資産の積み上がりが少ない状況です。配分シミュレーターで見直してみましょうか。`}
        </div>
      )}

      <div style={styles.furusatoCard}>
        <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>想定年収（額面）</span><span style={styles.furusatoValue}>¥{fmt(annualIncomeEstimateGross)}</span></div>
        <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>想定年収（手取り）</span><span style={styles.furusatoValue}>¥{fmt(annualIncomeEstimateNet)}</span></div>
        <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>ふるさと納税の目安額</span><span style={styles.furusatoValue}>¥{fmt(furusatoApprox)} / 年</span></div>
      </div>
    </div>
  );
}

function PaywallGate({ isPremium, setIsPremium, myReferralCode, incomingReferralCode, premiumUntil, premiumSource, setDashView, isAnonymousUser, children }) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      await openBillingPortal();
    } catch (err) {
      setErrorMsg("エラー: " + err.message);
      setPortalLoading(false);
    }
  };

  if (isPremium) {
    return (
      <div>
        {premiumSource === "trial" && <div style={styles.trialBanner}>会員登録特典により30日間無料表示中</div>}
        {premiumSource === "referral" && <div style={styles.trialBanner}>友人紹介により30日間無料表示中</div>}
        {children}
        <div style={styles.cancelBox}>
          {premiumUntil && (
            <p style={styles.hint}>
              {premiumSource === "paid"
                ? `次回更新日（解約済みの場合はこの日まで閲覧可能）：${new Date(premiumUntil).toLocaleDateString("ja-JP")}`
                : `無料閲覧期間：${new Date(premiumUntil).toLocaleDateString("ja-JP")}まで`}
            </p>
          )}
          {premiumSource === "paid" && (
            <button style={styles.ghostBtn} onClick={handlePortal} disabled={portalLoading}>
              {portalLoading ? "管理ページへ移動中..." : "解約・お支払い方法の管理"}
            </button>
          )}
          {errorMsg && <p style={styles.warnText}>{errorMsg}</p>}
        </div>
      </div>
    );
  }
  const sampleHighlightIdx = SAMPLE_INCOME_DISTRIBUTION.findIndex((d) => d.highlight);

  const referralUrl = myReferralCode
    ? `https://mybanker-app.vercel.app/?ref=${myReferralCode}`
    : "";

  const handleCheckout = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      await startCheckout(incomingReferralCode);
    } catch (err) {
      setErrorMsg("エラー: " + err.message);
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!referralUrl) return;
    navigator.clipboard?.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div style={styles.paywallCard}>
        <p style={styles.paywallTitle}>ここから先はプレミアム会員限定</p>
        <p style={styles.paywallDesc}>
          同年代の人との貯蓄・年収・支出の比較や分布グラフの表示、資産が増えているペースのランキングなど、より詳しく「自分の立ち位置」がわかります。
        </p>

        <div style={{ marginTop: 12, marginBottom: 16, padding: "12px", background: "#F7F5EF", borderRadius: 10 }}>
          <p style={{ ...styles.chartTitle, marginBottom: 8 }}>表示イメージ（サンプルグラフ）</p>
          <div style={styles.percentileRow}>
            <div style={{ ...styles.percentileBig, fontSize: 22 }}>上位 {SAMPLE_INCOME_PERCENTILE}%</div>
            <div style={styles.percentileNote}>例：年収の同年代での位置イメージ</div>
          </div>
          <TouchDismissChart><ResponsiveContainer width="100%" height={130}>
            <BarChart data={SAMPLE_INCOME_DISTRIBUTION} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#5C6862" }} />
              <YAxis tick={{ fontSize: 10, fill: "#5C6862" }} tickFormatter={(v) => `${v}%`} />
              <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                {SAMPLE_INCOME_DISTRIBUTION.map((entry, i) => (
                  <Cell key={i} fill={i === sampleHighlightIdx ? "#B5582E" : "#C7CDD6"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer></TouchDismissChart>
          <p style={styles.chartNote}>※ 実際のあなたのデータではなく、画面イメージ用のサンプルです。</p>
        </div>

        <div style={{ ...styles.paywallPriceRow, marginBottom: 8 }}>
          <span style={styles.paywallPrice}>月額 ¥500</span>
        </div>
        {incomingReferralCode && (
          <p style={styles.hint}>紹介コード「{incomingReferralCode}」を適用して登録します。</p>
        )}
        <div style={{ ...styles.paywallBtnRow, marginBottom: 0 }}>
          <button style={styles.primaryBtn} onClick={handleCheckout} disabled={loading}>
            {loading ? "決済ページへ移動中..." : "登録する（¥500/月）"}
          </button>
        </div>
        {errorMsg && <p style={styles.warnText}>{errorMsg}</p>}

        {isAnonymousUser !== false && (
          <div style={{ ...styles.trialNoticeBox, marginTop: 20 }}>
            <span>会員登録（無料）するだけで、30日間すべて無料で閲覧できます。</span>
            {setDashView && <button style={styles.smallLinkBtn} onClick={() => setDashView("account")}>会員登録はこちら →</button>}
          </div>
        )}

        {myReferralCode && (
          <div style={{ marginTop: 16 }}>
            <p style={styles.paywallNote}>友人を1人紹介すると、30日間無料</p>
            <p style={styles.fieldLabel}>あなたの紹介リンク（友人がこのリンクから登録すると、あなたが30日間無料に）</p>
            <div style={styles.fieldInputRow}>
              <input style={styles.input} value={referralUrl} readOnly />
              <button style={styles.ghostBtn} onClick={handleCopy}>{copied ? "コピーしました" : "コピー"}</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function RankingPanel(props) {
  const {
    isPremium, setIsPremium, userAge, ageDecade, age5Label, assetPercentile, totalNetWorth,
    assetDistribution, incomePercentile, incomeDistribution, annualIncomeEstimateGross,
    expenseCategoryComparison, savingsRatePeer, savingsRateUser, savingsRateDiff,
    growthRateInfo, peerMonthlyExpense, expenseDiffVsPeer, expenseDiffPct,
    myReferralCode, incomingReferralCode, premiumUntil, premiumSource, setDashView, isAnonymousUser,
    incomeBracket, incomeBracketAssetPercentile, incomeBracketAssetDistribution,
    incomeBracketPeerMonthlyExpense, incomeBracketExpenseDiff, incomeBracketExpenseDiffPct, incomeBracketSavingsRateDiff,
    primeAssetPercentile, primeAssetDistribution, primeIncomePercentile, primeIncomeDistribution,
    primePeerMonthlyExpense, primeExpenseDiff, primeExpenseDiffPct, primeSavingsRateDiff, primeStatsForAge,
  } = props;
  const [category, setCategory] = useState("age"); // age | income | prime
  const ageStats = AGE_STATS[ageDecade];
  const incomeStats = INCOME_STATS[ageDecade];
  const assetHighlightIdx = findBucketIndex(assetDistribution, totalNetWorth / 10000);
  const incomeHighlightIdx = findBucketIndex(incomeDistribution, annualIncomeEstimateGross / 10000);
  const incomeBracketAssetHighlightIdx = findBucketIndex(incomeBracketAssetDistribution, totalNetWorth / 10000);
  const primeAssetHighlightIdx = findBucketIndex(primeAssetDistribution, totalNetWorth / 10000);
  const primeIncomeHighlightIdx = findBucketIndex(primeIncomeDistribution, annualIncomeEstimateGross / 10000);

  const categories = [
    { key: "age", label: "同年代との比較" },
    { key: "income", label: "同収入との比較" },
    { key: "prime", label: "東証プライム上場企業社員との比較" },
  ];

  const [shareCopied, setShareCopied] = useState(false);
  const [showSharePicker, setShowSharePicker] = useState(false);
  const [shareSel, setShareSel] = useState({
    age_asset: true, age_income: false, age_expense: false, age_savings: false,
    income_asset: false, income_expense: false, income_savings: false,
    prime_asset: false, prime_income: false, prime_expense: false, prime_savings: false,
    showAmounts: false,
  });
  const toggleSel = (key) => setShareSel({ ...shareSel, [key]: !shareSel[key] });
  const medal = (pct) => (pct <= 5 ? "💎" : pct <= 20 ? "🥇" : pct <= 50 ? "🥈" : "🥉");

  const shareGroups = [
    {
      key: "age", label: "同年代との比較", premium: false,
      items: [
        { key: "asset", label: "資産", text: () => `${medal(assetPercentile)}上位${assetPercentile}%${shareSel.showAmounts ? `（¥${fmt(totalNetWorth)}）` : ""}` },
        { key: "income", label: "年収", text: () => `${medal(incomePercentile)}上位${incomePercentile}%${shareSel.showAmounts ? `（¥${fmt(annualIncomeEstimateGross)}）` : ""}`, premium: true },
        { key: "expense", label: "支出", text: () => `${expenseDiffPct > 0 ? "+" : ""}${expenseDiffPct}%`, premium: true },
        { key: "savings", label: "貯蓄率", text: () => `${savingsRateDiff >= 0 ? "+" : ""}${savingsRateDiff}pt`, premium: true },
      ],
    },
    {
      key: "income", label: "同収入との比較", premium: true,
      items: [
        { key: "asset", label: "資産", text: () => `${medal(incomeBracketAssetPercentile)}上位${incomeBracketAssetPercentile}%${shareSel.showAmounts ? `（¥${fmt(totalNetWorth)}）` : ""}` },
        { key: "expense", label: "支出", text: () => `${incomeBracketExpenseDiffPct > 0 ? "+" : ""}${incomeBracketExpenseDiffPct}%` },
        { key: "savings", label: "貯蓄率", text: () => `${incomeBracketSavingsRateDiff >= 0 ? "+" : ""}${incomeBracketSavingsRateDiff}pt` },
      ],
    },
    {
      key: "prime", label: "東証プライム社員との比較", premium: true,
      items: [
        { key: "asset", label: "資産", text: () => `${medal(primeAssetPercentile)}上位${primeAssetPercentile}%${shareSel.showAmounts ? `（¥${fmt(totalNetWorth)}）` : ""}` },
        { key: "income", label: "年収", text: () => `${medal(primeIncomePercentile)}上位${primeIncomePercentile}%${shareSel.showAmounts ? `（¥${fmt(annualIncomeEstimateGross)}）` : ""}` },
        { key: "expense", label: "支出", text: () => `${primeExpenseDiffPct > 0 ? "+" : ""}${primeExpenseDiffPct}%` },
        { key: "savings", label: "貯蓄率", text: () => `${primeSavingsRateDiff >= 0 ? "+" : ""}${primeSavingsRateDiff}pt` },
      ],
    },
  ];

  const buildShareText = () => {
    const lines = ["━━━━━━━━━━"];
    shareGroups.forEach((g) => {
      const picked = g.items.filter((it) => shareSel[`${g.key}_${it.key}`]);
      if (picked.length === 0) return;
      lines.push(g.label);
      picked.forEach((it) => lines.push(`${it.label}：${it.text()}`));
      lines.push("");
    });
    if (lines.length === 1) return null; // 何も選ばれていない
    if (lines[lines.length - 1] === "") lines.pop();
    lines.push("━━━━━━━━━━");
    lines.push("あなたも無料で順位をチェック👇");
    lines.push("https://mybanker-app.vercel.app");
    return lines.join("\n");
  };

  const handleShare = async () => {
    const text = buildShareText();
    if (!text) return;
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { /* キャンセル時など */ }
    }
    navigator.clipboard?.writeText(text);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>ランキング</p>
      <h2 style={styles.h2}>自分の立ち位置を見てみましょう</h2>

      <div style={styles.shareBox}>
        {!showSharePicker ? (
          <button style={styles.shareBtn} onClick={() => setShowSharePicker(true)}>📤 シェアする</button>
        ) : (
          <div style={{ width: "100%" }}>
            <p style={styles.fieldLabel}>シェアしたい項目を選んでください</p>
            {shareGroups.map((g) => (
              <div key={g.key} style={{ marginBottom: 10 }}>
                <p style={styles.shareGroupLabel}>{g.label}{g.premium && !isPremium && "（プレミアム限定）"}</p>
                <div style={styles.shareItemRow}>
                  {g.items.map((it) => {
                    const locked = (g.premium || it.premium) && !isPremium;
                    return (
                      <label key={it.key} style={{ ...styles.shareCheckboxRow, opacity: locked ? 0.4 : 1 }}>
                        <input type="checkbox" disabled={locked} checked={!!shareSel[`${g.key}_${it.key}`]} onChange={() => toggleSel(`${g.key}_${it.key}`)} />
                        <span>{it.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <label style={styles.shareCheckboxRow}>
              <input type="checkbox" checked={shareSel.showAmounts} onChange={() => toggleSel("showAmounts")} />
              <span>金額も表示する</span>
            </label>

            {buildShareText() && (
              <div style={styles.sharePreviewBox}>
                <p style={styles.fieldLabel}>シェアする内容のイメージ</p>
                <pre style={styles.sharePreviewText}>{buildShareText()}</pre>
              </div>
            )}

            <div style={styles.btnRow}>
              <button style={styles.primaryBtn} onClick={handleShare}>{shareCopied ? "コピーしました" : "この内容でシェアする"}</button>
              <button style={styles.ghostBtn} onClick={() => setShowSharePicker(false)}>閉じる</button>
            </div>
          </div>
        )}
      </div>

      <div style={styles.categoryPickerRow}>
        {categories.map((c) => (
          <button key={c.key} onClick={() => setCategory(c.key)} style={category === c.key ? styles.pillActive : styles.pill}>{c.label}</button>
        ))}
      </div>

      {category === "age" && (
        <>
          <p style={styles.chartTitle}>{age5Label}との資産比較</p>
          <div style={styles.percentileRow}>
            <div style={styles.percentileBig}>上位 {assetPercentile}%</div>
            <div style={styles.percentileNote}>総資産（¥{fmt(totalNetWorth)}）が{age5Label}の中でこの位置にいる目安です</div>
          </div>
          {isPremium && (
            <div style={{ marginTop: 16 }}>
              <p style={styles.chartTitle}>総資産の分布（推定モデル）</p>
              <TouchDismissChart><ResponsiveContainer width="100%" height={160}>
                <BarChart data={assetDistribution} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#5C6862" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#5C6862" }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                    {assetDistribution.map((entry, i) => (
                      <Cell key={i} fill={i === assetHighlightIdx ? "#B5582E" : "#3D5A99"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></TouchDismissChart>
              <p style={styles.youAreHereNote}>● オレンジ＝あなたの位置（万円単位の帯）</p>
              <div style={styles.statPairRow}>
                <span>平均 ¥{fmt(ageStats.mean * 10000)}</span>
                <span>中央値 ¥{fmt(ageStats.median * 10000)}</span>
              </div>
              <p style={styles.chartNote}>※ 平均値・中央値から推定した分布モデルで、実際の刻み別統計ではありません。</p>
            </div>
          )}

          <div style={styles.divider} />

          <PaywallGate isPremium={isPremium} setIsPremium={setIsPremium} myReferralCode={myReferralCode} incomingReferralCode={incomingReferralCode} premiumUntil={premiumUntil} premiumSource={premiumSource} setDashView={setDashView} isAnonymousUser={isAnonymousUser}>
            <div>
              <p style={styles.chartTitle}>年収の同年代比較</p>
              <div style={styles.percentileRow}>
                <div style={{ ...styles.percentileBig, fontSize: 22 }}>上位 {incomePercentile}%</div>
                <div style={styles.percentileNote}>想定年収（額面 ¥{fmt(annualIncomeEstimateGross)}）の位置の目安です</div>
              </div>
              <TouchDismissChart><ResponsiveContainer width="100%" height={140}>
                <BarChart data={incomeDistribution} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#5C6862" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#5C6862" }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                    {incomeDistribution.map((entry, i) => (
                      <Cell key={i} fill={i === incomeHighlightIdx ? "#B5582E" : "#A8527A"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></TouchDismissChart>
              <p style={styles.youAreHereNote}>● オレンジ＝あなたの位置（万円単位の帯）</p>
              <div style={styles.statPairRow}>
                <span>平均 ¥{fmt(incomeStats.mean * 10000)}</span>
                <span>中央値 ¥{fmt(incomeStats.median * 10000)}</span>
              </div>
              <p style={styles.chartNote}>※ doda「平均年収ランキング2025」（2025年12月発表）の年代別データを参考にした概算です。60代・70代は同調査の対象外のため独自の概算です。</p>

              <div style={styles.divider} />

              <p style={styles.chartTitle}>支出の同年代比較</p>
              <div style={styles.statusBanner2(expenseDiffVsPeer <= 0)}>
                合計で同年代平均（¥{fmt(peerMonthlyExpense)}）より{expenseDiffVsPeer > 0 ? `¥${fmt(Math.abs(expenseDiffVsPeer))}（+${Math.abs(expenseDiffPct)}%）多い` : `¥${fmt(Math.abs(expenseDiffVsPeer))}（${expenseDiffPct}%）少ない`}目安です
              </div>
              <p style={styles.chartNote}>※ 総務省「家計調査」の単身世帯データを参考にした、総支出の概算です。</p>

              <div style={styles.divider} />

              <p style={styles.chartTitle}>貯蓄率の同年代比較</p>
              <div style={styles.percentileRow}>
                <div style={{ ...styles.percentileBig, fontSize: 22, color: savingsRateDiff >= 0 ? "#2F6B4F" : "#9A4A1F" }}>{savingsRateDiff >= 0 ? "+" : ""}{savingsRateDiff}pt</div>
                <div style={styles.percentileNote}>あなたの貯蓄率は{savingsRateUser}%、同年代平均は{savingsRatePeer}%です</div>
              </div>

              <div style={styles.divider} />

              <p style={styles.chartTitle}>資産成長率ランキング</p>
              {growthRateInfo ? (
                <div style={styles.percentileRow}>
                  <div style={{ ...styles.percentileBig, fontSize: 22, color: growthRateInfo.aboveBenchmark ? "#2F6B4F" : "#9A4A1F" }}>{growthRateInfo.growthPct}%</div>
                  <div style={styles.percentileNote}>記録を始めてからの資産増加率。一般的な資産形成ペースの目安（年率{growthRateInfo.benchmark}%）と比べて{growthRateInfo.aboveBenchmark ? "順調なペース" : "やや緩やかなペース"}です</div>
                </div>
              ) : (
                <p style={styles.hint}>資産記録を2回以上登録すると、成長率が表示されます。</p>
              )}
            </div>
          </PaywallGate>
        </>
      )}

      {category === "income" && (
        <>
          <p style={styles.chartTitle}>同収入帯（{incomeBracket.label}）との比較</p>
          <div style={styles.percentileRow}>
            <div style={styles.percentileBig}>上位 {incomeBracketAssetPercentile}%</div>
            <div style={styles.percentileNote}>総資産（¥{fmt(totalNetWorth)}）が同じ収入帯の中でこの位置にいる目安です</div>
          </div>
          {isPremium && (
            <div style={{ marginTop: 16 }}>
              <p style={styles.chartTitle}>総資産の分布（推定モデル）</p>
              <TouchDismissChart><ResponsiveContainer width="100%" height={160}>
                <BarChart data={incomeBracketAssetDistribution} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#5C6862" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#5C6862" }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                    {incomeBracketAssetDistribution.map((entry, i) => (
                      <Cell key={i} fill={i === incomeBracketAssetHighlightIdx ? "#B5582E" : "#3D5A99"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></TouchDismissChart>
              <p style={styles.youAreHereNote}>● オレンジ＝あなたの位置（万円単位の帯）</p>
              <div style={styles.statPairRow}>
                <span>平均 ¥{fmt(incomeBracket.assetMean * 10000)}</span>
                <span>中央値 ¥{fmt(incomeBracket.assetMedian * 10000)}</span>
              </div>
              <p style={styles.chartNote}>※ 年収帯ごとの資産・収入の相関傾向を踏まえた推定モデルです。実際の刻み別統計ではありません。</p>
            </div>
          )}

          <div style={styles.divider} />

          <PaywallGate isPremium={isPremium} setIsPremium={setIsPremium} myReferralCode={myReferralCode} incomingReferralCode={incomingReferralCode} premiumUntil={premiumUntil} premiumSource={premiumSource} setDashView={setDashView} isAnonymousUser={isAnonymousUser}>
            <div>
              <p style={styles.chartTitle}>支出の同収入帯比較</p>
              <div style={styles.statusBanner2(incomeBracketExpenseDiff <= 0)}>
                合計で同収入帯平均（¥{fmt(incomeBracketPeerMonthlyExpense)}）より{incomeBracketExpenseDiff > 0 ? `¥${fmt(Math.abs(incomeBracketExpenseDiff))}（+${Math.abs(incomeBracketExpenseDiffPct)}%）多い` : `¥${fmt(Math.abs(incomeBracketExpenseDiff))}（${incomeBracketExpenseDiffPct}%）少ない`}目安です
              </div>
              <p style={styles.chartNote}>※ 同じ年収帯の人と比べた、総支出の概算です。</p>

              <div style={styles.divider} />

              <p style={styles.chartTitle}>貯蓄率の同収入帯比較</p>
              <div style={styles.percentileRow}>
                <div style={{ ...styles.percentileBig, fontSize: 22, color: incomeBracketSavingsRateDiff >= 0 ? "#2F6B4F" : "#9A4A1F" }}>{incomeBracketSavingsRateDiff >= 0 ? "+" : ""}{incomeBracketSavingsRateDiff}pt</div>
                <div style={styles.percentileNote}>あなたの貯蓄率は{savingsRateUser}%、同収入帯平均は{incomeBracket.savingsRate}%です</div>
              </div>
              <p style={styles.chartNote}>※ 年収帯と資産・貯蓄率の一般的な相関傾向を踏まえた推定値です（単一の公的統計ではありません）。</p>
            </div>
          </PaywallGate>
        </>
      )}

      {category === "prime" && (
        <>
          <p style={styles.chartTitle}>東証プライム上場企業の{age5Label}社員との比較</p>
          <div style={styles.percentileRow}>
            <div style={styles.percentileBig}>上位 {primeAssetPercentile}%</div>
            <div style={styles.percentileNote}>総資産（¥{fmt(totalNetWorth)}）がプライム上場企業の同年代社員の中でこの位置にいる目安です</div>
          </div>
          {isPremium && (
            <div style={{ marginTop: 16 }}>
              <p style={styles.chartTitle}>総資産の分布（推定モデル）</p>
              <TouchDismissChart><ResponsiveContainer width="100%" height={160}>
                <BarChart data={primeAssetDistribution} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#5C6862" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#5C6862" }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                    {primeAssetDistribution.map((entry, i) => (
                      <Cell key={i} fill={i === primeAssetHighlightIdx ? "#B5582E" : "#3D5A99"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></TouchDismissChart>
              <p style={styles.youAreHereNote}>● オレンジ＝あなたの位置（万円単位の帯）</p>
              <div style={styles.statPairRow}>
                <span>平均 ¥{fmt(primeStatsForAge.assetMean * 10000)}</span>
                <span>中央値 ¥{fmt(primeStatsForAge.assetMedian * 10000)}</span>
              </div>
              <p style={styles.chartNote}>※ 東証プライム上場企業社員の年代別資産統計は公表されていないため、全体平均に年代カーブを掛けた推定値です。</p>
            </div>
          )}

          <div style={styles.divider} />

          <PaywallGate isPremium={isPremium} setIsPremium={setIsPremium} myReferralCode={myReferralCode} incomingReferralCode={incomingReferralCode} premiumUntil={premiumUntil} premiumSource={premiumSource} setDashView={setDashView} isAnonymousUser={isAnonymousUser}>
            <div>
              <p style={styles.chartTitle}>年収の比較</p>
              <div style={styles.percentileRow}>
                <div style={{ ...styles.percentileBig, fontSize: 22 }}>上位 {primeIncomePercentile}%</div>
                <div style={styles.percentileNote}>想定年収（額面 ¥{fmt(annualIncomeEstimateGross)}）の位置の目安です</div>
              </div>
              <TouchDismissChart><ResponsiveContainer width="100%" height={140}>
                <BarChart data={primeIncomeDistribution} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#5C6862" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#5C6862" }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                    {primeIncomeDistribution.map((entry, i) => (
                      <Cell key={i} fill={i === primeIncomeHighlightIdx ? "#B5582E" : "#A8527A"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></TouchDismissChart>
              <p style={styles.youAreHereNote}>● オレンジ＝あなたの位置（万円単位の帯）</p>
              <div style={styles.statPairRow}>
                <span>平均 ¥{fmt(primeStatsForAge.incomeMean * 10000)}</span>
                <span>中央値 ¥{fmt(primeStatsForAge.incomeMedian * 10000)}</span>
              </div>
              <p style={styles.chartNote}>※ 全体平均（出典：帝国データバンク「上場企業の『平均年間給与』動向調査（2024年度決算）」東証プライム上場企業平均763.3万円）に、一般的な大企業の年功カーブを掛けた年代別の推定値です。</p>

              <div style={styles.divider} />

              <p style={styles.chartTitle}>支出の比較</p>
              <div style={styles.statusBanner2(primeExpenseDiff <= 0)}>
                合計でプライム上場企業の同年代社員平均（¥{fmt(primePeerMonthlyExpense)}）より{primeExpenseDiff > 0 ? `¥${fmt(Math.abs(primeExpenseDiff))}（+${Math.abs(primeExpenseDiffPct)}%）多い` : `¥${fmt(Math.abs(primeExpenseDiff))}（${primeExpenseDiffPct}%）少ない`}目安です
              </div>

              <div style={styles.divider} />

              <p style={styles.chartTitle}>貯蓄率の比較</p>
              <div style={styles.percentileRow}>
                <div style={{ ...styles.percentileBig, fontSize: 22, color: primeSavingsRateDiff >= 0 ? "#2F6B4F" : "#9A4A1F" }}>{primeSavingsRateDiff >= 0 ? "+" : ""}{primeSavingsRateDiff}pt</div>
                <div style={styles.percentileNote}>あなたの貯蓄率は{savingsRateUser}%、プライム上場企業の同年代社員平均は{primeStatsForAge.savingsRate}%です</div>
              </div>
              <p style={styles.chartNote}>※ 支出・貯蓄率は年収水準からの推定値で、プライム上場企業社員を対象とした直接の統計ではありません。</p>
            </div>
          </PaywallGate>
        </>
      )}
    </div>
  );
}

function AllocRow({ label, pctValue, onChange, amount, note, accent }) {
  return (
    <div style={styles.allocRow}>
      <div style={styles.allocLeft}>
        <div style={{ ...styles.ledgerLabel, color: accent }}>{label}</div>
        {note && <div style={styles.ledgerNote}>{note}</div>}
      </div>
      <div style={styles.allocRight}>
        <div style={styles.fieldInputRow}><NumInput value={pctValue} onChange={onChange} /><span style={styles.suffix}>%</span></div>
        <div style={styles.allocPct}>¥{fmt(amount)}</div>
      </div>
    </div>
  );
}

function BonusAllocRow({ label, pctValue, onChange, amount, accent }) {
  return (
    <div style={styles.allocRow}>
      <div style={styles.allocLeft}><div style={{ ...styles.ledgerLabel, color: accent }}>{label}</div></div>
      <div style={styles.allocRight}>
        <div style={styles.fieldInputRow}><NumInput value={pctValue} onChange={onChange} /><span style={styles.suffix}>%</span></div>
        <div style={styles.allocPct}>¥{fmt(amount)}</div>
      </div>
    </div>
  );
}

function SimulatorPanel({ monthlyFree, totalExpense, bonusHandling, bonusAnnualNet, alloc, setAlloc, setAllocTouched, allocNums, allocTotal, allocOver, allocUnder, bonusAlloc, setBonusAlloc, bonusAllocNums, bonusPctTotal, riskProfile, setRiskProfile, projection, furusatoApprox, annualIncomeEstimateNet, annualIncomeEstimateGross, resetAllocToDefault, holdings, nisaSplits, setNisaSplits, nisaSplitTotal, nisaSplitPctTotal, nisaUnassignedAmount, nisaSplitOver, projectionSeriesKeys, SERIES_COLORS, otherAssets, otherHoldingInput, setOtherHoldingInput, nisaPlanIds, addHoldingToPlan, removeHoldingFromPlan, addNewHoldingToPlan, otherPlanKeys, addOtherAssetToPlan, removeOtherAssetFromPlan, addNewOtherAssetToPlan, otherSplits, setOtherSplits, otherSplitTotal, otherSplitPctTotal, otherUnassignedAmount, otherSplitOver }) {
  const [showAddHolding, setShowAddHolding] = useState(false);
  const [showAddOtherHolding, setShowAddOtherHolding] = useState(false);
  const [newHoldingName, setNewHoldingName] = useState("");
  const [newHoldingRate, setNewHoldingRate] = useState("");
  const [newOtherName, setNewOtherName] = useState("");
  const [newOtherRate, setNewOtherRate] = useState("");
  const onChangeAlloc = (key) => (e) => { setAllocTouched(true); setAlloc({ ...alloc, [key]: e.target.value }); };
  const onChangeBonusAlloc = (key) => (e) => setBonusAlloc({ ...bonusAlloc, [key]: e.target.value });
  const onChangeNisaSplit = (holdingId) => (e) => setNisaSplits({ ...nisaSplits, [holdingId]: e.target.value });
  const onChangeOtherSplit = (key) => (e) => setOtherSplits({ ...otherSplits, [key]: e.target.value });

  const planHoldings = holdings.filter((h) => nisaPlanIds.includes(h.id));
  const availableHoldings = holdings.filter((h) => !nisaPlanIds.includes(h.id));
  const planOtherAssets = otherAssets.filter((x) => otherPlanKeys.includes(x.key) && x.label);
  const availableOtherAssets = otherAssets.filter((x) => !otherPlanKeys.includes(x.key) && x.label);

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>配分シミュレーター</p>
      <h2 style={styles.h2}>毎月の自由資金 ¥{fmt(monthlyFree)} を自分で配分してみましょう</h2>
      <p style={styles.calcNote}>
        {bonusHandling === "smooth"
          ? `自由資金 ＝（想定年収（手取り） ¥${fmt(annualIncomeEstimateNet)} − 年間支出 ¥${fmt(totalExpense * 12)}）÷ 12`
          : `自由資金 ＝ 月の手取り − 支出（ボーナスは別枠で配分案を表示）`}
      </p>

      <div style={styles.riskPickerRow}>
        <div style={styles.riskPicker}>
          {Object.entries(RISK_PROFILES).map(([key, p]) => (
            <button key={key} onClick={() => setRiskProfile(key)} style={riskProfile === key ? styles.pillActive : styles.pill}>{p.label}</button>
          ))}
        </div>
        <button style={styles.resetLink} onClick={resetAllocToDefault}>コースの目安配分に戻す</button>
      </div>
      <p style={styles.hint}>{RISK_PROFILES[riskProfile].mix}（年率{(RISK_PROFILES[riskProfile].rate * 100).toFixed(1)}%目安）</p>

      <div style={styles.allocList}>
        <AllocRow label="貯金（緊急・将来資金）" pctValue={alloc.savings} onChange={onChangeAlloc("savings")} amount={allocNums.savings} accent="#2F6B4F" />
        <AllocRow label="株式投資（NISAなど）" pctValue={alloc.nisa} onChange={onChangeAlloc("nisa")} amount={allocNums.nisa} note="つみたて投資枠・成長投資枠・特定口座などを含めて自由に%を決められます" accent="#3D5A99" />

        <div style={styles.nisaTargetBox}>
          <span style={styles.fieldLabel}>この株式投資額（¥{fmt(allocNums.nisa)}）を、積立対象に選んだ銘柄に分けて%で割り当てられます（任意）</span>
          {planHoldings.length === 0 ? (
            <p style={styles.hint}>まだ積立対象の銘柄が選ばれていないので、追加投資はコースの想定利率（{(RISK_PROFILES[riskProfile].rate * 100).toFixed(1)}%）で計算されます。</p>
          ) : (
            <>
              {planHoldings.map((h) => (
                <div key={h.id} style={styles.nisaSplitRow}>
                  <span style={styles.nisaSplitLabel}>{h.name}（年率{h.rate}%）</span>
                  <div style={styles.allocRight}>
                    <div style={styles.fieldInputRow}>
                      <NumInput value={nisaSplits[h.id] || ""} onChange={onChangeNisaSplit(h.id)} placeholder="0" />
                      <span style={styles.suffix}>%</span>
                    </div>
                    <div style={styles.allocPct}>¥{fmt(allocNums.nisa * ((Number(nisaSplits[h.id]) || 0) / 100))}</div>
                    <button style={styles.removeBtn} onClick={() => removeHoldingFromPlan(h.id)} title="積立対象から外す（保有資産からは削除されません）">×</button>
                  </div>
                </div>
              ))}
              <div style={{ ...styles.allocTotalBar, ...(nisaSplitOver ? styles.allocTotalError : {}) }}>
                銘柄への割り当て合計：{Math.round(nisaSplitPctTotal)}%（¥{fmt(nisaSplitTotal)} / ¥{fmt(allocNums.nisa)}）
                {nisaSplitOver && <span style={styles.errorText}>　100%を超えています。</span>}
              </div>
              <p style={styles.hint}>
                残り ¥{fmt(nisaUnassignedAmount)} は未割り当てとして、コースの想定利率（{(RISK_PROFILES[riskProfile].rate * 100).toFixed(1)}%）で計算されます。積立対象でなくても、保有資産に登録済みの銘柄はそれぞれ自分自身の利率で成長し続けます。
              </p>
            </>
          )}

          {!showAddHolding ? (
            <button style={styles.addRowBtn} onClick={() => setShowAddHolding(true)}>+ 銘柄を追加する</button>
          ) : (
            <div style={{ marginTop: 12 }}>
              {availableHoldings.length > 0 && (
                <>
                  <p style={styles.fieldLabel}>保有資産に登録済みの銘柄から選ぶ（年率は保有資産の設定がそのまま使われます）</p>
                  <div style={styles.pickerList}>
                    {availableHoldings.map((h) => (
                      <button key={h.id} style={styles.pickerItemBtn} onClick={() => { addHoldingToPlan(h.id); setShowAddHolding(false); }}>
                        + {h.name}（年率{h.rate}%）
                      </button>
                    ))}
                  </div>
                  <div style={styles.divider} />
                </>
              )}
              <p style={styles.fieldLabel}>まだ保有していない銘柄を新しく追加する</p>
              <div style={styles.grid2}>
                <Field label="商品名" value={newHoldingName} onChange={(e) => setNewHoldingName(e.target.value)} type="text" hint="例：eMAXIS Slim 全世界株式" />
                <Field label="想定年率" value={newHoldingRate} onChange={(e) => setNewHoldingRate(e.target.value)} suffix="%" />
              </div>
              <div style={styles.btnRow}>
                <button style={styles.primaryBtn} onClick={() => {
                  if (!newHoldingName) return;
                  addNewHoldingToPlan(newHoldingName, newHoldingRate);
                  setNewHoldingName(""); setNewHoldingRate("");
                  setShowAddHolding(false);
                }}>登録する</button>
                <button style={styles.ghostBtn} onClick={() => setShowAddHolding(false)}>閉じる</button>
              </div>
            </div>
          )}
        </div>

        <AllocRow label="その他運用" pctValue={alloc.other} onChange={onChangeAlloc("other")} amount={allocNums.other} note="暗号資産、FX、ポイントなど" accent="#7A5C3D" />

        <div style={styles.nisaTargetBox}>
          <span style={styles.fieldLabel}>このその他運用額（¥{fmt(allocNums.other)}）も、積立対象に選んだ項目に分けて%で割り当てられます（任意）</span>
          {planOtherAssets.length === 0 ? (
            <p style={styles.hint}>まだ積立対象の項目が選ばれていないので、追加投資はコースの想定利率（{(RISK_PROFILES[riskProfile].rate * 100).toFixed(1)}%）で計算されます。</p>
          ) : (
            <>
              {planOtherAssets.map((x) => (
                <div key={x.key} style={styles.nisaSplitRow}>
                  <span style={styles.nisaSplitLabel}>{x.label}（年率{x.rate}%）</span>
                  <div style={styles.allocRight}>
                    <div style={styles.fieldInputRow}>
                      <NumInput value={otherSplits[x.key] || ""} onChange={onChangeOtherSplit(x.key)} placeholder="0" />
                      <span style={styles.suffix}>%</span>
                    </div>
                    <div style={styles.allocPct}>¥{fmt(allocNums.other * ((Number(otherSplits[x.key]) || 0) / 100))}</div>
                    <button style={styles.removeBtn} onClick={() => removeOtherAssetFromPlan(x.key)} title="積立対象から外す（保有資産からは削除されません）">×</button>
                  </div>
                </div>
              ))}
              <div style={{ ...styles.allocTotalBar, ...(otherSplitOver ? styles.allocTotalError : {}) }}>
                項目への割り当て合計：{Math.round(otherSplitPctTotal)}%（¥{fmt(otherSplitTotal)} / ¥{fmt(allocNums.other)}）
                {otherSplitOver && <span style={styles.errorText}>　100%を超えています。</span>}
              </div>
              <p style={styles.hint}>
                残り ¥{fmt(otherUnassignedAmount)} は未割り当てとして、コースの想定利率（{(RISK_PROFILES[riskProfile].rate * 100).toFixed(1)}%）で計算されます。
              </p>
            </>
          )}

          {!showAddOtherHolding ? (
            <button style={styles.addRowBtn} onClick={() => setShowAddOtherHolding(true)}>+ 項目を追加する</button>
          ) : (
            <div style={{ marginTop: 12 }}>
              {availableOtherAssets.length > 0 && (
                <>
                  <p style={styles.fieldLabel}>保有資産に登録済みの項目から選ぶ（年率は保有資産の設定がそのまま使われます）</p>
                  <div style={styles.pickerList}>
                    {availableOtherAssets.map((x) => (
                      <button key={x.key} style={styles.pickerItemBtn} onClick={() => { addOtherAssetToPlan(x.key); setShowAddOtherHolding(false); }}>
                        + {x.label}（年率{x.rate}%）
                      </button>
                    ))}
                  </div>
                  <div style={styles.divider} />
                </>
              )}
              <p style={styles.fieldLabel}>まだ保有していない項目を新しく追加する（例：暗号資産、FX、ポイントなど）</p>
              <div style={styles.grid2}>
                <Field label="項目名" value={newOtherName} onChange={(e) => setNewOtherName(e.target.value)} type="text" hint="例：ビットコイン、ポイント運用" />
                <Field label="想定年率" value={newOtherRate} onChange={(e) => setNewOtherRate(e.target.value)} suffix="%" />
              </div>
              <div style={styles.btnRow}>
                <button style={styles.primaryBtn} onClick={() => {
                  if (!newOtherName) return;
                  addNewOtherAssetToPlan(newOtherName, newOtherRate);
                  setNewOtherName(""); setNewOtherRate("");
                  setShowAddOtherHolding(false);
                }}>登録する</button>
                <button style={styles.ghostBtn} onClick={() => setShowAddOtherHolding(false)}>閉じる</button>
              </div>
            </div>
          )}
        </div>

        <AllocRow label="自由に使えるお金" pctValue={alloc.free} onChange={onChangeAlloc("free")} amount={allocNums.free} accent="#5C6862" />
      </div>

      <div style={{ ...styles.allocTotalBar, ...(allocOver ? styles.allocTotalError : {}) }}>
        合計：{Math.round(allocTotal)}%（¥{fmt(allocNums.savings + allocNums.nisa + allocNums.other + allocNums.free)} / ¥{fmt(monthlyFree)}）
        {allocOver && <span style={styles.errorText}>　100%を超えています。</span>}
        {allocUnder && <span style={styles.warnText}>　まだ {Math.round(100 - allocTotal)}% 配分されていません。</span>}
      </div>

      {bonusHandling === "lump" && bonusAnnualNet > 0 && (
        <div style={styles.bonusBlock}>
          <p style={styles.chartTitle}>ボーナス受け取り時の配分案（年間 ¥{fmt(bonusAnnualNet)}・手取り換算）</p>
          <div style={styles.allocList}>
            <BonusAllocRow label="貯金へ" pctValue={bonusAlloc.savings} onChange={onChangeBonusAlloc("savings")} amount={bonusAllocNums.savings} accent="#2F6B4F" />
            <BonusAllocRow label="株式投資（NISAなど）へ" pctValue={bonusAlloc.nisa} onChange={onChangeBonusAlloc("nisa")} amount={bonusAllocNums.nisa} accent="#3D5A99" />
            <BonusAllocRow label="その他運用へ" pctValue={bonusAlloc.other} onChange={onChangeBonusAlloc("other")} amount={bonusAllocNums.other} accent="#7A5C3D" />
            <BonusAllocRow label="自由に使うお金へ" pctValue={bonusAlloc.free} onChange={onChangeBonusAlloc("free")} amount={bonusAllocNums.free} accent="#5C6862" />
          </div>
          <div style={{ ...styles.allocTotalBar, ...(bonusPctTotal !== 100 ? styles.allocTotalError : {}) }}>合計：{bonusPctTotal}%{bonusPctTotal !== 100 && <span style={styles.errorText}>　100%になるよう調整してください。</span>}</div>
        </div>
      )}

      <div style={styles.chartCard}>
        <p style={styles.chartTitle}>資産の推移予想（銘柄ごとの利率を反映）</p>
        <TouchDismissChart><ResponsiveContainer width="100%" height={260}>
          <AreaChart data={projection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#5C6862" }} />
            <YAxis tick={{ fontSize: 11, fill: "#5C6862" }} tickFormatter={fmtManOku} />
            <Tooltip content={<TotalTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="貯金" stackId="1" stroke="#2F6B4F" fill="#9FC4AC" />
            {projectionSeriesKeys.map((key, i) => (
              <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.45} />
            ))}
          </AreaChart>
        </ResponsiveContainer></TouchDismissChart>
        <p style={styles.chartNote}>※ 株式投資（銘柄ごと・新規投資）もその他資産（暗号資産・FXなど）も、想定年率での複利計算による概算です。将来の成果を保証するものではありません。</p>
      </div>

      <div style={styles.furusatoCard}>
        <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>想定年収（額面）</span><span style={styles.furusatoValue}>¥{fmt(annualIncomeEstimateGross)}</span></div>
        <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>想定年収（手取り）</span><span style={styles.furusatoValue}>¥{fmt(annualIncomeEstimateNet)}</span></div>
        <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>ふるさと納税の目安額</span><span style={styles.furusatoValue}>¥{fmt(furusatoApprox)} / 年</span></div>
      </div>
    </div>
  );
}

function HoldingsPanel({ assetInput, setAssetInput, addAssetLog, assetLogs, updateAssetLog, updateAssetLogItemAmount, deleteAssetLog, goalCompareData, impliedSpendingInfo, holdings, setHoldings, addHoldingRow, updateHoldingField, removeHoldingRow, totalHoldingsValue, otherAssets, updateOtherAsset, updateOtherAssetLabel, updateOtherAssetRate, addOtherAssetRow, removeOtherAsset, otherAssetsTotal, monthlyIncomeComputed, resetPlanBaseline }) {
  const last = assetLogs[assetLogs.length - 1];
  const [openLogId, setOpenLogId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const handleSave = () => { addAssetLog(); setSaveToast(true); setTimeout(() => setSaveToast(false), 2000); };
  const todayLabel = new Date().toLocaleDateString("ja-JP");
  const sortedLogs = [...assetLogs].sort((a, b) => b.id - a.id);
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>保有資産</p>
      <h2 style={styles.h2}>資産を更新・登録しましょう</h2>

      <div style={styles.summaryItemLg}>
        <span style={styles.summaryLabel}>合計資産（貯金＋株式・投資信託＋その他資産）</span>
        <span style={styles.summaryValueLg}>¥{fmt((Number(assetInput.savings) || 0) + totalHoldingsValue + otherAssetsTotal)}</span>
      </div>

      <p style={styles.hint}>本日（{todayLabel}）の記録としてこの内容が保存されます。同じ日にもう一度記録すると、その日の内容が更新されます。</p>

      <p style={styles.chartTitle}>資産カテゴリ</p>
      <div style={styles.grid2}>
        <Field label="貯金・現金" value={assetInput.savings} onChange={(e) => setAssetInput({ ...assetInput, savings: e.target.value })} suffix="円" />
        <div style={styles.field}>
          <span style={styles.fieldLabel}>株式・投資信託（下の個別登録から自動計算）</span>
          <div style={styles.readOnlyValueRow}>¥{fmt(totalHoldingsValue)}</div>
        </div>
        <div style={styles.field}>
          <span style={styles.fieldLabel}>その他資産（下の項目から自動計算）</span>
          <div style={styles.readOnlyValueRow}>¥{fmt(otherAssetsTotal)}</div>
        </div>
      </div>
      {impliedSpendingInfo && (
        <div style={styles.statusBanner2(impliedSpendingInfo.impliedSpending <= 0)}>
          前回記録（{impliedSpendingInfo.prevDate}）から{impliedSpendingInfo.lastDate}まで（{impliedSpendingInfo.daysElapsed}日間）、今期の実質支出は約 ¥{fmt(impliedSpendingInfo.impliedSpending)} と推定されます。
          <div style={styles.calcNote}>
            計算式：この期間の概算収入（ボーナス除く） ¥{fmt(impliedSpendingInfo.proratedIncome)} − 貯金の増減 ¥{fmt(impliedSpendingInfo.cashChange)} − {impliedSpendingInfo.hasPlan ? "積立設定に基づく投資額" : "投資への積立額（未設定のため¥0として概算）"} ¥{fmt(impliedSpendingInfo.proratedInvestment)}
          </div>
          {!impliedSpendingInfo.hasPlan && (
            <p style={styles.hint}>※「積立プランを決める」を設定すると、株価の変動に影響されない、より正確な支出推定になります。</p>
          )}
        </div>
      )}

      {sortedLogs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          {!showHistory ? (
            <button style={styles.smallLinkBtn} onClick={() => setShowHistory(true)}>過去のデータを確認/編集する</button>
          ) : (
            <>
              <div style={styles.chartTitleRow}>
                <p style={styles.chartTitle}>資産の記録履歴（内訳・銘柄ごとも含む）</p>
                <button style={styles.smallLinkBtn} onClick={() => setShowHistory(false)}>閉じる</button>
              </div>
              <div style={styles.ledger}>
                {sortedLogs.map((l) => (
                  <div key={l.id}>
                    <div style={styles.historyRow} onClick={() => setOpenLogId(openLogId === l.id ? null : l.id)}>
                      <span style={styles.ledgerLabel}>{l.date}</span>
                      <span style={styles.ledgerValue}>¥{fmt(l.total)}</span>
                    </div>
                    {openLogId === l.id && (
                      <div style={styles.historyDetail}>
                        <Field label="貯金・現金" value={l.savings} onChange={(e) => updateAssetLog(l.id, "savings", e.target.value)} suffix="円" />

                        {l.holdingItems && l.holdingItems.length > 0 && (
                          <>
                            <p style={styles.chartTitle}>株式・投資信託の内訳（この日のスナップショット）</p>
                            {l.holdingItems.map((it, i) => (
                              <div key={i} style={styles.ledgerRow}>
                                <span style={styles.ledgerLabel}>{it.name}（年率{it.rate}%）</span>
                                <div style={styles.fieldInputRow}>
                                  <NumInput value={it.amount} onChange={(e) => updateAssetLogItemAmount(l.id, "holdingItems", i, e.target.value)} />
                                  <span style={styles.suffix}>円</span>
                                </div>
                              </div>
                            ))}
                          </>
                        )}

                        {l.otherItems && l.otherItems.length > 0 && (
                          <>
                            <p style={styles.chartTitle}>その他資産の内訳（この日のスナップショット）</p>
                            {l.otherItems.map((it, i) => (
                              <div key={i} style={styles.ledgerRow}>
                                <span style={styles.ledgerLabel}>{it.label}</span>
                                <div style={styles.fieldInputRow}>
                                  <NumInput value={it.amount} onChange={(e) => updateAssetLogItemAmount(l.id, "otherItems", i, e.target.value)} />
                                  <span style={styles.suffix}>円</span>
                                </div>
                              </div>
                            ))}
                          </>
                        )}

                        <button style={styles.deleteLogBtn} onClick={() => { deleteAssetLog(l.id); setOpenLogId(null); }}>この記録を削除する</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div style={styles.divider} />
      <p style={styles.chartTitle}>その他資産</p>
      <OtherAssetsEditor
        otherAssets={otherAssets} updateOtherAsset={updateOtherAsset} updateOtherAssetLabel={updateOtherAssetLabel} updateOtherAssetRate={updateOtherAssetRate}
        addOtherAssetRow={addOtherAssetRow} removeOtherAsset={removeOtherAsset} otherAssetsTotal={otherAssetsTotal}
      />

      <div style={styles.divider} />
      <p style={styles.chartTitle}>株式・投資信託（個別の保有資産を登録）</p>
      <HoldingsEditor
        holdings={holdings} setHoldings={setHoldings} addHoldingRow={addHoldingRow} updateHoldingField={updateHoldingField}
        removeHoldingRow={removeHoldingRow} totalHoldingsValue={totalHoldingsValue}
      />

      <div style={styles.divider} />
      {saveToast && <div style={styles.toastBanner}>保存しました ✓</div>}
      <button style={{ ...styles.primaryBtn, width: "100%" }} onClick={handleSave}>{todayLabel}の記録として保存する</button>
      <p style={styles.hint}>貯金、その他資産、株式・投資信託、すべての入力・編集が終わったら、このボタンを押してください。</p>
    </div>
  );
}

function IncomeTrackPanel({ incomeLogInput, setIncomeLogInput, addIncomeLog, incomeLogs, incomeProjection }) {
  const monthLabel = (m) => `${m}月`;
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>収入実績</p>
      <h2 style={styles.h2}>月ごとの収入実績を記録しましょう</h2>
      <p style={styles.lead}>始めた月より前の分も、月を選んでまとめて遡って入力できます。同じ月を選んで記録すると、その月の内容が更新されます。</p>

      <div style={styles.field}>
        <span style={styles.fieldLabel}>記録する月</span>
        <div style={styles.monthGrid}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <button key={m} onClick={() => setIncomeLogInput({ ...incomeLogInput, month: String(m) })}
              style={incomeLogInput.month === String(m) ? styles.monthBtnActive : styles.monthBtn}>
              {monthLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...styles.grid2, marginTop: 16 }}>
        <Field label="その月の額面" value={incomeLogInput.gross} onChange={(e) => setIncomeLogInput({ ...incomeLogInput, gross: e.target.value })} suffix="円" />
        <Field label="その月の手取り" value={incomeLogInput.takehome} onChange={(e) => setIncomeLogInput({ ...incomeLogInput, takehome: e.target.value })} suffix="円" />
      </div>

      <label style={styles.checkboxRow2}>
        <input type="checkbox" checked={incomeLogInput.hasBonus} onChange={(e) => setIncomeLogInput({ ...incomeLogInput, hasBonus: e.target.checked })} />
        <span>この月にボーナスを受け取った</span>
      </label>
      {incomeLogInput.hasBonus && (
        <Field label="ボーナス額" value={incomeLogInput.bonus} onChange={(e) => setIncomeLogInput({ ...incomeLogInput, bonus: e.target.value })} suffix="円" />
      )}

      <button style={{ ...styles.primaryBtn, marginTop: 16 }} onClick={addIncomeLog}>{monthLabel(incomeLogInput.month)}の実績を記録する</button>

      {incomeProjection.monthsLogged > 0 && (
        <div style={styles.furusatoCard}>
          <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>実績記録月数</span><span style={styles.furusatoValue}>{incomeProjection.monthsLogged}ヶ月</span></div>
          <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>記録済みの手取り平均月収</span><span style={styles.furusatoValue}>¥{fmt(incomeProjection.avgTakehome)}</span></div>
          <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>今年度の想定手取り年収</span><span style={styles.furusatoValue}>¥{fmt(incomeProjection.projectedTakehome + incomeProjection.sumBonus)}</span></div>
          <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>今年度の想定額面年収</span><span style={styles.furusatoValue}>¥{fmt(incomeProjection.projectedGross)}</span></div>
        </div>
      )}

      {incomeLogs.length > 0 && (
        <div style={{ ...styles.ledger, marginTop: 18 }}>
          {incomeLogs.map((l, i) => (
            <div key={i} style={styles.ledgerRow}>
              <div style={styles.ledgerLabel}>{l.month}月</div>
              <div style={styles.ledgerNote}>額面 ¥{fmt(l.gross)} ／ 手取り ¥{fmt(l.takehome)} ／ ボーナス ¥{fmt(l.bonus)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpenseTrackPanel({ expenseLogInput, setExpenseLogInput, expenseLogItems, setExpenseLogItems, addExpenseLog, expenseLogs, expenseProjection }) {
  const monthLabel = (m) => `${m}月`;
  const updateItem = (key) => (e) => setExpenseLogItems(expenseLogItems.map((x) => (x.key === key ? { ...x, amount: e.target.value } : x)));
  const updateItemLabel = (key) => (e) => setExpenseLogItems(expenseLogItems.map((x) => (x.key === key ? { ...x, label: e.target.value } : x)));
  const addItemRow = () => setExpenseLogItems([...expenseLogItems, { key: "custom-" + Date.now(), label: "", amount: "0", custom: true }]);
  const removeItemRow = (key) => setExpenseLogItems(expenseLogItems.filter((x) => x.key !== key));
  const itemsTotal = expenseLogItems.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>支出実績</p>
      <h2 style={styles.h2}>月ごとの支出実績を記録しましょう</h2>
      <p style={styles.lead}>始めた月より前の分も、月を選んでまとめて遡って入力できます。</p>

      <div style={styles.field}>
        <span style={styles.fieldLabel}>記録する月</span>
        <div style={styles.monthGrid}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <button key={m} onClick={() => setExpenseLogInput({ ...expenseLogInput, month: String(m) })}
              style={expenseLogInput.month === String(m) ? styles.monthBtnActive : styles.monthBtn}>
              {monthLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...styles.toggleRow, marginTop: 16 }}>
        <button style={expenseLogInput.mode === "simple" ? styles.toggleActive : styles.toggleInactive} onClick={() => setExpenseLogInput({ ...expenseLogInput, mode: "simple" })}>まとめて入力</button>
        <button style={expenseLogInput.mode === "items" ? styles.toggleActive : styles.toggleInactive} onClick={() => setExpenseLogInput({ ...expenseLogInput, mode: "items" })}>項目ごとに入力</button>
      </div>

      {expenseLogInput.mode === "simple" ? (
        <Field label={`${monthLabel(expenseLogInput.month)}の支出合計`} value={expenseLogInput.total} onChange={(e) => setExpenseLogInput({ ...expenseLogInput, total: e.target.value })} suffix="円" />
      ) : (
        <div style={styles.expenseList}>
          {expenseLogItems.map((x) => (
            <div key={x.key} style={styles.expenseRow}>
              <input style={styles.expenseLabelInput} value={x.label} placeholder="項目名" onChange={updateItemLabel(x.key)} />
              <div style={styles.fieldInputRow}>
                <NumInput value={x.amount} onChange={updateItem(x.key)} />
                <span style={styles.suffix}>円</span>
              </div>
              <button style={styles.removeBtn} onClick={() => removeItemRow(x.key)}>×</button>
            </div>
          ))}
          <button style={styles.addRowBtn} onClick={addItemRow}>+ 項目を追加する</button>
          <div style={styles.totalLine}>{monthLabel(expenseLogInput.month)}の支出合計：<span style={styles.totalValue}>¥{fmt(itemsTotal)}</span></div>
        </div>
      )}

      <button style={{ ...styles.primaryBtn, marginTop: 16 }} onClick={addExpenseLog}>{monthLabel(expenseLogInput.month)}の実績を記録する</button>

      {expenseProjection.monthsLogged > 0 && (
        <div style={styles.furusatoCard}>
          <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>実績記録月数</span><span style={styles.furusatoValue}>{expenseProjection.monthsLogged}ヶ月</span></div>
          <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>月平均支出</span><span style={styles.furusatoValue}>¥{fmt(expenseProjection.avg)}</span></div>
          <div style={styles.furusatoCol}><span style={styles.furusatoLabel}>今年度の想定支出総額</span><span style={styles.furusatoValue}>¥{fmt(expenseProjection.projectedAnnual)}</span></div>
        </div>
      )}

      {expenseLogs.length > 0 && (
        <div style={{ ...styles.ledger, marginTop: 18 }}>
          {expenseLogs.map((l, i) => (
            <div key={i} style={styles.ledgerRow}>
              <div style={styles.ledgerLabel}>{l.month}月</div>
              <div style={styles.ledgerValue}>¥{fmt(l.total)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel(props) {
  const [section, setSection] = useState("income");
  const [toast, setToast] = useState(false);
  const sections = [
    { key: "income", label: "収入" }, { key: "expense", label: "支出" }, { key: "notify", label: "通知" },
  ];
  const showToast = () => { setToast(true); setTimeout(() => setToast(false), 2000); };
  const idx = sections.findIndex((s) => s.key === section);
  const goNext = () => { showToast(); };
  const goBack = () => setSection(sections[(idx - 1 + sections.length) % sections.length].key);
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>設定</p>
      <h2 style={styles.h2}>初期設定を編集</h2>
      <div style={styles.toggleRow}>
        {sections.map((s) => <button key={s.key} style={section === s.key ? styles.toggleActive : styles.toggleInactive} onClick={() => setSection(s.key)}>{s.label}</button>)}
      </div>
      {section === "income" && <IncomeStep {...props} onNext={goNext} onBack={goBack} saveLabel="保存する" showToast={toast} />}
      {section === "expense" && <ExpenseStep {...props} onNext={goNext} onBack={goBack} saveLabel="保存する" showToast={toast} />}
      {section === "notify" && <NotifySettings />}
    </div>
  );
}

function NotifySettings() {
  const [emailReminder, setEmailReminder] = useState(false);
  const [reminderEmail, setReminderEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [userId, setUserId] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getCurrentUser().then(async (u) => {
      if (!u) return;
      setUserId(u.id);
      setReminderEmail(u.email || "");
      const { data } = await fetch("/api/update-reminder-setting").catch(() => ({ data: null }));
      // SupabaseからSETTINGを読み込む
      const supabase = (await import("../lib/supabaseClient")).supabase;
      const { data: profile } = await supabase.from("user_profiles").select("email_reminder, reminder_email").eq("user_id", u.id).maybeSingle();
      if (profile) {
        setEmailReminder(!!profile.email_reminder);
        setReminderEmail(profile.reminder_email || u.email || "");
      }
      setLoaded(true);
    });
  }, []);

  const handleSave = async () => {
    if (!userId) return;
    setMsg("");
    const res = await fetch("/api/update-reminder-setting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, emailReminder, reminderEmail }),
    });
    const d = await res.json();
    setMsg(d.success ? "保存しました。" : "エラーが発生しました。");
  };

  if (!loaded) return <p style={styles.hint}>読み込み中...</p>;

  return (
    <div>
      <p style={styles.sectionTitle}>月初めリマインド</p>
      <p style={styles.hint}>毎月1日に「資産を記録しましょう」というメールを受け取れます。</p>
      <label style={styles.shareCheckboxRow}>
        <input type="checkbox" checked={emailReminder} onChange={(e) => setEmailReminder(e.target.checked)} />
        <span>月初めに資産記録のリマインドメールを受け取る</span>
      </label>
      {emailReminder && (
        <div style={{ marginTop: 12 }}>
          <Field label="送信先メールアドレス" value={reminderEmail} onChange={(e) => setReminderEmail(e.target.value)} type="text" />
        </div>
      )}
      <button style={{ ...styles.primaryBtn, marginTop: 14 }} onClick={handleSave}>保存する</button>
      {msg && <div style={styles.toastBanner}>{msg}</div>}
    </div>
  );
}

function AccountPanel({ myReferralCode, isPremium, premiumUntil, incomingReferralCode }) {
  const [user, setUser] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState(null); // null | "signup" | "login" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setUser(u);
      setLoaded(true);
      if (u?.email) setNewEmail(u.email);
    });
  }, []);

  const isAnonymous = !user?.email;
  const referralUrl = myReferralCode ? `https://mybanker-app.vercel.app/?ref=${myReferralCode}` : "";

  const handleSignup = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await upgradeToEmailAccount(email, password);
      setMessage("登録しました。確認メールが届いていれば、リンクを開いて認証してください。30日間、プレミアム機能も無料でお試しいただけます。");
      const u = await getCurrentUser();
      setUser(u);
      setMode(null);
      if (u?.id) {
        // 30日間無料トライアル付与
        fetch("/api/apply-signup-trial", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: u.id }),
        }).catch(() => {});
        // リマインドメールを自動オン(登録メアドに月初め通知を送る)
        fetch("/api/update-reminder-setting", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: u.id, emailReminder: true, reminderEmail: email }),
        }).catch(() => {});
        // 少し待ってリロード
        setTimeout(() => window.location.reload(), 500);
      }
      if (incomingReferralCode && u?.id) {
        fetch("/api/apply-referral", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: u.id, referralCode: incomingReferralCode }),
        }).catch(() => {});
      }
    } catch (err) {
      setMessage(toJaError(err));
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await signInWithEmail(email, password);
      window.location.reload();
    } catch (err) {
      setMessage(toJaError(err));
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await requestPasswordReset(email);
      setMessage("パスワード再設定用のメールを送りました。メール内のリンクを開いてください。");
    } catch (err) {
      setMessage(toJaError(err));
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setEmailMsg("");
    try {
      await updateEmail(newEmail);
      setEmailMsg("確認メールを送りました。メール内のリンクを開くと変更が完了します。");
    } catch (err) {
      setEmailMsg(toJaError(err));
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPwMsg("");
    if (newPassword.length < 6) { setPwMsg("パスワードは6文字以上にしてください。"); return; }
    if (newPassword !== confirmPassword) { setPwMsg("パスワードが一致しません。"); return; }
    try {
      await updatePassword(newPassword);
      setPwMsg("パスワードを変更しました。");
      setNewPassword(""); setConfirmPassword("");
    } catch (err) {
      setPwMsg(toJaError(err));
    }
  };

  const handleCopy = () => {
    if (!referralUrl) return;
    navigator.clipboard?.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      await signOut();
      window.location.reload();
    } catch (err) {
      setDeleteLoading(false);
    }
  };

  if (!loaded) return <div style={styles.card} />;

  if (isAnonymous) {
    return (
      <div style={styles.card}>
        <p style={styles.eyebrow}>アカウント</p>
        <h2 style={styles.h2}>登録してデータを保護しましょう</h2>
        <p style={styles.hint}>このデータは今のブラウザ・端末に保存されています。メールアドレスで登録すると、他の端末からも同じデータにアクセスできるようになります。</p>
        {!mode && (
          <div style={styles.btnRow}>
            <button style={styles.primaryBtn} onClick={() => setMode("signup")}>登録する</button>
            <button style={styles.ghostBtn} onClick={() => setMode("login")}>既存アカウントでログイン</button>
          </div>
        )}
        {mode === "signup" && (
          <form onSubmit={handleSignup}>
            <div style={styles.grid2}>
              <Field label="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} type="text" />
              <label style={styles.field}>
                <span style={styles.fieldLabel}>パスワード（6文字以上）</span>
                <div style={styles.fieldInputRow}><input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></div>
              </label>
            </div>
            <label style={styles.shareCheckboxRow}>
              <input type="checkbox" checked={agreedTerms} onChange={(e) => setAgreedTerms(e.target.checked)} required />
              <span><a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#3D5A99" }}>利用規約・プライバシーポリシー</a>に同意する</span>
            </label>
            <div style={styles.btnRow}>
              <button style={styles.primaryBtn} type="submit" disabled={!agreedTerms}>登録する</button>
              <button style={styles.ghostBtn} type="button" onClick={() => setMode(null)}>キャンセル</button>
            </div>
          </form>
        )}
        {mode === "login" && (
          <form onSubmit={handleLogin}>
            <div style={styles.grid2}>
              <Field label="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} type="text" />
              <label style={styles.field}>
                <span style={styles.fieldLabel}>パスワード</span>
                <div style={styles.fieldInputRow}><input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
              </label>
            </div>
            <div style={styles.btnRow}>
              <button style={styles.primaryBtn} type="submit">ログイン</button>
              <button style={styles.ghostBtn} type="button" onClick={() => setMode("forgot")}>パスワードをお忘れですか？</button>
              <button style={styles.ghostBtn} type="button" onClick={() => setMode(null)}>キャンセル</button>
            </div>
          </form>
        )}
        {mode === "forgot" && (
          <form onSubmit={handleForgotPassword}>
            <Field label="登録したメールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} type="text" />
            <div style={styles.btnRow}>
              <button style={styles.primaryBtn} type="submit">再設定メールを送る</button>
              <button style={styles.ghostBtn} type="button" onClick={() => setMode("login")}>ログインに戻る</button>
            </div>
          </form>
        )}
        {message && <p style={styles.hint}>{message}</p>}
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>アカウント</p>
      <h2 style={styles.h2}>{user.email} でログイン中</h2>

      <div style={styles.percentileRow}>
        <div style={{ ...styles.percentileBig, fontSize: 18 }}>{isPremium ? "プレミアム会員" : "無料会員"}</div>
        {isPremium && premiumUntil && <div style={styles.percentileNote}>次回更新日（解約済みの場合はこの日まで閲覧可能）：{new Date(premiumUntil).toLocaleDateString("ja-JP")}</div>}
      </div>

      {myReferralCode && (
        <div style={{ marginTop: 14 }}>
          <p style={styles.fieldLabel}>あなたの紹介リンク（友人が登録すると、あなたが30日間無料に）</p>
          <div style={styles.fieldInputRow}>
            <input style={styles.input} value={referralUrl} readOnly />
            <button style={styles.ghostBtn} onClick={handleCopy}>{copied ? "コピーしました" : "コピー"}</button>
          </div>
        </div>
      )}

      <div style={styles.divider} />

      <form onSubmit={handleEmailSubmit}>
        <Field label="メールアドレス" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="text" />
        <button style={{ ...styles.primaryBtn, marginTop: 10 }} type="submit">メールアドレスを変更する</button>
        {emailMsg && <div style={styles.toastBanner}>{emailMsg}</div>}
      </form>

      <div style={styles.divider} />

      <form onSubmit={handlePasswordSubmit}>
        <div style={styles.grid2}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>新しいパスワード</span>
            <div style={styles.fieldInputRow}><input style={styles.input} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} /></div>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>新しいパスワード（確認）</span>
            <div style={styles.fieldInputRow}><input style={styles.input} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} /></div>
          </label>
        </div>
        <button style={{ ...styles.primaryBtn, marginTop: 10 }} type="submit">パスワードを変更する</button>
        {pwMsg && <div style={styles.toastBanner}>{pwMsg}</div>}
      </form>

      <div style={styles.divider} />
      <button style={styles.ghostBtn} onClick={() => signOut().then(() => window.location.reload())}>ログアウト</button>

      <div style={styles.divider} />
      {!confirmDelete ? (
        <button style={styles.smallLinkBtn} onClick={() => setConfirmDelete(true)}>アカウントを削除する</button>
      ) : (
        <div>
          <p style={styles.hint}>本当に削除しますか？ログインできなくなります（分析・サービス改善のため、データ自体は当面保持されます）。</p>
          <div style={styles.btnRow}>
            <button style={styles.warnBtn} onClick={handleDeleteAccount} disabled={deleteLoading}>{deleteLoading ? "削除中..." : "削除する"}</button>
            <button style={styles.ghostBtn} onClick={() => setConfirmDelete(false)}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactPanel() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState(""); // "" | "sending" | "done" | "error"

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStatus("done");
      setName(""); setEmail(""); setMessage("");
    } catch (err) {
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div style={styles.card}>
        <p style={styles.eyebrow}>お問い合わせ</p>
        <h2 style={styles.h2}>送信しました</h2>
        <p style={styles.hint}>お問い合わせありがとうございます。内容を確認のうえ、必要に応じて対応いたします。</p>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>お問い合わせ</p>
      <h2 style={styles.h2}>ご要望・ご不明点をお寄せください</h2>
      <p style={styles.hint}>「こんな機能が欲しい」「ここがわかりにくい」といったご意見、企業の方からのご連絡も、こちらからお送りください。</p>
      <form onSubmit={handleSubmit}>
        <div style={styles.grid2}>
          <Field label="お名前（任意）" value={name} onChange={(e) => setName(e.target.value)} type="text" />
          <Field label="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} type="text" />
        </div>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>内容</span>
          <textarea style={styles.textarea} value={message} onChange={(e) => setMessage(e.target.value)} rows={5} required />
        </label>
        <button style={{ ...styles.primaryBtn, marginTop: 10 }} type="submit" disabled={status === "sending"}>
          {status === "sending" ? "送信中..." : "送信する"}
        </button>
        {status === "error" && <p style={styles.warnText}>送信に失敗しました。時間をおいて再度お試しください。</p>}
      </form>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#EAF2EC", display: "flex", justifyContent: "center", padding: "16px 12px 110px", fontFamily: "'Source Sans 3', 'Hiragino Sans', sans-serif" },
  shell: { width: "100%", maxWidth: 700, position: "relative" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 10 },
  brand: { fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, color: "#1F2630", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" },
  brandMark: { color: "#B5582E" },
  stepRow: { display: "flex", gap: 9, flexWrap: "wrap" },
  stepLabel: { fontSize: 10.2, color: "#1F2630" },
  card: { background: "#FBFAF6", border: "1px solid #D8E2DA", borderRadius: 18, padding: "24px 18px", boxShadow: "0 1px 0 rgba(31,38,48,0.04)" },
  eyebrow: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.08em", color: "#B5582E", marginBottom: 10, textTransform: "uppercase" },
  h1: { fontFamily: "'Fraunces', serif", fontSize: 22, lineHeight: 1.4, color: "#1F2630", margin: "0 0 16px", fontWeight: 600 },
  h2: { fontFamily: "'Fraunces', serif", fontSize: 20, color: "#1F2630", margin: "0 0 14px", fontWeight: 600 },
  lead: { fontSize: 14.5, lineHeight: 1.8, color: "#3D4A45", marginBottom: 22 },
  calcNote: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#7A6F4E", background: "#F1F0E8", padding: "8px 12px", borderRadius: 8, marginBottom: 20, display: "inline-block" },
  primaryBtn: { background: "#1F2630", color: "#FBFAF6", border: "none", borderRadius: 10, padding: "14px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer", minHeight: 44 },
  ghostBtn: { background: "transparent", color: "#1F2630", border: "1px solid #D8E2DA", borderRadius: 10, padding: "14px 22px", fontSize: 15, cursor: "pointer", minHeight: 44 },
  warnBtn: { background: "#9A4A1F", color: "#fff", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 14, cursor: "pointer" },
  btnRow: { display: "flex", justifyContent: "space-between", marginTop: 26 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 8 },
  grid3: { display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 14, marginBottom: 8 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { fontSize: 12, color: "#5C6862" },
  fieldInputRow: { display: "flex", alignItems: "center", border: "1px solid #D8E2DA", borderRadius: 8, padding: "10px 12px", background: "#fff" },
  readOnlyValueRow: { fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: "#5C6862", border: "1px solid #E3E9E4", borderRadius: 8, padding: "8px 12px", background: "#F1F4F1" },
  historyRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #EDF1EE", cursor: "pointer" },
  historyDetail: { padding: "14px 16px 18px", borderBottom: "1px solid #EDF1EE", background: "#FAFAF7" },
  deleteLogBtn: { marginTop: 12, background: "transparent", border: "1px solid #E3B5A8", color: "#9A1F1F", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" },
  input: { border: "none", outline: "none", fontSize: 16, fontFamily: "'JetBrains Mono', monospace", width: "100%", background: "transparent", color: "#1F2630" },
  textarea: { border: "1px solid #D8E2DA", borderRadius: 10, padding: "10px 12px", fontSize: 14, fontFamily: "'Source Sans 3', sans-serif", width: "100%", resize: "vertical" },
  suffix: { fontSize: 12, color: "#9AA6A0" },
  hint: { fontSize: 11, color: "#9AA6A0" },
  toggleRow: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  toggleActive: { background: "#1F2630", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  toggleInactive: { background: "transparent", color: "#1F2630", border: "1px solid #D8E2DA", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  toggleActiveSm: { background: "#1F2630", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" },
  toggleInactiveSm: { background: "transparent", color: "#1F2630", border: "1px solid #D8E2DA", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#3D4A45", gridColumn: "span 2" },
  checkboxRow2: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#3D4A45", marginTop: 14, marginBottom: 6 },
  monthGrid: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 6 },
  monthBtn: { background: "transparent", border: "1px solid #D8E2DA", borderRadius: 8, padding: "8px 4px", fontSize: 12, cursor: "pointer", color: "#1F2630" },
  monthBtnActive: { background: "#1F2630", border: "1px solid #1F2630", borderRadius: 8, padding: "8px 4px", fontSize: 12, cursor: "pointer", color: "#fff" },
  divider: { height: 1, background: "#E3E9E4", margin: "20px 0" },
  summaryRow: { display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14, marginBottom: 18 },
  summaryItem: { display: "flex", flexDirection: "column", gap: 3, background: "#F1F4F1", padding: "10px 14px", borderRadius: 10, cursor: "pointer" },
  summaryItemLg: { display: "flex", flexDirection: "column", gap: 3, background: "#1F2630", padding: "14px 18px", borderRadius: 12, color: "#fff", cursor: "pointer" },
  tapHint: { fontSize: 9.5, opacity: 0.6, textDecoration: "underline" },
  expandCard: { background: "#F1F4F1", border: "1px solid #E3E9E4", borderRadius: 10, padding: "14px 16px", marginBottom: 16 },
  percentileCard: { marginTop: 18, marginBottom: 18, background: "#FBF8F0", border: "1px solid #E3DAC2", borderRadius: 14, padding: "18px 20px" },
  percentileRow: { display: "flex", alignItems: "center", gap: 16, marginTop: 10 },
  percentileBig: { fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 700, color: "#B5582E", minWidth: 90 },
  percentileNote: { fontSize: 12, color: "#6B6248", lineHeight: 1.6 },
  rankingLinkBtn: { marginTop: 14, background: "transparent", border: "1px solid #B5582E", color: "#B5582E", borderRadius: 20, padding: "8px 16px", fontSize: 12.5, cursor: "pointer" },
  summaryLabel: { fontSize: 11, color: "#5C6862" },
  summaryValue: { fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 700, color: "#1F2630" },
  summaryValueLg: { fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: "#fff" },
  expenseList: { display: "flex", flexDirection: "column", gap: 10 },
  expenseRow: { display: "grid", gridTemplateColumns: "1.2fr 1fr auto", gap: 10, alignItems: "center" },
  otherAssetRow: { display: "grid", gridTemplateColumns: "1.1fr 1fr 0.8fr auto", gap: 10, alignItems: "center" },
  otherAssetList: { display: "flex", flexDirection: "column", gap: 12 },
  otherAssetCard: { border: "1px solid #E3E9E4", borderRadius: 10, padding: "12px" },
  otherAssetCardTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  otherAssetLabelInput: { flex: 1, fontSize: 14, color: "#1F2630", border: "1px solid #D8E2DA", borderRadius: 8, padding: "8px 10px", outline: "none" },
  otherAssetCardRow: { display: "flex", flexWrap: "wrap", gap: 10 },
  otherAssetFieldWrap: { display: "flex", flexDirection: "column", gap: 4 },
  expenseLabel: { fontSize: 13.5, color: "#1F2630" },
  expenseLabelInput: { fontSize: 13.5, color: "#1F2630", border: "1px solid #D8E2DA", borderRadius: 8, padding: "8px 10px", outline: "none" },
  removeBtn: { background: "transparent", border: "none", color: "#B5582E", fontSize: 18, cursor: "pointer" },
  addRowBtn: { background: "transparent", border: "1px dashed #B6C4BB", borderRadius: 8, padding: "10px", fontSize: 13, color: "#5C6862", cursor: "pointer", marginTop: 4 },
  totalLine: { fontSize: 13.5, color: "#3D4A45", marginTop: 12, borderTop: "1px solid #E3E9E4", paddingTop: 12 },
  totalLineTop: { fontSize: 14, color: "#1F2630", marginBottom: 12, background: "#F1F4F1", borderRadius: 10, padding: "10px 14px" },
  totalValue: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#1F2630" },
  riskGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  riskCard: { textAlign: "left", background: "#fff", border: "1px solid #D8E2DA", borderRadius: 12, padding: "16px 14px", cursor: "pointer" },
  riskCardActive: { textAlign: "left", background: "#1F2630", border: "1px solid #1F2630", borderRadius: 12, padding: "16px 14px", cursor: "pointer", color: "#fff" },
  riskLabel: { fontSize: 14, fontWeight: 700, marginBottom: 6 },
  riskRate: { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, opacity: 0.85 },
  riskNote: { fontSize: 11, opacity: 0.7, marginTop: 6, lineHeight: 1.5 },
  riskPicker: { display: "flex", gap: 8 },
  riskPickerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 10 },
  categoryPickerRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  shareBox: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, background: "#F1F4F1", borderRadius: 10, padding: "10px 14px", marginBottom: 16 },
  shareCheckboxRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#1F2630" },
  shareGroupLabel: { fontSize: 12.5, fontWeight: 600, color: "#1F2630", marginBottom: 6 },
  shareItemRow: { display: "flex", flexWrap: "wrap", gap: 14 },
  sharePreviewBox: { background: "#fff", border: "1px solid #D8E2DA", borderRadius: 10, padding: "12px 14px", marginTop: 14, marginBottom: 10 },
  sharePreviewText: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#1F2630", whiteSpace: "pre-wrap", margin: 0 },
  shareBtn: { background: "#1F2630", color: "#fff", border: "none", borderRadius: 18, padding: "8px 16px", fontSize: 12, cursor: "pointer" },
  resetLink: { background: "transparent", border: "none", color: "#3D5A99", fontSize: 12, cursor: "pointer", textDecoration: "underline" },
  pill: { border: "1px solid #D8E2DA", background: "transparent", borderRadius: 20, padding: "6px 14px", fontSize: 12.5, cursor: "pointer", color: "#1F2630" },
  pillActive: { border: "1px solid #1F2630", background: "#1F2630", borderRadius: 20, padding: "6px 14px", fontSize: 12.5, cursor: "pointer", color: "#fff" },
  pillSm: { border: "1px solid #D8E2DA", background: "transparent", borderRadius: 16, padding: "4px 12px", fontSize: 11.5, cursor: "pointer", color: "#1F2630" },
  pillActiveSm: { border: "1px solid #1F2630", background: "#1F2630", borderRadius: 16, padding: "4px 12px", fontSize: 11.5, cursor: "pointer", color: "#fff" },
  rangeToggleRow: { display: "flex", gap: 8, marginBottom: 10 },
  allocList: { display: "flex", flexDirection: "column", gap: 12 },
  nisaTargetBox: { background: "#F1F4F1", border: "1px solid #E3E9E4", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 },
  nisaSplitRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  nisaSplitLabel: { fontSize: 12.5, color: "#1F2630", flex: 1 },
  select: { border: "1px solid #D8E2DA", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, background: "#fff", color: "#1F2630" },
  allocRow: { display: "grid", gridTemplateColumns: "1fr 200px", gap: 14, alignItems: "center" },
  allocLeft: {},
  allocRight: { display: "flex", alignItems: "center", gap: 10 },
  allocPct: { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#9AA6A0", width: 40, textAlign: "right" },
  ledgerLabel: { fontSize: 13.5, fontWeight: 600 },
  ledgerNote: { fontSize: 11, color: "#8E9994", marginTop: 3 },
  ledger: { border: "1px solid #E3E9E4", borderRadius: 12, overflow: "hidden", padding: "4px 0" },
  ledgerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #EDF1EE" },
  ledgerRight: { textAlign: "right", display: "flex", alignItems: "center", gap: 10 },
  ledgerValue: { fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color: "#1F2630" },
  ledgerPct: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9AA6A0" },
  allocTotalBar: { marginTop: 16, padding: "12px 16px", background: "#F1F4F1", borderRadius: 10, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: "#1F2630" },
  allocTotalError: { background: "#FBE6E6", color: "#9A1F1F" },
  errorText: { fontFamily: "'Source Sans 3', sans-serif", fontSize: 12.5 },
  warnText: { fontFamily: "'Source Sans 3', sans-serif", fontSize: 12.5, color: "#9A4A1F" },
  bonusBlock: { marginTop: 28, padding: "18px", border: "1px solid #E3E9E4", borderRadius: 12, background: "#FBF8F0" },
  chartCard: { marginTop: 24, padding: "18px 18px 6px", border: "1px solid #E3E9E4", borderRadius: 12 },
  chartTitle: { fontSize: 13, color: "#1F2630", fontWeight: 600, marginBottom: 6 },
  sectionTitle: { fontSize: 15, color: "#1F2630", fontWeight: 600, marginBottom: 8 },
  chartTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  planBtn: { background: "#1F2630", color: "#fff", border: "none", borderRadius: 20, padding: "8px 14px", fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" },
  chartNote: { fontSize: 10.5, color: "#9AA6A0", marginTop: 4 },
  furusatoCard: { marginTop: 18, display: "flex", gap: 24, padding: "14px 18px", background: "#F1F0E8", borderRadius: 10, flexWrap: "wrap" },
  furusatoCol: { display: "flex", flexDirection: "column", gap: 3 },
  furusatoLabel: { fontSize: 12, color: "#7A6F4E" },
  furusatoValue: { fontFamily: "'JetBrains Mono', monospace", fontSize: 17, fontWeight: 700, color: "#5C4F2A" },
  spanGrid: { display: "flex", gap: 8, flexWrap: "wrap" },
  statusBanner: { background: "#FBEFE6", color: "#9A4A1F", borderRadius: 10, padding: "12px 16px", fontSize: 13, lineHeight: 1.6, marginTop: 14 },
  statusBanner2: (ok) => ({ background: ok ? "#E5EFE6" : "#FBEFE6", color: ok ? "#2F6B4F" : "#9A4A1F", borderRadius: 10, padding: "12px 16px", fontSize: 13.5, lineHeight: 1.6, marginTop: 16 }),
  suggestBox: { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #D8E2DA", borderRadius: 10, marginTop: 4, zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", maxHeight: 220, overflowY: "auto" },
  suggestItem: { display: "flex", justifyContent: "space-between", padding: "10px 14px", fontSize: 12.5, cursor: "pointer", borderBottom: "1px solid #F1F4F1", color: "#1F2630" },
  suggestRate: { color: "#9AA6A0", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
  navBar: { position: "fixed", bottom: 0, left: 0, right: 0, background: "#FBFAF6", borderTop: "1px solid #D8E2DA", display: "flex", justifyContent: "center", gap: 6, padding: "10px 12px env(safe-area-inset-bottom)", flexWrap: "wrap", zIndex: 20 },
  signupBar: { position: "fixed", bottom: 54, left: 0, right: 0, background: "#1F2630", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "8px 14px", fontSize: 11.5, flexWrap: "wrap", zIndex: 19 },
  toastBanner: { background: "#2F6B4F", color: "#fff", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, textAlign: "center", marginBottom: 12 },
  signupBarBtn: { background: "#fff", color: "#1F2630", border: "none", borderRadius: 14, padding: "5px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 },
  navItem: { background: "transparent", border: "none", color: "#5C6862", fontSize: 12, padding: "10px 12px", borderRadius: 8, cursor: "pointer", minHeight: 44 },
  navItemActive: { background: "#1F2630", border: "none", color: "#fff", fontSize: 12, padding: "10px 12px", borderRadius: 8, cursor: "pointer", minHeight: 44 },
  moreSheet: { position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 700, background: "#FBFAF6", border: "1px solid #D8E2DA", borderRadius: 14, padding: 10, display: "flex", flexDirection: "column", gap: 4, zIndex: 21, boxShadow: "0 -2px 12px rgba(31,38,48,0.08)" },
  moreItem: { background: "transparent", border: "none", color: "#1F2630", fontSize: 13, padding: "10px 14px", borderRadius: 8, cursor: "pointer", textAlign: "left" },
  moreItemActive: { background: "#F1F4F1", border: "none", color: "#1F2630", fontSize: 13, padding: "10px 14px", borderRadius: 8, cursor: "pointer", textAlign: "left", fontWeight: 600 },
  glossaryBtn: { background: "transparent", border: "1px solid #D8E2DA", borderRadius: 20, padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "#1F2630" },
  glossaryCard: { background: "#FBF8F0", border: "1px solid #E3DAC2", borderRadius: 14, padding: "18px 20px", marginBottom: 18 },
  glossaryHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  glossaryClose: { background: "transparent", border: "none", color: "#9A4A1F", fontSize: 12, cursor: "pointer", textDecoration: "underline" },
  glossaryItem: { padding: "8px 0", borderBottom: "1px solid #EFE7D2" },
  glossaryTerm: { fontSize: 13, fontWeight: 700, color: "#5C4F2A", marginBottom: 3 },
  glossaryDesc: { fontSize: 12, color: "#6B6248", lineHeight: 1.6 },
  paywallCard: { background: "#FBF8F0", border: "1px solid #E3DAC2", borderRadius: 14, padding: "20px", marginTop: 8 },
  paywallTitle: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 700, color: "#5C4F2A", marginBottom: 8 },
  paywallDesc: { fontSize: 12.5, color: "#6B6248", lineHeight: 1.7, marginBottom: 14 },
  paywallPriceRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 },
  paywallPrice: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, color: "#B5582E" },
  paywallNote: { fontSize: 11.5, color: "#6B6248" },
  paywallBtnRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  testToggleBtn: { marginTop: 14, background: "transparent", border: "none", color: "#3D5A99", fontSize: 11, textDecoration: "underline", cursor: "pointer" },
  smallLinkBtn: { background: "transparent", border: "none", color: "#3D5A99", fontSize: 11.5, textDecoration: "underline", cursor: "pointer", padding: 0 },
  cancelBox: { marginTop: 20, paddingTop: 14, borderTop: "1px solid #E3E9E4" },
  tooltipBox: { background: "#fff", border: "1px solid #D8E2DA", borderRadius: 8, padding: "8px 12px", fontSize: 11.5, boxShadow: "0 2px 8px rgba(31,38,48,0.12)" },
  tooltipLabel: { fontWeight: 600, color: "#1F2630", marginBottom: 4 },
  tooltipTotal: { fontWeight: 700, color: "#B5582E", marginBottom: 4, borderBottom: "1px solid #E3E9E4", paddingBottom: 4 },
  tooltipRow: { margin: "1px 0" },
  goalCountdownCard: { background: "#FBF8F0", border: "1px solid #E3DAC2", borderRadius: 14, padding: "16px 18px", marginBottom: 18, display: "flex", flexDirection: "column", gap: 4 },
  goalLabel: { fontSize: 12, color: "#6B6248" },
  goalValue: { fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 700, color: "#B5582E" },
  trialBanner: { background: "#3D5A99", color: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12, marginBottom: 14, textAlign: "center" },
  trialNoticeBox: { background: "#F1F4F1", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#1F2630", display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 },
  sideIncomeToggle: { background: "transparent", border: "none", color: "#6B6248", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 },
  statPairRow: { display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#5C6862", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" },
  youAreHereNote: { fontSize: 11, color: "#B5582E", marginTop: 4 },
};
