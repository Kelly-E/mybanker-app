"use client";

import { storage, startCheckout, getPremiumProfile, openBillingPortal } from "../lib/storage";
import React, { useState, useMemo, useEffect } from "react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const fmt = (n) => Math.round(n || 0).toLocaleString("ja-JP");
const pct = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);

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
  { key: "rent", label: "家賃・住居費", amount: "85000" },
  { key: "food", label: "食費", amount: "40000" },
  { key: "social", label: "交際費", amount: "15000" },
  { key: "subs", label: "通信・サブスク", amount: "12000" },
  { key: "beauty", label: "美容（美容院・ネイル・化粧品・衣服）", amount: "20000" },
  { key: "insurance", label: "保険", amount: "10000" },
];

// 単身世帯・年代別の金融資産統計（万円）と平均月間消費支出（万円）の目安。
// 金融資産（平均値・中央値）出典：金融経済教育推進機構(J-FLEC)「家計の金融行動に関する世論調査」の単身世帯データ（複数年版・令和4〜7年の公表値を組み合わせた概算であり、単一年次の精密な値ではありません）。
// 月間消費支出 出典：総務省統計局「家計調査（家計収支編）2024年 単身世帯」（年齢階級別の公表値。同調査は34歳以下／35〜59歳／60歳以上の3区分のため、各年代に割り当てて概算）。
// いずれも厳密な分布データではなく、公表されている平均値・中央値・統計値から簡易的に推定するための参考値です。
const AGE_STATS = {
  20: { mean: 176, median: 20, monthlyExpense: 17.6 },
  30: { mean: 494, median: 75, monthlyExpense: 18.0 },
  40: { mean: 825, median: 250, monthlyExpense: 18.5 },
  50: { mean: 1253, median: 300, monthlyExpense: 18.5 },
  60: { mean: 1819, median: 700, monthlyExpense: 15.9 },
  70: { mean: 1633, median: 700, monthlyExpense: 15.9 },
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
  { name: "ビットコイン（BTC）", rate: 15.0, category: "暗号資産" },
  { name: "イーサリアム（ETH）", rate: 13.0, category: "暗号資産" },
  { name: "金（ゴールド）", rate: 4.0, category: "コモディティ" },
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
  const [otherAssets, setOtherAssets] = useState([
    { key: "crypto", label: "暗号資産", amount: "0", rate: "0" },
    { key: "fx", label: "FX", amount: "0", rate: "0" },
    { key: "points", label: "ポイント", amount: "0", rate: "0" },
  ]);
  const [incomeLogs, setIncomeLogs] = useState([]);
  const [incomeLogInput, setIncomeLogInput] = useState({ month: String(new Date().getMonth() + 1), gross: "", takehome: "", hasBonus: false, bonus: "" });
  const [holdings, setHoldings] = useState([]); // {id, name, amount, rate, category}
  const [otherHoldings, setOtherHoldings] = useState([]); // その他運用（iDeCoなど）専用の個別項目
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

  useEffect(() => {
    getPremiumProfile()
      .then((p) => {
        const stillValid = p.premium_until ? new Date(p.premium_until) > new Date() : p.is_premium;
        setIsPremium(!!stillValid);
        setMyReferralCode(p.referral_code);
      })
      .catch(() => {});

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
          if (d.assetLogs) setAssetLogs(d.assetLogs.map((l, i) => (l.id ? l : { ...l, id: Date.now() + i })));
          if (d.incomeLogs) setIncomeLogs(d.incomeLogs);
          if (d.holdings) setHoldings(d.holdings);
          if (d.otherHoldings) setOtherHoldings(d.otherHoldings);
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
    const data = { form, expenses, detailedExpense, riskProfile, incomeMode, bonusHandling, bonusInputType, reviewSpan, email, alloc, bonusAlloc, assetLogs, incomeLogs, holdings, appPhase, otherAssets, holdingsLogs, expenseLogs, nisaSplits, isPremium, otherHoldings, otherSplits };
    storage.set(STORAGE_KEY, JSON.stringify(data), false).catch(() => {});
  }, [form, expenses, detailedExpense, riskProfile, incomeMode, bonusHandling, bonusInputType, reviewSpan, email, alloc, bonusAlloc, assetLogs, incomeLogs, holdings, appPhase, otherAssets, holdingsLogs, expenseLogs, nisaSplits, isPremium, otherHoldings, otherSplits, loaded]);

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

  const annualIncomeEstimateNet = monthlyIncomeComputed * 12 + bonusAnnualNet;
  const annualIncomeEstimateGross = monthlyGrossComputed * 12 + bonusAnnualGross;

  const monthlyFree = useMemo(() => {
    if (bonusHandling === "smooth") {
      return Math.max((annualIncomeEstimateNet - totalExpense * 12) / 12, 0);
    }
    return Math.max(monthlyIncomeComputed - totalExpense, 0);
  }, [bonusHandling, annualIncomeEstimateNet, totalExpense, monthlyIncomeComputed]);

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
  const baselineSavings = useMemo(() => (assetLogs[0] ? Number(assetLogs[0].savings) || 0 : 0), [assetLogs]);
  const baselineStocks = useMemo(() => (assetLogs[0] ? Number(assetLogs[0].stocks) || 0 : 0), [assetLogs]);

  const growableOtherAssets = useMemo(
    () => otherAssets.filter((x) => (Number(x.amount) || 0) > 0),
    [otherAssets]
  );

  // nisaSplitsは「株式投資の金額のうち何%をこの銘柄に割り当てるか」を保持する
  const nisaSplitPctTotal = useMemo(
    () => holdings.reduce((s, h) => s + (Number(nisaSplits[h.id]) || 0), 0),
    [holdings, nisaSplits]
  );
  const nisaSplitOver = nisaSplitPctTotal > 100.5;
  const nisaUnassignedPct = Math.max(100 - nisaSplitPctTotal, 0);
  const nisaUnassignedAmount = allocNums.nisa * (nisaUnassignedPct / 100);
  const nisaSplitTotal = allocNums.nisa * (Math.min(nisaSplitPctTotal, 100) / 100); // 円換算（表示用）

  // otherSplitsは「その他運用の金額のうち何%をこの項目に割り当てるか」を保持する
  const otherSplitPctTotal = useMemo(
    () => otherHoldings.reduce((s, h) => s + (Number(otherSplits[h.id]) || 0), 0),
    [otherHoldings, otherSplits]
  );
  const otherSplitOver = otherSplitPctTotal > 100.5;
  const otherUnassignedPct = Math.max(100 - otherSplitPctTotal, 0);
  const otherUnassignedAmount = allocNums.other * (otherUnassignedPct / 100);
  const otherSplitTotal = allocNums.other * (Math.min(otherSplitPctTotal, 100) / 100);

  const projection = useMemo(() => {
    const years = [1, 3, 5, 10, 15, 20, 25, 30];
    let savings = baselineSavings;
    let otherBal = 0;
    let unassignedBal = 0;
    const unassignedRate = profile.rate / 12;
    const unassignedMonthly = nisaUnassignedAmount;
    const otherUnassignedMonthly = otherUnassignedAmount;

    // 銘柄ごとの残高（既存の保有額からスタートし、各銘柄自身の年率で計算）
    const holdingBalances = {};
    holdings.forEach((h) => { holdingBalances[h.id] = Number(h.amount) || 0; });
    const otherHoldingBalances = {};
    otherHoldings.forEach((h) => { otherHoldingBalances[h.id] = Number(h.amount) || 0; });

    const data = [];
    const snapshot = (label, yearsElapsed) => {
      const point = { year: label, 貯金: Math.round(savings) };
      holdings.forEach((h) => { point[h.name] = Math.round(holdingBalances[h.id] || 0); });
      otherHoldings.forEach((h) => { point[h.name] = Math.round(otherHoldingBalances[h.id] || 0); });
      if (unassignedMonthly > 0) point["新規投資（未割り当て）"] = Math.round(unassignedBal);
      if (otherUnassignedMonthly > 0) point["その他運用（未割り当て）"] = Math.round(otherBal);
      // その他資産（暗号資産・FX・ポイントなど）も、株式や金と同様に年率を複利（指数関数的成長）で概算
      growableOtherAssets.forEach((x) => {
        const principal = Number(x.amount) || 0;
        const rate = (Number(x.rate) || 0) / 100;
        point[x.label] = Math.round(principal * Math.pow(1 + rate, yearsElapsed));
      });
      return point;
    };
    data.push(snapshot("現在", 0));

    for (let y = 1; y <= 30; y++) {
      for (let m = 0; m < 12; m++) {
        savings += allocNums.savings;
        otherBal = otherBal * (1 + unassignedRate) + otherUnassignedMonthly;

        holdings.forEach((h) => {
          const hRate = (Number(h.rate) || 0) / 100 / 12;
          const monthlyAdd = allocNums.nisa * ((Number(nisaSplits[h.id]) || 0) / 100);
          holdingBalances[h.id] = (holdingBalances[h.id] || 0) * (1 + hRate) + monthlyAdd;
        });

        otherHoldings.forEach((h) => {
          const hRate = (Number(h.rate) || 0) / 100 / 12;
          const monthlyAdd = allocNums.other * ((Number(otherSplits[h.id]) || 0) / 100);
          otherHoldingBalances[h.id] = (otherHoldingBalances[h.id] || 0) * (1 + hRate) + monthlyAdd;
        });

        unassignedBal = unassignedBal * (1 + unassignedRate) + unassignedMonthly;
      }
      if (bonusHandling === "lump") {
        savings += bonusAllocNums.savings;
        otherBal += bonusAllocNums.other;
        unassignedBal += bonusAllocNums.nisa;
      }
      if (years.includes(y)) data.push(snapshot(`${y}年後`, y));
    }
    return data;
  }, [allocNums, baselineSavings, holdings, otherHoldings, profile, bonusHandling, bonusAllocNums, nisaSplits, otherSplits, nisaUnassignedAmount, otherUnassignedAmount, growableOtherAssets]);

  const projectionSeriesKeys = useMemo(() => {
    const keys = holdings.map((h) => h.name);
    if (nisaUnassignedAmount > 0) keys.push("新規投資（未割り当て）");
    otherHoldings.forEach((h) => keys.push(h.name));
    if (otherUnassignedAmount > 0) keys.push("その他運用（未割り当て）");
    growableOtherAssets.forEach((x) => keys.push(x.label));
    return keys;
  }, [holdings, nisaUnassignedAmount, otherHoldings, otherUnassignedAmount, growableOtherAssets]);

  const SERIES_COLORS = ["#3D5A99", "#B5582E", "#9A4A8C", "#5C8A99", "#C9A227", "#6B4F9A", "#4F8FA8", "#A8527A"];

  const furusatoApprox = useMemo(() => Math.round((annualIncomeEstimateGross * 0.022) / 1000) * 1000, [annualIncomeEstimateGross]);

  const addAssetLog = () => {
    const stocksFromHoldings = holdings.reduce((s, h) => s + (Number(h.amount) || 0), 0);
    const total = (Number(assetInput.savings) || 0) + stocksFromHoldings + otherAssetsTotal;
    const todayKey = new Date().toLocaleDateString("ja-JP");
    const existingIdx = assetLogs.findIndex((l) => l.date === todayKey);
    const sorted = [...assetLogs].sort((a, b) => a.id - b.id);
    const prev = existingIdx >= 0 ? sorted[sorted.length - 2] : sorted[sorted.length - 1];
    const entry = {
      id: existingIdx >= 0 ? assetLogs[existingIdx].id : Date.now(),
      date: todayKey, savings: assetInput.savings, stocks: String(stocksFromHoldings),
      other: String(otherAssetsTotal), otherItems: otherAssets.map((x) => ({ label: x.label, amount: x.amount })),
      holdingItems: holdings.map((h) => ({ name: h.name, amount: h.amount, rate: h.rate })),
      total,
    };
    if (prev) entry.impliedSpending = Math.round(monthlyIncomeComputed - (total - prev.total));
    if (existingIdx >= 0) {
      const next = [...assetLogs];
      next[existingIdx] = entry;
      setAssetLogs(next);
    } else {
      setAssetLogs([...assetLogs, entry]);
    }
    setAssetInput({ savings: assetInput.savings });
  };

  const updateAssetLog = (id, field, value) => {
    setAssetLogs(assetLogs.map((l) => {
      if (l.id !== id) return l;
      const updated = { ...l, [field]: value };
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
  const baselineTotal = sortedAssetLogs[0] ? sortedAssetLogs[0].total : 0;
  const goalCompareData = sortedAssetLogs.map((l, i) => ({
    label: l.date,
    実際の資産: l.total,
    計画上の想定: Math.round(baselineTotal + (allocNums.savings + allocNums.nisa + allocNums.other) * i),
  }));

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
  const ageStats = AGE_STATS[ageDecade];
  const assetPercentile = useMemo(
    () => estimatePercentile(totalNetWorth / 10000, ageStats.mean, ageStats.median),
    [totalNetWorth, ageStats]
  );
  const peerMonthlyExpense = ageStats.monthlyExpense * 10000;
  const expenseDiffVsPeer = totalExpense - peerMonthlyExpense;
  const expenseDiffPct = peerMonthlyExpense > 0 ? Math.round((expenseDiffVsPeer / peerMonthlyExpense) * 100) : 0;

  const assetDistribution = useMemo(() => generateDistributionCurve(ageStats.mean, ageStats.median), [ageStats]);

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

  const addOtherHolding = () => {
    if (!otherHoldingInput.name || !otherHoldingInput.amount) return;
    setOtherHoldings([...otherHoldings, { id: Date.now(), name: otherHoldingInput.name, amount: Number(otherHoldingInput.amount) || 0, rate: Number(otherHoldingInput.rate) || 0 }]);
    setOtherHoldingInput({ name: "", amount: "", rate: "" });
  };
  const removeOtherHolding = (id) => setOtherHoldings(otherHoldings.filter((h) => h.id !== id));
  const pickOtherPreset = (p) => {
    setOtherHoldingInput({ name: p.name, amount: otherHoldingInput.amount, rate: String(p.rate) });
    setShowOtherSuggest(false);
  };

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
    detailedExpense, setDetailedExpense, expenses, updateExpense, updateLabel, addExpenseRow, removeExpense, totalExpense, insuranceRatio,
    riskProfile, setRiskProfile,
    monthlyFree, alloc, setAlloc, setAllocTouched, allocNums, allocTotal, allocOver, allocUnder,
    bonusAlloc, setBonusAlloc, bonusAllocNums, bonusPctTotal, bonusAnnualNet,
    projection, furusatoApprox, annualIncomeEstimateNet, annualIncomeEstimateGross, resetAllocToDefault,
    nisaSplits, setNisaSplits, nisaSplitTotal, nisaSplitPctTotal, nisaUnassignedAmount, nisaSplitOver, projectionSeriesKeys, SERIES_COLORS,
    otherHoldings, otherHoldingInput, setOtherHoldingInput, addOtherHolding, removeOtherHolding, showOtherSuggest, setShowOtherSuggest, pickOtherPreset,
    otherSplits, setOtherSplits, otherSplitTotal, otherSplitPctTotal, otherUnassignedAmount, otherSplitOver,
    reviewSpan, setReviewSpan, email, setEmail,
    assetInput, setAssetInput, addAssetLog, assetLogs, updateAssetLog, deleteAssetLog, goalCompareData,
    incomeLogInput, setIncomeLogInput, addIncomeLog, incomeLogs, incomeProjection,
    holdings, holdingInput, setHoldingInput, addHolding, removeHolding, showSuggest, setShowSuggest, pickPreset, totalHoldingsValue,
    otherAssets, updateOtherAsset, updateOtherAssetLabel, updateOtherAssetRate, addOtherAssetRow, removeOtherAsset, otherAssetsTotal,
    holdingsLogs, saveHoldingsSnapshot, updateHoldingsLogItem, deleteHoldingsLog,
    userAge, ageDecade, assetPercentile, peerMonthlyExpense, expenseDiffVsPeer, expenseDiffPct,
    planningFlow, setPlanningFlow,
    assetDistribution, incomePercentile, incomeDistribution, expenseCategoryComparison,
    savingsRatePeer, savingsRateUser, savingsRateDiff, growthRateInfo, isPremium, setIsPremium,
    myReferralCode, incomingReferralCode,
    expenseLogs, expenseLogInput, setExpenseLogInput, expenseLogItems, setExpenseLogItems, addExpenseLog, expenseProjection,
    totalNetWorth,
  };

  if (appPhase === "dashboard") {
    return <Dashboard dashView={dashView} setDashView={setDashView} {...sharedProps} />;
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <Header step={step} setStep={setStep} />
        {step === 0 && <Intro onNext={() => setStep(1)} />}
        {step === 1 && <IncomeStep {...sharedProps} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <ExpenseStep {...sharedProps} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && (
          <AssetBaseline assetInput={assetInput} setAssetInput={setAssetInput}
            holdings={holdings} holdingInput={holdingInput} setHoldingInput={setHoldingInput} addHolding={addHolding}
            removeHolding={removeHolding} showSuggest={showSuggest} setShowSuggest={setShowSuggest} pickPreset={pickPreset}
            totalHoldingsValue={holdings.reduce((s, h) => s + (Number(h.amount) || 0), 0)}
            otherAssets={otherAssets} updateOtherAsset={updateOtherAsset} updateOtherAssetLabel={updateOtherAssetLabel} updateOtherAssetRate={updateOtherAssetRate}
            addOtherAssetRow={addOtherAssetRow} removeOtherAsset={removeOtherAsset} otherAssetsTotal={otherAssetsTotal}
            onNext={() => { if (assetLogs.length === 0) addAssetLog(); finishOnboarding(); }} onBack={() => setStep(2)} />
        )}
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

function Intro({ onNext }) {
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>資産形成の伴走サービス</p>
      <h1 style={styles.h1}>たまる、ふえる、心地いい。<br />あなた専用のマネープランナー。</h1>
      <p style={styles.lead}>貯金、株式投資（NISAなど）、ふるさと納税、iDeCoや保険、暗号資産やその他の資産まで、収入と支出から総合的に考え、毎月の振り返りで一緒に整えていきます。</p>
      <button style={styles.primaryBtn} onClick={onNext}>はじめる</button>
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

function IncomeStep({ form, update, incomeMode, setIncomeMode, monthlyIncomeComputed, monthlyGrossComputed, takeHomeRatio, bonusHandling, setBonusHandling, bonusInputType, setBonusInputType, onNext, onBack }) {
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
        <button style={styles.primaryBtn} onClick={onNext}>次へ</button>
      </div>
    </div>
  );
}

function ExpenseStep({ detailedExpense, setDetailedExpense, expenses, updateExpense, updateLabel, addExpenseRow, removeExpense, form, update, totalExpense, insuranceRatio, onNext, onBack }) {
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
        <button style={styles.primaryBtn} onClick={onNext}>次へ</button>
      </div>
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
        <button style={styles.primaryBtn} onClick={onNext}>次へ</button>
      </div>
    </div>
  );
}

function OtherAssetsEditor({ otherAssets, updateOtherAsset, updateOtherAssetLabel, updateOtherAssetRate, addOtherAssetRow, removeOtherAsset, otherAssetsTotal }) {
  return (
    <div>
      <p style={styles.hint}>暗号資産、FX、ポイントなど、お好きな項目を追加・編集できます。想定年率を入れると、推移予想に複利（年率に応じた指数関数的な成長）で反映されます。</p>
      <div style={styles.otherAssetList}>
        {otherAssets.map((x) => (
          <div key={x.key} style={styles.otherAssetCard}>
            <div style={styles.otherAssetCardTop}>
              <input style={styles.otherAssetLabelInput} value={x.label} placeholder="項目名" onChange={updateOtherAssetLabel(x.key)} />
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
        ))}
        <button style={styles.addRowBtn} onClick={addOtherAssetRow}>+ 項目を追加する（例：FX、ポイントなど）</button>
        <div style={styles.totalLine}>その他資産合計：<span style={styles.totalValue}>¥{fmt(otherAssetsTotal)}</span></div>
      </div>
    </div>
  );
}

function HoldingsEditor({ holdings, holdingInput, setHoldingInput, addHolding, removeHolding, showSuggest, setShowSuggest, pickPreset, totalHoldingsValue }) {
  const filtered = HOLDING_PRESETS.filter((p) => holdingInput.name && p.name.toLowerCase().includes(holdingInput.name.toLowerCase()));
  return (
    <div>
      <p style={styles.hint}>投資信託名や暗号資産名を入力すると、候補と想定年率が表示されます。候補にないものは、名前と想定年率を自分で入力できます。</p>
      <div style={{ position: "relative" }}>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Field label="商品名" value={holdingInput.name} onChange={(e) => { setHoldingInput({ ...holdingInput, name: e.target.value }); setShowSuggest(true); }} hint="例：eMAXIS Slim 全世界株式" type="text" />
          {showSuggest && filtered.length > 0 && (
            <div style={styles.suggestBox}>
              {filtered.map((p) => (
                <div key={p.name} style={styles.suggestItem} onClick={() => pickPreset(p)}>
                  <span>{p.name}</span><span style={styles.suggestRate}>年率{p.rate}%目安</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={styles.grid2}>
          <Field label="保有額" value={holdingInput.amount} onChange={(e) => setHoldingInput({ ...holdingInput, amount: e.target.value })} suffix="円" />
          <Field label="想定年率" value={holdingInput.rate} onChange={(e) => setHoldingInput({ ...holdingInput, rate: e.target.value })} suffix="%" hint="候補選択で自動入力、手動でも変更可" />
        </div>
      </div>
      <button style={{ ...styles.primaryBtn, marginTop: 14 }} onClick={addHolding}>登録する</button>

      {holdings.length > 0 && (
        <div style={{ ...styles.ledger, marginTop: 18 }}>
          {holdings.map((h) => (
            <div key={h.id} style={styles.ledgerRow}>
              <div><div style={styles.ledgerLabel}>{h.name}</div><div style={styles.ledgerNote}>想定年率 {h.rate}%</div></div>
              <div style={styles.allocRight}>
                <div style={styles.ledgerValue}>¥{fmt(h.amount)}</div>
                <button style={styles.removeBtn} onClick={() => removeHolding(h.id)}>×</button>
              </div>
            </div>
          ))}
          <div style={styles.totalLine}>株式・投資信託の合計：<span style={styles.totalValue}>¥{fmt(totalHoldingsValue)}</span></div>
        </div>
      )}
    </div>
  );
}

function AssetBaseline({ assetInput, setAssetInput, holdings, holdingInput, setHoldingInput, addHolding, removeHolding, showSuggest, setShowSuggest, pickPreset, totalHoldingsValue, otherAssets, updateOtherAsset, updateOtherAssetLabel, updateOtherAssetRate, addOtherAssetRow, removeOtherAsset, otherAssetsTotal, onNext, onBack }) {
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
        holdings={holdings} holdingInput={holdingInput} setHoldingInput={setHoldingInput} addHolding={addHolding}
        removeHolding={removeHolding} showSuggest={showSuggest} setShowSuggest={setShowSuggest} pickPreset={pickPreset}
        totalHoldingsValue={totalHoldingsValue}
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
  const { dashView, setDashView, planningFlow, setPlanningFlow, riskProfile, setRiskProfile } = props;
  const [showGlossary, setShowGlossary] = useState(false);
  const navItems = [
    { key: "overview", label: "概要" },
    { key: "ranking", label: "ランキング" },
    { key: "simulator", label: "配分シミュレーター" },
    { key: "holdings", label: "保有資産" },
    { key: "income", label: "収入実績" },
    { key: "expense", label: "支出実績" },
    { key: "settings", label: "設定" },
  ];

  if (planningFlow) {
    return (
      <div style={styles.page}>
        <div style={styles.shell}>
          <div style={styles.header}>
            <div style={styles.brand}><LogoIcon /> MyBanker</div>
          </div>
          {planningFlow === "risk" && (
            <RiskStep riskProfile={riskProfile} setRiskProfile={setRiskProfile}
              onNext={() => setPlanningFlow("simulator")} onBack={() => setPlanningFlow(null)} />
          )}
          {planningFlow === "simulator" && (
            <div>
              <SimulatorPanel {...props} />
              <div style={{ ...styles.btnRow, marginTop: 18 }}>
                <button style={styles.ghostBtn} onClick={() => setPlanningFlow("risk")}>運用方針を直す</button>
                <button style={styles.primaryBtn} onClick={() => setPlanningFlow(null)}>完了してメイン画面へ</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.header}>
          <div style={styles.brand}><LogoIcon /> MyBanker</div>
          <button style={styles.glossaryBtn} onClick={() => setShowGlossary(!showGlossary)}>？ 用語の説明</button>
        </div>
        {showGlossary && <Glossary onClose={() => setShowGlossary(false)} />}
        {dashView === "overview" && <Overview {...props} />}
        {dashView === "ranking" && <RankingPanel {...props} />}
        {dashView === "simulator" && <SimulatorPanel {...props} />}
        {dashView === "holdings" && <HoldingsPanel {...props} />}
        {dashView === "income" && <IncomeTrackPanel {...props} />}
        {dashView === "expense" && <ExpenseTrackPanel {...props} />}
        {dashView === "settings" && <SettingsPanel {...props} />}

        <div style={styles.navBar}>
          {navItems.map((n) => (
            <button key={n.key} onClick={() => setDashView(n.key)} style={dashView === n.key ? styles.navItemActive : styles.navItem}>{n.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Overview({ totalNetWorth, totalHoldingsValue, assetLogs, monthlyFree, totalExpense, monthlyIncomeComputed, bonusHandling, annualIncomeEstimateNet, projection, riskProfile, annualIncomeEstimateGross, furusatoApprox, allocNums, holdings, goalCompareData, userAge, ageDecade, assetPercentile, projectionSeriesKeys, SERIES_COLORS, setDashView, setPlanningFlow }) {
  const lastCompare = goalCompareData[goalCompareData.length - 1];
  const diff = lastCompare ? lastCompare.実際の資産 - lastCompare.計画上の想定 : null;
  const lastLog = assetLogs[assetLogs.length - 1];
  const [openCard, setOpenCard] = useState(null);
  const toggle = (key) => setOpenCard(openCard === key ? null : key);

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>概要</p>
      <h2 style={styles.h2}>あなたの資産の今</h2>

      <div style={styles.summaryRow}>
        <div style={styles.summaryItemLg} onClick={() => toggle("total")}>
          <span style={styles.summaryLabel}>総資産（推定）　<span style={styles.tapHint}>タップで内訳</span></span>
          <span style={styles.summaryValueLg}>¥{fmt(totalNetWorth)}</span>
        </div>
        <div style={styles.summaryItem} onClick={() => toggle("free")}>
          <span style={styles.summaryLabel}>毎月の自由資金　<span style={styles.tapHint}>タップで根拠</span></span>
          <span style={styles.summaryValue}>¥{fmt(monthlyFree)}</span>
        </div>
        <div style={styles.summaryItem} onClick={() => toggle("holdings")}>
          <span style={styles.summaryLabel}>個別保有資産の合計　<span style={styles.tapHint}>タップで詳細</span></span>
          <span style={styles.summaryValue}>¥{fmt(totalHoldingsValue)}</span>
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
        <p style={styles.chartTitle}>同年代（{ageDecade}代・{userAge}歳）との比較</p>
        <div style={styles.percentileRow}>
          <div style={styles.percentileBig}>上位 {assetPercentile}%</div>
          <div style={styles.percentileNote}>総資産が同年代の中でこの位置にいる目安です</div>
        </div>
        <p style={styles.chartNote}>※ 金融経済教育推進機構(J-FLEC)の公表値を参考にした簡易的な推定値で、厳密な統計分布ではありません。</p>
        <button style={styles.rankingLinkBtn} onClick={() => setDashView("ranking")}>他のランキングも見る →</button>
      </div>

      <div style={styles.chartCard}>
        <div style={styles.chartTitleRow}>
          <p style={styles.chartTitle}>資産の推移予想（{RISK_PROFILES[riskProfile].label}）</p>
          <button style={styles.planBtn} onClick={() => setPlanningFlow("risk")}>積立プランを決めて将来の資産推移を見る</button>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={projection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#5C6862" }} />
            <YAxis tick={{ fontSize: 11, fill: "#5C6862" }} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
            <Tooltip formatter={(v) => `¥${fmt(v)}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="貯金" stackId="1" stroke="#2F6B4F" fill="#9FC4AC" />
            {projectionSeriesKeys.map((key, i) => (
              <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.45} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        <p style={styles.chartNote}>※ 株式投資は月次の複利、その他資産（暗号資産・FXなど）は年率の複利で概算しています。想定年率自体の確実性は資産ごとに異なります（特に暗号資産は不確実性が高めです）。</p>
      </div>

      {diff !== null && (
        <div style={styles.statusBanner2(diff >= 0)}>
          {diff >= 0 ? `計画より ¥${fmt(diff)} 多く資産が積み上がっています。このペースを維持しましょう。` : `計画より ¥${fmt(Math.abs(diff))} 資産の積み上がりが少ない状況です。配分シミュレーターで見直してみましょうか。`}
        </div>
      )}

      {goalCompareData.length > 1 && (
        <div style={styles.chartCard}>
          <p style={styles.chartTitle}>計画上の想定 vs 実際の資産（振り返り）</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={goalCompareData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5C6862" }} />
              <YAxis tick={{ fontSize: 11, fill: "#5C6862" }} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
              <Tooltip formatter={(v) => `¥${fmt(v)}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="計画上の想定" stroke="#9AA6A0" strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="実際の資産" stroke="#3D5A99" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
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

function PaywallGate({ isPremium, setIsPremium, myReferralCode, incomingReferralCode, children }) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  if (isPremium) return <div>{children}</div>;
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
      <div style={{ marginTop: 8 }}>
        <p style={styles.chartTitle}>サンプル画面（参考用・全員共通の例です）</p>
        <div style={styles.percentileRow}>
          <div style={{ ...styles.percentileBig, fontSize: 22 }}>上位 {SAMPLE_INCOME_PERCENTILE}%</div>
          <div style={styles.percentileNote}>例：年収の同年代での位置イメージ</div>
        </div>
        <ResponsiveContainer width="100%" height={140}>
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
        </ResponsiveContainer>
        <p style={styles.youAreHereNote}>● オレンジ＝サンプル上の「あなたの位置」イメージ</p>
        <p style={styles.chartNote}>※ 実際のあなたのデータではなく、画面イメージをつかむためのサンプルです。</p>
      </div>

      <div style={styles.paywallCard}>
        <p style={styles.paywallTitle}>ここから先はプレミアム会員限定です</p>
        <p style={styles.paywallDesc}>
          同年代の人との貯蓄・年収・支出の比較や分布グラフの表示、資産が増えているペースのランキングなど、より詳しく「自分の立ち位置」がわかります。
        </p>
        <div style={styles.paywallPriceRow}>
          <span style={styles.paywallPrice}>月額 ¥500</span>
          <span style={styles.paywallNote}>友人を1人紹介すると、その月は無料</span>
        </div>
        {incomingReferralCode && (
          <p style={styles.hint}>紹介コード「{incomingReferralCode}」を適用して登録します。</p>
        )}
        <div style={styles.paywallBtnRow}>
          <button style={styles.primaryBtn} onClick={handleCheckout} disabled={loading}>
            {loading ? "決済ページへ移動中..." : "登録する（¥500/月）"}
          </button>
        </div>
        {errorMsg && <p style={styles.warnText}>{errorMsg}</p>}

        {myReferralCode && (
          <div style={{ marginTop: 16 }}>
            <p style={styles.fieldLabel}>あなたの紹介リンク（友人がこのリンクから登録すると、あなたが1ヶ月無料に）</p>
            <div style={styles.fieldInputRow}>
              <input style={styles.input} value={referralUrl} readOnly />
              <button style={styles.ghostBtn} onClick={handleCopy}>{copied ? "コピーしました" : "コピー"}</button>
            </div>
          </div>
        )}

        <button style={styles.testToggleBtn} onClick={() => setIsPremium(true)}>（テスト用）プレミアム表示を確認する</button>
      </div>
    </div>
  );
}

function RankingPanel(props) {
  const {
    isPremium, setIsPremium, userAge, ageDecade, assetPercentile, totalNetWorth,
    assetDistribution, incomePercentile, incomeDistribution, annualIncomeEstimateGross,
    expenseCategoryComparison, savingsRatePeer, savingsRateUser, savingsRateDiff,
    growthRateInfo, peerMonthlyExpense, expenseDiffVsPeer, expenseDiffPct,
    myReferralCode, incomingReferralCode,
  } = props;
  const ageStats = AGE_STATS[ageDecade];
  const incomeStats = INCOME_STATS[ageDecade];
  const assetHighlightIdx = findBucketIndex(assetDistribution, totalNetWorth / 10000);
  const incomeHighlightIdx = findBucketIndex(incomeDistribution, annualIncomeEstimateGross / 10000);

  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>ランキング</p>
      <h2 style={styles.h2}>同年代（{ageDecade}代・{userAge}歳）との比較</h2>

      <div style={styles.percentileRow}>
        <div style={styles.percentileBig}>上位 {assetPercentile}%</div>
        <div style={styles.percentileNote}>総資産（¥{fmt(totalNetWorth)}）が同年代の中でこの位置にいる目安です</div>
      </div>

      {isPremium && (
        <>
          <div style={{ marginTop: 16 }}>
            <p style={styles.chartTitle}>総資産の分布（推定モデル）</p>
            <ResponsiveContainer width="100%" height={160}>
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
            </ResponsiveContainer>
            <p style={styles.youAreHereNote}>● オレンジ＝あなたの位置（万円単位の帯）</p>
            <div style={styles.statPairRow}>
              <span>平均 ¥{fmt(ageStats.mean * 10000)}</span>
              <span>中央値 ¥{fmt(ageStats.median * 10000)}</span>
            </div>
            <p style={styles.chartNote}>※ 平均値・中央値から推定した分布モデルで、実際の刻み別統計ではありません。</p>
          </div>
        </>
      )}

      <div style={styles.divider} />

      <PaywallGate isPremium={isPremium} setIsPremium={setIsPremium} myReferralCode={myReferralCode} incomingReferralCode={incomingReferralCode}>
        <div>
          <p style={styles.chartTitle}>年収の同年代比較</p>
          <div style={styles.percentileRow}>
            <div style={{ ...styles.percentileBig, fontSize: 22 }}>上位 {incomePercentile}%</div>
            <div style={styles.percentileNote}>想定年収（額面 ¥{fmt(annualIncomeEstimateGross)}）の位置の目安です</div>
          </div>
          <ResponsiveContainer width="100%" height={140}>
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
          </ResponsiveContainer>
          <p style={styles.youAreHereNote}>● オレンジ＝あなたの位置（万円単位の帯）</p>
          <div style={styles.statPairRow}>
            <span>平均 ¥{fmt(incomeStats.mean * 10000)}</span>
            <span>中央値 ¥{fmt(incomeStats.median * 10000)}</span>
          </div>
          <p style={styles.chartNote}>※ doda「平均年収ランキング2025」（2025年12月発表）の年代別データを参考にした概算です。60代・70代は同調査の対象外のため独自の概算です。</p>

          <div style={styles.divider} />

          <p style={styles.chartTitle}>支出の同年代比較（月額・費目別）</p>
          <div style={styles.statusBanner2(expenseDiffVsPeer <= 0)}>
            合計で同年代平均（¥{fmt(peerMonthlyExpense)}）より{expenseDiffVsPeer > 0 ? `¥${fmt(Math.abs(expenseDiffVsPeer))}（+${Math.abs(expenseDiffPct)}%）多い` : `¥${fmt(Math.abs(expenseDiffVsPeer))}（${expenseDiffPct}%）少ない`}目安です
          </div>
          <div style={styles.ledger}>
            {expenseCategoryComparison.map((c) => (
              <div key={c.label} style={styles.ledgerRow}>
                <span style={styles.ledgerLabel}>{c.label}</span>
                <span style={{ ...styles.ledgerValue, color: c.diffPct > 0 ? "#9A4A1F" : "#2F6B4F" }}>
                  {c.diffPct > 0 ? `+${c.diffPct}%` : `${c.diffPct}%`}（¥{fmt(c.userAmount)} / 平均¥{fmt(c.peerAmount)}）
                </span>
              </div>
            ))}
          </div>
          <p style={styles.chartNote}>※ 費目別シェアは総務省「家計調査」の単身世帯データを参考にした概算配分です。</p>

          <div style={styles.divider} />

          <p style={styles.chartTitle}>貯蓄率の同年代比較</p>
          <div style={styles.percentileRow}>
            <div style={{ ...styles.percentileBig, fontSize: 22, color: savingsRateDiff >= 0 ? "#2F6B4F" : "#9A4A1F" }}>{savingsRateUser}%</div>
            <div style={styles.percentileNote}>収入に対する貯蓄・投資の割合。同年代平均は{savingsRatePeer}%です（{savingsRateDiff >= 0 ? "+" : ""}{savingsRateDiff}pt）</div>
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

function SimulatorPanel({ monthlyFree, totalExpense, bonusHandling, bonusAnnualNet, alloc, setAlloc, setAllocTouched, allocNums, allocTotal, allocOver, allocUnder, bonusAlloc, setBonusAlloc, bonusAllocNums, bonusPctTotal, riskProfile, setRiskProfile, projection, furusatoApprox, annualIncomeEstimateNet, annualIncomeEstimateGross, resetAllocToDefault, holdings, holdingInput, setHoldingInput, addHolding, removeHolding, showSuggest, setShowSuggest, pickPreset, totalHoldingsValue, nisaSplits, setNisaSplits, nisaSplitTotal, nisaSplitPctTotal, nisaUnassignedAmount, nisaSplitOver, projectionSeriesKeys, SERIES_COLORS, otherHoldings, otherHoldingInput, setOtherHoldingInput, addOtherHolding, removeOtherHolding, showOtherSuggest, setShowOtherSuggest, pickOtherPreset, otherSplits, setOtherSplits, otherSplitTotal, otherSplitPctTotal, otherUnassignedAmount, otherSplitOver }) {
  const [showAddHolding, setShowAddHolding] = useState(false);
  const [showAddOtherHolding, setShowAddOtherHolding] = useState(false);
  const onChangeAlloc = (key) => (e) => { setAllocTouched(true); setAlloc({ ...alloc, [key]: e.target.value }); };
  const onChangeBonusAlloc = (key) => (e) => setBonusAlloc({ ...bonusAlloc, [key]: e.target.value });
  const onChangeNisaSplit = (holdingId) => (e) => setNisaSplits({ ...nisaSplits, [holdingId]: e.target.value });
  const onChangeOtherSplit = (holdingId) => (e) => setOtherSplits({ ...otherSplits, [holdingId]: e.target.value });
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
          <span style={styles.fieldLabel}>この株式投資額（¥{fmt(allocNums.nisa)}）を、複数の銘柄に分けて%で割り当てられます（任意）</span>
          {holdings.length === 0 ? (
            <p style={styles.hint}>まだ銘柄が登録されていないので、追加投資はコースの想定利率（{(RISK_PROFILES[riskProfile].rate * 100).toFixed(1)}%）で計算されます。</p>
          ) : (
            <>
              {holdings.map((h) => (
                <div key={h.id} style={styles.nisaSplitRow}>
                  <span style={styles.nisaSplitLabel}>{h.name}（年率{h.rate}%）</span>
                  <div style={styles.allocRight}>
                    <div style={styles.fieldInputRow}>
                      <NumInput value={nisaSplits[h.id] || ""} onChange={onChangeNisaSplit(h.id)} placeholder="0" />
                      <span style={styles.suffix}>%</span>
                    </div>
                    <div style={styles.allocPct}>¥{fmt(allocNums.nisa * ((Number(nisaSplits[h.id]) || 0) / 100))}</div>
                  </div>
                </div>
              ))}
              <div style={{ ...styles.allocTotalBar, ...(nisaSplitOver ? styles.allocTotalError : {}) }}>
                銘柄への割り当て合計：{Math.round(nisaSplitPctTotal)}%（¥{fmt(nisaSplitTotal)} / ¥{fmt(allocNums.nisa)}）
                {nisaSplitOver && <span style={styles.errorText}>　100%を超えています。</span>}
              </div>
              <p style={styles.hint}>
                残り ¥{fmt(nisaUnassignedAmount)} は未割り当てとして、コースの想定利率（{(RISK_PROFILES[riskProfile].rate * 100).toFixed(1)}%）で計算されます。登録済みの銘柄は、割り当てがなくても既存の保有額がそれぞれ自分自身の利率で計算され続けます。
              </p>
            </>
          )}

          {!showAddHolding ? (
            <button style={styles.addRowBtn} onClick={() => setShowAddHolding(true)}>+ 銘柄を追加する</button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <HoldingsEditor
                holdings={holdings} holdingInput={holdingInput} setHoldingInput={setHoldingInput} addHolding={addHolding}
                removeHolding={removeHolding} showSuggest={showSuggest} setShowSuggest={setShowSuggest} pickPreset={pickPreset}
                totalHoldingsValue={totalHoldingsValue}
              />
              <button style={{ ...styles.ghostBtn, marginTop: 8 }} onClick={() => setShowAddHolding(false)}>閉じる</button>
            </div>
          )}
        </div>

        <AllocRow label="その他運用（iDeCoなど）" pctValue={alloc.other} onChange={onChangeAlloc("other")} amount={allocNums.other} note="所得控除など税制メリットがある場合があります" accent="#7A5C3D" />

        <div style={styles.nisaTargetBox}>
          <span style={styles.fieldLabel}>このその他運用額（¥{fmt(allocNums.other)}）も、暗号資産・FX・ポイントなどの項目に分けて%で割り当てられます（任意）</span>
          {otherHoldings.length === 0 ? (
            <p style={styles.hint}>まだ項目が登録されていないので、追加投資はコースの想定利率（{(RISK_PROFILES[riskProfile].rate * 100).toFixed(1)}%）で計算されます。</p>
          ) : (
            <>
              {otherHoldings.map((h) => (
                <div key={h.id} style={styles.nisaSplitRow}>
                  <span style={styles.nisaSplitLabel}>{h.name}（年率{h.rate}%）</span>
                  <div style={styles.allocRight}>
                    <div style={styles.fieldInputRow}>
                      <NumInput value={otherSplits[h.id] || ""} onChange={onChangeOtherSplit(h.id)} placeholder="0" />
                      <span style={styles.suffix}>%</span>
                    </div>
                    <div style={styles.allocPct}>¥{fmt(allocNums.other * ((Number(otherSplits[h.id]) || 0) / 100))}</div>
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
            <button style={styles.addRowBtn} onClick={() => setShowAddOtherHolding(true)}>+ 項目を追加する（例：暗号資産、FX、ポイントなど）</button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <HoldingsEditor
                holdings={otherHoldings} holdingInput={otherHoldingInput} setHoldingInput={setOtherHoldingInput} addHolding={addOtherHolding}
                removeHolding={removeOtherHolding} showSuggest={showOtherSuggest} setShowSuggest={setShowOtherSuggest} pickPreset={pickOtherPreset}
                totalHoldingsValue={otherHoldings.reduce((s, h) => s + (Number(h.amount) || 0), 0)}
              />
              <button style={{ ...styles.ghostBtn, marginTop: 8 }} onClick={() => setShowAddOtherHolding(false)}>閉じる</button>
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
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={projection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#5C6862" }} />
            <YAxis tick={{ fontSize: 11, fill: "#5C6862" }} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
            <Tooltip formatter={(v) => `¥${fmt(v)}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="貯金" stackId="1" stroke="#2F6B4F" fill="#9FC4AC" />
            {projectionSeriesKeys.map((key, i) => (
              <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.45} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
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

function HoldingsPanel({ assetInput, setAssetInput, addAssetLog, assetLogs, updateAssetLog, deleteAssetLog, goalCompareData, holdings, holdingInput, setHoldingInput, addHolding, removeHolding, showSuggest, setShowSuggest, pickPreset, totalHoldingsValue, otherAssets, updateOtherAsset, updateOtherAssetLabel, updateOtherAssetRate, addOtherAssetRow, removeOtherAsset, otherAssetsTotal, holdingsLogs, saveHoldingsSnapshot, updateHoldingsLogItem, deleteHoldingsLog }) {
  const last = assetLogs[assetLogs.length - 1];
  const [openLogId, setOpenLogId] = useState(null);
  const todayLabel = new Date().toLocaleDateString("ja-JP");
  const sortedLogs = [...assetLogs].sort((a, b) => b.id - a.id);
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>保有資産</p>
      <h2 style={styles.h2}>資産を更新・登録しましょう</h2>
      <p style={styles.hint}>本日（{todayLabel}）の記録としてこの内容が保存されます。同じ日にもう一度記録すると、その日の内容が更新されます。</p>

      <p style={styles.chartTitle}>資産カテゴリの更新</p>
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
      <button style={{ ...styles.primaryBtn, marginTop: 14 }} onClick={addAssetLog}>{todayLabel}の記録として保存する</button>
      {last && last.impliedSpending !== undefined && (
        <div style={styles.statusBanner2(last.impliedSpending <= 0)}>前回記録との差分から、今期の実質支出は約 ¥{fmt(last.impliedSpending)} と推定されます。</div>
      )}

      {goalCompareData.length > 1 && (
        <div style={styles.chartCard}>
          <p style={styles.chartTitle}>計画上の想定 vs 実際の資産</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={goalCompareData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E3E9E4" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5C6862" }} />
              <YAxis tick={{ fontSize: 11, fill: "#5C6862" }} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
              <Tooltip formatter={(v) => `¥${fmt(v)}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="計画上の想定" stroke="#9AA6A0" strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="実際の資産" stroke="#3D5A99" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {sortedLogs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <p style={styles.chartTitle}>資産の記録履歴（内訳・銘柄ごとも含む）</p>
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
                            <span style={styles.ledgerLabel}>{it.name}</span>
                            <span style={styles.ledgerNote}>¥{fmt(it.amount)}（年率{it.rate}%）</span>
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
                            <span style={styles.ledgerNote}>¥{fmt(it.amount)}</span>
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
        holdings={holdings} holdingInput={holdingInput} setHoldingInput={setHoldingInput} addHolding={addHolding}
        removeHolding={removeHolding} showSuggest={showSuggest} setShowSuggest={setShowSuggest} pickPreset={pickPreset}
        totalHoldingsValue={totalHoldingsValue}
      />
      <p style={styles.hint}>登録・編集した内容は、上の「{todayLabel}の記録として保存する」ボタンを押すと記録に反映されます。</p>
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
  const sections = [
    { key: "income", label: "収入" }, { key: "expense", label: "支出" },
    { key: "risk", label: "運用方針" }, { key: "review", label: "振り返り設定" },
  ];
  return (
    <div style={styles.card}>
      <p style={styles.eyebrow}>設定</p>
      <h2 style={styles.h2}>初期設定を編集</h2>
      <div style={styles.toggleRow}>
        {sections.map((s) => <button key={s.key} style={section === s.key ? styles.toggleActive : styles.toggleInactive} onClick={() => setSection(s.key)}>{s.label}</button>)}
      </div>
      {section === "income" && <IncomeStep {...props} onNext={() => {}} onBack={() => {}} />}
      {section === "expense" && <ExpenseStep {...props} onNext={() => {}} onBack={() => {}} />}
      {section === "risk" && <RiskStep riskProfile={props.riskProfile} setRiskProfile={props.setRiskProfile} onNext={() => {}} onBack={() => {}} />}
      {section === "review" && <ReviewSettingsInner {...props} />}
    </div>
  );
}

function ReviewSettingsInner({ reviewSpan, setReviewSpan, email, setEmail }) {
  return (
    <div>
      <div style={styles.spanGrid}>
        {Object.entries(REVIEW_SPANS).map(([key, label]) => (
          <button key={key} onClick={() => setReviewSpan(key)} style={reviewSpan === key ? styles.toggleActive : styles.toggleInactive}>{label}</button>
        ))}
      </div>
      <div style={{ marginTop: 20 }}>
        <Field label="通知用メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} hint="このプロトタイプでは実際の送信は行われません" />
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#EAF2EC", display: "flex", justifyContent: "center", padding: "40px 16px 100px", fontFamily: "'Source Sans 3', 'Hiragino Sans', sans-serif" },
  shell: { width: "100%", maxWidth: 700, position: "relative" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 10 },
  brand: { fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, color: "#1F2630", display: "flex", alignItems: "center", gap: 6 },
  brandMark: { color: "#B5582E" },
  stepRow: { display: "flex", gap: 9, flexWrap: "wrap" },
  stepLabel: { fontSize: 10.2, color: "#1F2630" },
  card: { background: "#FBFAF6", border: "1px solid #D8E2DA", borderRadius: 18, padding: "32px 30px", boxShadow: "0 1px 0 rgba(31,38,48,0.04)" },
  eyebrow: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.08em", color: "#B5582E", marginBottom: 10, textTransform: "uppercase" },
  h1: { fontFamily: "'Fraunces', serif", fontSize: 22, lineHeight: 1.4, color: "#1F2630", margin: "0 0 16px", fontWeight: 600 },
  h2: { fontFamily: "'Fraunces', serif", fontSize: 20, color: "#1F2630", margin: "0 0 14px", fontWeight: 600 },
  lead: { fontSize: 14.5, lineHeight: 1.8, color: "#3D4A45", marginBottom: 22 },
  calcNote: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#7A6F4E", background: "#F1F0E8", padding: "8px 12px", borderRadius: 8, marginBottom: 20, display: "inline-block" },
  primaryBtn: { background: "#1F2630", color: "#FBFAF6", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  ghostBtn: { background: "transparent", color: "#1F2630", border: "1px solid #D8E2DA", borderRadius: 10, padding: "12px 22px", fontSize: 14, cursor: "pointer" },
  btnRow: { display: "flex", justifyContent: "space-between", marginTop: 26 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 8 },
  grid3: { display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 14, marginBottom: 8 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { fontSize: 12, color: "#5C6862" },
  fieldInputRow: { display: "flex", alignItems: "center", border: "1px solid #D8E2DA", borderRadius: 8, padding: "8px 12px", background: "#fff" },
  readOnlyValueRow: { fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: "#5C6862", border: "1px solid #E3E9E4", borderRadius: 8, padding: "8px 12px", background: "#F1F4F1" },
  historyRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #EDF1EE", cursor: "pointer" },
  historyDetail: { padding: "14px 16px 18px", borderBottom: "1px solid #EDF1EE", background: "#FAFAF7" },
  deleteLogBtn: { marginTop: 12, background: "transparent", border: "1px solid #E3B5A8", color: "#9A1F1F", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" },
  input: { border: "none", outline: "none", fontSize: 15, fontFamily: "'JetBrains Mono', monospace", width: "100%", background: "transparent", color: "#1F2630" },
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
  otherAssetCardRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  otherAssetFieldWrap: { display: "flex", flexDirection: "column", gap: 4 },
  expenseLabel: { fontSize: 13.5, color: "#1F2630" },
  expenseLabelInput: { fontSize: 13.5, color: "#1F2630", border: "1px solid #D8E2DA", borderRadius: 8, padding: "8px 10px", outline: "none" },
  removeBtn: { background: "transparent", border: "none", color: "#B5582E", fontSize: 18, cursor: "pointer" },
  addRowBtn: { background: "transparent", border: "1px dashed #B6C4BB", borderRadius: 8, padding: "10px", fontSize: 13, color: "#5C6862", cursor: "pointer", marginTop: 4 },
  totalLine: { fontSize: 13.5, color: "#3D4A45", marginTop: 12, borderTop: "1px solid #E3E9E4", paddingTop: 12 },
  totalValue: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#1F2630" },
  riskGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  riskCard: { textAlign: "left", background: "#fff", border: "1px solid #D8E2DA", borderRadius: 12, padding: "16px 14px", cursor: "pointer" },
  riskCardActive: { textAlign: "left", background: "#1F2630", border: "1px solid #1F2630", borderRadius: 12, padding: "16px 14px", cursor: "pointer", color: "#fff" },
  riskLabel: { fontSize: 14, fontWeight: 700, marginBottom: 6 },
  riskRate: { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, opacity: 0.85 },
  riskNote: { fontSize: 11, opacity: 0.7, marginTop: 6, lineHeight: 1.5 },
  riskPicker: { display: "flex", gap: 8 },
  riskPickerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 10 },
  resetLink: { background: "transparent", border: "none", color: "#3D5A99", fontSize: 12, cursor: "pointer", textDecoration: "underline" },
  pill: { border: "1px solid #D8E2DA", background: "transparent", borderRadius: 20, padding: "6px 14px", fontSize: 12.5, cursor: "pointer", color: "#1F2630" },
  pillActive: { border: "1px solid #1F2630", background: "#1F2630", borderRadius: 20, padding: "6px 14px", fontSize: 12.5, cursor: "pointer", color: "#fff" },
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
  navBar: { position: "fixed", bottom: 0, left: 0, right: 0, background: "#FBFAF6", borderTop: "1px solid #D8E2DA", display: "flex", justifyContent: "center", gap: 6, padding: "10px 12px", flexWrap: "wrap", zIndex: 20 },
  navItem: { background: "transparent", border: "none", color: "#5C6862", fontSize: 12, padding: "8px 12px", borderRadius: 8, cursor: "pointer" },
  navItemActive: { background: "#1F2630", border: "none", color: "#fff", fontSize: 12, padding: "8px 12px", borderRadius: 8, cursor: "pointer" },
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
  paywallPriceRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 },
  paywallPrice: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, color: "#B5582E" },
  paywallNote: { fontSize: 11.5, color: "#6B6248" },
  paywallBtnRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  testToggleBtn: { marginTop: 14, background: "transparent", border: "none", color: "#3D5A99", fontSize: 11, textDecoration: "underline", cursor: "pointer" },
  statPairRow: { display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#5C6862", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" },
  youAreHereNote: { fontSize: 11, color: "#B5582E", marginTop: 4 },
};
