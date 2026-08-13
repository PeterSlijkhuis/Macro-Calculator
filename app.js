"use strict";

/* ---------- constants ---------- */

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const KCAL_PER_KG_FAT = 7700; // energy in ~1 kg of body fat
const HRT_SETTLE_MONTHS = 6;  // metabolic shift settles over ~first 6 months of HRT
const MAX_DEFICIT_FRACTION = 0.25; // beyond this, flag the deficit as risky
const MIN_CALORIES = 1200;    // below this, flag as too low without supervision

// Slider bounds, expressed as a multiple of reference body weight (g/kg).
const PROTEIN_GKG_MIN = 1.0, PROTEIN_GKG_MAX = 3.0;
const FAT_GKG_MIN = 0.4, FAT_GKG_MAX = 1.6;
const CARB_GKG_MAX = 6.0; // carbs slider always starts at 0

const REGISTER_KEY = "macro-calc-register";

const $ = (id) => document.getElementById(id);

/* ---------- explanation register (academic / conversational) ---------- */

function currentRegister() {
  return document.documentElement.dataset.register === "conversational" ? "conversational" : "academic";
}

function applyRegister(value) {
  document.documentElement.dataset.register = value === "conversational" ? "conversational" : "academic";
}

/* ---------- translation (language + register) ---------- */

function translatePage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  document.title = t("page_title");
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", t("meta_description"));
}

function populateLangSelect() {
  const select = $("lang-select");
  if (!select || select.options.length) return;
  select.innerHTML = LANGUAGES.map((l) => `<option value="${l.code}">${l.label}</option>`).join("");
}

function loadLang() {
  let code = "en";
  try { code = localStorage.getItem(LANG_KEY) || "en"; } catch { /* private mode */ }
  applyLang(code);
  const select = $("lang-select");
  if (select) select.value = currentLang();
}

function saveLang(code) {
  try { localStorage.setItem(LANG_KEY, code); } catch { /* private mode */ }
}

/* ---------- unit handling ---------- */

function currentUnits() {
  return $("units-imperial").checked ? "imperial" : "metric";
}

function readWeightKg(inputEl) {
  const v = parseFloat(inputEl.value);
  if (!Number.isFinite(v)) return NaN;
  return currentUnits() === "imperial" ? v * KG_PER_LB : v;
}

function readHeightCm() {
  if (currentUnits() === "imperial") {
    const ft = parseFloat($("height-ft").value);
    const inch = parseFloat($("height-in").value);
    if (!Number.isFinite(ft)) return NaN;
    return (ft * 12 + (Number.isFinite(inch) ? inch : 0)) * CM_PER_IN;
  }
  return parseFloat($("height-cm").value);
}

function fmtWeight(kg) {
  if (currentUnits() === "imperial") return `${(kg / KG_PER_LB).toFixed(1)} lb`;
  return `${kg.toFixed(1)} kg`;
}

function syncUnitFields() {
  const units = currentUnits();
  document.querySelectorAll("[data-units]").forEach((el) => {
    el.hidden = el.dataset.units !== units;
  });
  document.querySelectorAll("[data-weight-unit]").forEach((el) => {
    el.textContent = units === "imperial" ? "lb" : "kg";
  });
}

// Convert the values in weight/height fields when the unit system flips,
// so switching doesn't silently reinterpret 85 kg as 85 lb.
let lastUnits = "metric";
function convertFieldValues() {
  const units = currentUnits();
  if (units === lastUnits) return;

  for (const id of ["weight", "target-weight"]) {
    const el = $(id);
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) {
      el.value = (units === "imperial" ? v / KG_PER_LB : v * KG_PER_LB).toFixed(1);
    }
  }

  if (units === "imperial") {
    const cm = parseFloat($("height-cm").value);
    if (Number.isFinite(cm)) {
      const totalIn = cm / CM_PER_IN;
      $("height-ft").value = Math.floor(totalIn / 12);
      $("height-in").value = (totalIn % 12).toFixed(1).replace(/\.0$/, "");
    }
  } else {
    const ft = parseFloat($("height-ft").value);
    const inch = parseFloat($("height-in").value) || 0;
    if (Number.isFinite(ft)) {
      $("height-cm").value = ((ft * 12 + inch) * CM_PER_IN).toFixed(1);
    }
  }
  lastUnits = units;
}

/* ---------- hormonal profile ---------- */

/**
 * Returns a blend factor b in [0, 1]:
 * 0 = typical estrogen-dominant metabolism, 1 = typical testosterone-dominant.
 * The Mifflin-St Jeor sex constant is interpolated: s = -161 + 166 * b.
 *
 * For people on HRT the factor shifts linearly from the pre-HRT profile to the
 * hormone-matched profile over the first HRT_SETTLE_MONTHS months, reflecting
 * that resting metabolism tracks hormone-driven body composition changes.
 */
function profileBlend() {
  const profile = $("profile").value;
  const months = Math.max(0, parseFloat($("hrt-months").value) || 0);
  const t = Math.min(months / HRT_SETTLE_MONTHS, 1);

  switch (profile) {
    case "male": return 1;
    case "female": return 0;
    case "transfem": return 1 - t;    // testosterone-dominant -> estrogen-dominant
    case "transmasc": return t;       // estrogen-dominant -> testosterone-dominant
    case "custom": return (parseFloat($("blend").value) || 50) / 100;
    default: return 0.5;
  }
}

/* ---------- macro sliders: bounds, reading, zones ---------- */

/**
 * Reference weight for protein/fat dosing. For higher body-fat levels the
 * target weight is a better proxy for lean mass than current weight.
 */
function refWeightKg() {
  const weightKg = readWeightKg($("weight"));
  const targetKg = readWeightKg($("target-weight"));
  const heightCm = readHeightCm();
  if (![weightKg, targetKg, heightCm].every(Number.isFinite) || heightCm < 100) return NaN;
  const bmi = weightKg / Math.pow(heightCm / 100, 2);
  return bmi >= 30 ? Math.min(weightKg, Math.max(targetKg, weightKg * 0.75)) : weightKg;
}

function proteinGramsInput() {
  const v = parseFloat($("protein-g").value);
  return Number.isFinite(v) ? v : 170;
}

function fatGramsInput() {
  const v = parseFloat($("fat-g").value);
  return Number.isFinite(v) ? v : 68;
}

function carbGramsInput() {
  const v = parseFloat($("carbs-g").value);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Recomputes each slider's min/max (in whole grams) from current bodyweight,
 * updates the visible range-end labels, and clamps the slider's current
 * value into the new bounds. Protein and fat scale off the reference
 * weight; carbs scale off actual bodyweight, matching the carb zones.
 */
function updateSliderBounds() {
  const ref = refWeightKg();
  const weightKg = readWeightKg($("weight"));

  const bounds = [];
  if (Number.isFinite(ref)) {
    bounds.push(
      ["protein-g", "protein-min", "protein-max", Math.round(PROTEIN_GKG_MIN * ref), Math.round(PROTEIN_GKG_MAX * ref)],
      ["fat-g", "fat-min", "fat-max", Math.round(FAT_GKG_MIN * ref), Math.round(FAT_GKG_MAX * ref)]
    );
  }
  if (Number.isFinite(weightKg)) {
    bounds.push(["carbs-g", "carbs-min", "carbs-max", 0, Math.round(CARB_GKG_MAX * weightKg)]);
  }

  for (const [inputId, minId, maxId, min, max] of bounds) {
    const el = $(inputId);
    el.min = min;
    el.max = max;
    $(minId).textContent = min;
    $(maxId).textContent = max;
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) el.value = Math.min(Math.max(v, min), max);
  }
}

/**
 * What a given protein intake (g per kg body weight) means in a calorie
 * deficit: muscle retention, satiety, and the rest of the budget. Every
 * zone carries an i18n key resolved into label/text for the current
 * language and register.
 */
function proteinZone(gkg) {
  if (gkg < 1.4) return { key: "pz_risk", tone: "critical", icon: "⛔" };
  if (gkg < 1.6) return { key: "pz_bare", tone: "serious", icon: "⚠" };
  if (gkg <= 2.2) return { key: "pz_sweet", tone: "good", icon: "✓" };
  if (gkg <= 2.6) return { key: "pz_extra", tone: "neutral", icon: "🛡" };
  return { key: "pz_above", tone: "serious", icon: "⚠" };
}

/**
 * What a given fat intake (g per kg body weight) means for hormone health,
 * satiety, and total daily calories.
 */
function fatZone(gkg) {
  if (gkg < 0.6) return { key: "fz_risk", tone: "critical", icon: "⛔" };
  if (gkg < 0.75) return { key: "fz_close", tone: "serious", icon: "⚠" };
  if (gkg <= 1.1) return { key: "fz_sweet", tone: "good", icon: "✓" };
  if (gkg <= 1.35) return { key: "fz_higher", tone: "neutral", icon: "🥑" };
  return { key: "fz_costly", tone: "serious", icon: "⚠" };
}

/**
 * What a given carb intake (g per kg body weight) means for training fuel
 * and total daily calories. Carbs are also protein-sparing fuel: with
 * glycogen available the body has less reason to burn amino acids.
 */
function carbZone(gPerKg) {
  if (gPerKg < 0.75) return { key: "cz_keto", tone: "serious", icon: "⚠" };
  if (gPerKg < 2) return { key: "cz_low", tone: "neutral", icon: "🔋" };
  if (gPerKg <= 4) return { key: "cz_mod", tone: "good", icon: "✓" };
  return { key: "cz_high", tone: "good", icon: "🚀" };
}

function zoneLabel(zone) { return t(`${zone.key}_label`); }
function zoneText(zone) { return t(`${zone.key}_text`); }

function renderZone(outId, zoneId, gdayId, refKg, grams, zone, decimals) {
  $(outId).value = Math.round(grams);
  const gkg = Number.isFinite(refKg) && refKg > 0 ? grams / refKg : NaN;
  $(gdayId).textContent = Number.isFinite(gkg) ? `(${gkg.toFixed(decimals)} g/kg)` : "";
  $(zoneId).innerHTML = `
    <span class="zone-chip zone-${zone.tone}"><span aria-hidden="true">${zone.icon}</span> ${zoneLabel(zone)}</span>
    <p>${zoneText(zone)}</p>`;
}

function renderProteinZone() {
  const ref = refWeightKg();
  const grams = proteinGramsInput();
  renderZone("protein-out", "protein-zone", "protein-gday", ref, grams, proteinZone(grams / ref), 2);
}

function renderFatZone() {
  const ref = refWeightKg();
  const grams = fatGramsInput();
  renderZone("fat-out", "fat-zone", "fat-gday", ref, grams, fatZone(grams / ref), 2);
}

function renderCarbZone() {
  const weightKg = readWeightKg($("weight"));
  const grams = carbGramsInput();
  renderZone("carbs-out", "carbs-zone", "carbs-gday", weightKg, grams, carbZone(grams / weightKg), 1);
}

/* ---------- slider value bubbles ---------- */

const bubbleTimers = {};

function updateSliderBubble(input) {
  const wrap = input.closest(".slider-wrap");
  if (!wrap) return;
  const bubble = wrap.querySelector(".slider-bubble");
  const v = parseFloat(input.value);
  const ref = input.id === "carbs-g" ? readWeightKg($("weight")) : refWeightKg();
  const gkg = Number.isFinite(ref) && ref > 0 ? v / ref : NaN;
  bubble.innerHTML = Number.isFinite(gkg)
    ? `<strong>${Math.round(v)} g</strong>${gkg.toFixed(2)} g/kg`
    : `<strong>${Math.round(v)} g</strong>`;
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const frac = (v - min) / (max - min);
  // Track the thumb: percentage across the rail, corrected for the ~16px thumb
  bubble.style.left = `calc(${(frac * 100).toFixed(2)}% + ${((0.5 - frac) * 16).toFixed(1)}px)`;
}

function showSliderBubble(input) {
  const wrap = input.closest(".slider-wrap");
  if (!wrap) return;
  clearTimeout(bubbleTimers[input.id]);
  updateSliderBubble(input);
  wrap.querySelector(".slider-bubble").classList.add("show");
}

function hideSliderBubble(input, delay) {
  const wrap = input.closest(".slider-wrap");
  if (!wrap) return;
  clearTimeout(bubbleTimers[input.id]);
  bubbleTimers[input.id] = setTimeout(() => {
    wrap.querySelector(".slider-bubble").classList.remove("show");
  }, delay);
}

/* ---------- core calculation ---------- */

function calculate() {
  const age = parseFloat($("age").value);
  const heightCm = readHeightCm();
  const weightKg = readWeightKg($("weight"));
  const targetKg = readWeightKg($("target-weight"));
  const activity = parseFloat($("activity").value);
  const paceFraction = parseFloat($("pace").value);

  if (![age, heightCm, weightKg, targetKg].every(Number.isFinite)) return null;
  if (age < 16 || heightCm < 100 || weightKg < 30 || targetKg < 30) return null;

  const b = profileBlend();
  const sexConstant = -161 + 166 * b;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant;
  const tdee = bmr * activity;

  const warnings = [];
  const wantsToLose = targetKg < weightKg - 0.05;

  // Suggested target: the deficit implied by the chosen pace, capped at 25%
  // of maintenance. This is a reference figure only; actual intake below
  // comes independently from the three macro sliders.
  let targetCalories, suggestedDeficit;
  if (wantsToLose) {
    const paceDeficit = (paceFraction * weightKg * KCAL_PER_KG_FAT) / 7;
    const maxDeficit = MAX_DEFICIT_FRACTION * tdee;
    suggestedDeficit = Math.min(paceDeficit, maxDeficit);
    if (paceDeficit > maxDeficit * 1.05) {
      warnings.push(t("w_target_capped"));
    }
    targetCalories = tdee - suggestedDeficit;
  } else {
    suggestedDeficit = 0;
    targetCalories = tdee;
    warnings.push(t(targetKg > weightKg + 0.05 ? "w_target_above" : "w_target_equal"));
  }

  // Actual intake: protein, fat, and carbs are each set independently by
  // their own slider (in whole grams), and total calories are derived as
  // the sum, not fixed in advance. For higher body-fat levels the target
  // weight is a better proxy for lean mass than current weight.
  const proteinRefKg = refWeightKg();
  const proteinG = proteinGramsInput();
  const fatG = fatGramsInput();
  const carbsG = carbGramsInput();
  const actualCalories = proteinG * 4 + fatG * 9 + carbsG * 4;
  const actualDeficit = tdee - actualCalories;
  const actualWeeklyLossKg = (actualDeficit * 7) / KCAL_PER_KG_FAT;

  const gkg = proteinG / proteinRefKg;
  const fkg = fatG / proteinRefKg;
  const ckg = carbsG / weightKg;

  if (actualCalories < MIN_CALORIES) {
    warnings.push(tf("w_min_calories", MIN_CALORIES));
  } else if (actualDeficit > MAX_DEFICIT_FRACTION * tdee) {
    warnings.push(t("w_deficit_high"));
  }

  if (gkg < 1.6) warnings.push(t("w_protein_low"));
  if (fkg < 0.6) warnings.push(t("w_fat_low"));
  if (age < 18) warnings.push(t("w_under18"));

  const proteinTone = proteinZone(gkg).tone;
  const fatTone = fatZone(fkg).tone;
  const carbTone = carbZone(ckg).tone;
  const allGood = proteinTone === "good" && fatTone === "good" && carbTone === "good";

  // Timeline state, driven by the *actual* macro-derived deficit, not the
  // nominal pace: dragging the sliders changes this live.
  let timelineState = "flat";
  if (actualWeeklyLossKg > 0.01 && weightKg > targetKg + 0.05) timelineState = "losing";
  else if (actualWeeklyLossKg < -0.01) timelineState = "gaining";
  const weeks = timelineState === "losing" ? (weightKg - targetKg) / actualWeeklyLossKg : 0;

  return {
    bmr, tdee, targetCalories, actualCalories, actualDeficit, actualWeeklyLossKg,
    timelineState, weeks, wantsToLose, warnings, allGood,
    proteinG, fatG, carbsG, proteinRefKg, weightKg, targetKg, blend: b,
  };
}

/* ---------- rendering ---------- */

const fmt = (n) => Math.round(n).toLocaleString("en-US");

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Previous render's headline numbers and bar widths, so re-renders can
// animate from the old state instead of snapping.
let renderCache = null;

function animateCount(el, from, to) {
  if (!el || !Number.isFinite(from) || from === to || reducedMotion()) return;
  const t0 = performance.now();
  const dur = 450;
  const tick = (now) => {
    const p = Math.min((now - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function animateBarFrom(prevWidths) {
  if (!prevWidths || reducedMotion()) return;
  document.querySelectorAll(".macro-bar .seg-fill").forEach((seg) => {
    const target = seg.style.width;
    const prev = prevWidths[seg.dataset.macro];
    if (!prev || prev === target) return;
    seg.style.transition = "none";
    seg.style.width = prev;
    void seg.offsetWidth; // reflow so the next width change transitions
    seg.style.transition = "";
    seg.style.width = target;
  });
}

function macroBar(r) {
  const pKcal = r.proteinG * 4, cKcal = r.carbsG * 4, fKcal = r.fatG * 9;
  const total = pKcal + cKcal + fKcal || 1;
  const pct = (x) => Math.max((x / total) * 100, 0);
  const seg = [
    { name: t("macro_protein"), grams: r.proteinG, kcal: pKcal, cls: "protein" },
    { name: t("macro_carbs"), grams: r.carbsG, kcal: cKcal, cls: "carbs" },
    { name: t("macro_fat"), grams: r.fatG, kcal: fKcal, cls: "fat" },
  ];

  const bars = seg
    .filter((s) => s.kcal > 0)
    .map((s) => `<div class="seg-fill ${s.cls}" data-macro="${s.cls}" style="width:${pct(s.kcal).toFixed(1)}%" title="${s.name}: ${fmt(s.kcal)} kcal"></div>`)
    .join("");

  const legend = seg
    .map(
      (s) => `
      <div class="legend-item">
        <span class="swatch ${s.cls}" aria-hidden="true"></span>
        <span class="legend-name">${s.name}</span>
        <span class="legend-val">${fmt(s.grams)} g · ${Math.round(pct(s.kcal))}%</span>
      </div>`
    )
    .join("");

  return `
    <div class="macro-bar" role="img" aria-label="${seg.map((s) => `${s.name} ${Math.round(pct(s.kcal))}%`).join(", ")}">${bars}</div>
    <div class="legend">${legend}</div>`;
}

function render() {
  const r = calculate();
  const out = $("results");

  if (!r) {
    out.innerHTML = `<div class="card muted-card"><p>${t("results_placeholder")}</p></div>`;
    return;
  }

  const delta = r.actualCalories - r.targetCalories;
  const closeEnough = Math.abs(delta) < 15;
  const compareLine = closeEnough
    ? tf("compare_close", fmt(r.targetCalories))
    : delta < 0
    ? tf("compare_below", fmt(-delta), fmt(r.targetCalories))
    : tf("compare_above", fmt(delta), fmt(r.targetCalories));

  const etaDate = new Date(Date.now() + r.weeks * 7 * 864e5);
  const eta = etaDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  let timeline;
  if (r.timelineState === "losing") {
    timeline = `<div class="tile">
         <div class="tile-label">${t("tile_weekly_loss")}</div>
         <div class="tile-value">${fmtWeight(r.actualWeeklyLossKg)}</div>
         <div class="tile-sub">${tf("timeline_losing", Math.ceil(r.weeks), eta)}</div>
       </div>`;
  } else if (r.timelineState === "gaining") {
    timeline = `<div class="tile">
         <div class="tile-label">${t("tile_weekly_change")}</div>
         <div class="tile-value">+${fmtWeight(-r.actualWeeklyLossKg)}</div>
         <div class="tile-sub">${t("timeline_gaining")}</div>
       </div>`;
  } else {
    timeline = `<div class="tile">
         <div class="tile-label">${t("tile_mode")}</div>
         <div class="tile-value">${t("tile_maintain")}</div>
         <div class="tile-sub">${t("timeline_flat")}</div>
       </div>`;
  }

  const warnings = r.warnings
    .map((w) => `<div class="notice"><span class="notice-icon" aria-hidden="true">⚠</span><p>${w}</p></div>`)
    .join("");

  const proteinZ = proteinZone(r.proteinG / r.proteinRefKg);
  const carbZ = carbZone(r.carbsG / r.weightKg);
  const fatZ = fatZone(r.fatG / r.proteinRefKg);

  const goodNotice = r.allGood
    ? `<div class="notice success">
        <span class="notice-icon" aria-hidden="true">🎯</span>
        <p>${tf("good_notice", fmt(r.actualCalories))}</p>
      </div>`
    : "";

  out.innerHTML = `
    <div class="card">
      <div class="hero-number">
        <div class="tile-label">${t("hero_label")}</div>
        <div class="hero-value"><span data-count="cal">${fmt(r.actualCalories)}</span> <span class="hero-unit">kcal</span></div>
        <div class="tile-sub">${compareLine}</div>
      </div>

      ${goodNotice}

      <h2 class="section-title">${t("results_daily_macros")}</h2>
      ${macroBar(r)}
      <table class="macro-table">
        <thead><tr><th scope="col">${t("table_macro")}</th><th scope="col">${t("table_grams_day")}</th><th scope="col">${t("table_kcal")}</th><th scope="col">${t("table_why")}</th></tr></thead>
        <tbody>
          <tr><td>${t("macro_protein")}</td><td>${fmt(r.proteinG)} g</td><td>${fmt(r.proteinG * 4)}</td><td>${(r.proteinG / r.proteinRefKg).toFixed(1)} g/kg · ${zoneLabel(proteinZ).toLowerCase()}</td></tr>
          <tr><td>${t("macro_carbs")}</td><td>${fmt(r.carbsG)} g</td><td>${fmt(r.carbsG * 4)}</td><td>${(r.carbsG / r.weightKg).toFixed(1)} g/kg · ${zoneLabel(carbZ).toLowerCase()}</td></tr>
          <tr><td>${t("macro_fat")}</td><td>${fmt(r.fatG)} g</td><td>${fmt(r.fatG * 9)}</td><td>${(r.fatG / r.proteinRefKg).toFixed(2)} g/kg · ${zoneLabel(fatZ).toLowerCase()}</td></tr>
        </tbody>
      </table>

      <h2 class="section-title">${t("results_numbers_behind")}</h2>
      <div class="tiles">
        <div class="tile">
          <div class="tile-label">${t("tile_bmr")}</div>
          <div class="tile-value"><span data-count="bmr">${fmt(r.bmr)}</span> kcal</div>
          <div class="tile-sub">${t("tile_bmr_sub")} <sup class="cite"><a href="#ref-1">1</a></sup></div>
        </div>
        <div class="tile">
          <div class="tile-label">${t("tile_tdee")}</div>
          <div class="tile-value"><span data-count="tdee">${fmt(r.tdee)}</span> kcal</div>
          <div class="tile-sub">${t("tile_tdee_sub")} <sup class="cite"><a href="#ref-3">3</a></sup></div>
        </div>
        <div class="tile">
          <div class="tile-label">${t("tile_target")}</div>
          <div class="tile-value">${fmt(r.targetCalories)} kcal</div>
          <div class="tile-sub">${t("target_sub")}</div>
        </div>
        ${timeline}
      </div>

      ${warnings}

      <div class="notice tip">
        <span class="notice-icon" aria-hidden="true">💪</span>
        <p>${t("muscle_tip")}</p>
      </div>

      <button type="button" id="export-mealplan" class="export-btn">
        <span aria-hidden="true">📋</span> ${t("export_btn")}
      </button>
    </div>`;

  // Animate from the previous render's state instead of snapping.
  if (renderCache) {
    animateCount(out.querySelector('[data-count="cal"]'), renderCache.calories, r.actualCalories);
    animateCount(out.querySelector('[data-count="bmr"]'), renderCache.bmr, r.bmr);
    animateCount(out.querySelector('[data-count="tdee"]'), renderCache.tdee, r.tdee);
    animateBarFrom(renderCache.widths);
  }
  const widths = {};
  out.querySelectorAll(".macro-bar .seg-fill").forEach((seg) => { widths[seg.dataset.macro] = seg.style.width; });
  renderCache = { calories: r.actualCalories, bmr: r.bmr, tdee: r.tdee, widths };
}

/* ---------- meal plan export ---------- */

function fmtHeight() {
  if (currentUnits() === "imperial") {
    return `${$("height-ft").value || 0} ft ${$("height-in").value || 0} in`;
  }
  return `${$("height-cm").value} cm`;
}

function selectedLabel(id) {
  const el = $(id);
  return el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent : "";
}

function foodListHTML(items) {
  return items.map(([name, reason]) => `<li><strong>${name}</strong>, ${reason}</li>`).join("");
}

function mealIdeaListHTML(items) {
  return items.map((idea) => `<li>${idea}</li>`).join("");
}

function buildMealPlanHTML(r) {
  const lang = currentLang();
  const genDate = new Date().toLocaleDateString(lang === "en" ? "en-US" : lang, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const pKcal = r.proteinG * 4, cKcal = r.carbsG * 4, fKcal = r.fatG * 9;
  const totalKcal = pKcal + cKcal + fKcal || 1;
  const pct = (x) => Math.max((x / totalKcal) * 100, 0);
  const proteinZ = proteinZone(r.proteinG / r.proteinRefKg);
  const fatZ = fatZone(r.fatG / r.proteinRefKg);
  const carbZ = carbZone(r.carbsG / r.weightKg);

  const proteinFoods = (I18N.foods_protein[lang] || I18N.foods_protein.en);
  const carbFoods = (I18N.foods_carb[lang] || I18N.foods_carb.en);
  const fatFoods = (I18N.foods_fat[lang] || I18N.foods_fat.en);
  const ideasBreakfast = (I18N.ideas_breakfast[lang] || I18N.ideas_breakfast.en);
  const ideasLunch = (I18N.ideas_lunch[lang] || I18N.ideas_lunch.en);
  const ideasDinner = (I18N.ideas_dinner[lang] || I18N.ideas_dinner.en);
  const ideasSnacks = (I18N.ideas_snacks[lang] || I18N.ideas_snacks.en);

  const mpEtaDate = new Date(Date.now() + r.weeks * 7 * 864e5);
  const mpEta = mpEtaDate.toLocaleDateString(lang === "en" ? "en-US" : lang, { month: "long", year: "numeric" });
  const timelineText =
    r.timelineState === "losing"
      ? `${t("tile_weekly_loss")}: ${fmtWeight(r.actualWeeklyLossKg)}, ${tf("timeline_losing", Math.ceil(r.weeks), mpEta)}`
      : r.timelineState === "gaining"
      ? `${t("tile_weekly_change")}: +${fmtWeight(-r.actualWeeklyLossKg)}`
      : t("timeline_flat");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<title>${t("mp_title")}, ${genDate}</title>
<style>
  :root {
    --page: #f9f9f7; --surface: #ffffff; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --hairline: #e1e0d9; --border: rgba(11,11,11,0.10); --accent: #2a78d6;
    --protein: #2a78d6; --carbs: #eb6834; --fat: #1baf7a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.55; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
  h1 { font-size: 1.9rem; margin: 0 0 0.2rem; letter-spacing: -0.01em; }
  .subtitle { color: var(--ink-2); margin: 0 0 1.5rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; padding-bottom: 0.4rem; border-bottom: 2px solid var(--hairline); }
  h3 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
  .section-note { color: var(--ink-2); font-size: 0.92rem; margin: 0 0 0.9rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.1rem 1.3rem; margin-bottom: 1rem; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.7rem 1.2rem; font-size: 0.92rem; }
  .facts dt { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; margin: 0; }
  .facts dd { margin: 0.1rem 0 0; font-weight: 600; }
  .hero-cals { text-align: center; margin: 1.2rem 0; }
  .hero-cals .big { font-size: 2.6rem; font-weight: 700; letter-spacing: -0.02em; }
  .hero-cals .unit { font-size: 1.1rem; color: var(--ink-2); font-weight: 500; }
  .hero-cals .sub { color: var(--ink-2); font-size: 0.9rem; margin-top: 0.2rem; }
  .macro-bar { display: flex; gap: 2px; height: 22px; border-radius: 6px; overflow: hidden; margin: 1rem 0 0.6rem; }
  .macro-bar span { display: block; }
  .protein-fill { background: var(--protein); }
  .carbs-fill { background: var(--carbs); }
  .fat-fill { background: var(--fat); }
  .legend { display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 0.85rem; margin-bottom: 0.5rem; }
  .legend span.dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 0.35rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  th { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .chip { display: inline-block; padding: 0.1rem 0.55rem; border-radius: 999px; font-size: 0.78rem; font-weight: 600; border: 1px solid var(--border); }
  .chip-good { background: rgba(12,163,12,0.12); border-color: #0ca30c; }
  .chip-neutral { background: rgba(42,120,214,0.12); border-color: var(--accent); }
  .chip-serious { background: rgba(236,131,90,0.16); border-color: #ec835a; }
  .chip-critical { background: rgba(208,59,59,0.14); border-color: #d03b3b; }
  .foods-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; }
  .foods-grid h3 { margin-top: 0; }
  .foods-grid ul, .ideas ul { margin: 0; padding-left: 1.1rem; font-size: 0.88rem; color: var(--ink-2); }
  .foods-grid li, .ideas li { margin-bottom: 0.5rem; }
  .foods-grid li strong, .ideas li strong { color: var(--ink); }
  .ideas-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
  .toolbar { display: flex; gap: 0.6rem; margin-bottom: 1.5rem; }
  .toolbar button { font: inherit; padding: 0.55rem 1.1rem; border-radius: 8px; border: 1px solid var(--border); background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
  .toolbar .hint { align-self: center; color: var(--muted); font-size: 0.82rem; }
  .foot { color: var(--muted); font-size: 0.82rem; margin-top: 2rem; border-top: 1px solid var(--hairline); padding-top: 1rem; }
  @media print {
    .no-print { display: none !important; }
    body { background: #fff; }
    .card { border-color: #ccc; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar no-print">
      <button type="button" onclick="window.print()">🖨️ ${t("mp_print_btn")}</button>
      <span class="hint">${t("mp_print_hint")}</span>
    </div>

    <h1>${t("mp_title")}</h1>
    <p class="subtitle">${tf("mp_generated", genDate)}</p>

    <h2>${t("mp_overview")}</h2>
    <p class="section-note">${t("mp_overview_note")}</p>

    <div class="card">
      <dl class="facts">
        <div><dt>${t("field_age")}</dt><dd>${$("age").value} ${t("unit_years")}</dd></div>
        <div><dt>${t("field_height")}</dt><dd>${fmtHeight()}</dd></div>
        <div><dt>${t("field_weight")}</dt><dd>${fmtWeight(r.weightKg)}</dd></div>
        <div><dt>${t("field_target_weight")}</dt><dd>${fmtWeight(r.targetKg)}</dd></div>
        <div><dt>${t("field_profile")}</dt><dd>${selectedLabel("profile")}</dd></div>
        <div><dt>${t("field_activity")}</dt><dd>${selectedLabel("activity")}</dd></div>
        <div><dt>${t("field_pace")}</dt><dd>${selectedLabel("pace")}</dd></div>
        <div><dt>${t("mp_explanation_style")}</dt><dd>${currentRegister() === "conversational" ? t("register_conversational") : t("register_academic")}</dd></div>
      </dl>

      <div class="hero-cals">
        <div class="big">${fmt(r.actualCalories)}</div>
        <span class="unit">${t("mp_kcal_day")}</span>
        <div class="sub">${t("mp_suggested_target")}: ${fmt(r.targetCalories)} kcal &middot; ${timelineText}</div>
      </div>

      <div class="macro-bar">
        <span class="protein-fill" style="width:${pct(pKcal).toFixed(1)}%"></span>
        <span class="carbs-fill" style="width:${pct(cKcal).toFixed(1)}%"></span>
        <span class="fat-fill" style="width:${pct(fKcal).toFixed(1)}%"></span>
      </div>
      <div class="legend">
        <span><span class="dot" style="background:var(--protein)"></span>${t("macro_protein")} ${fmt(r.proteinG)} g &middot; ${Math.round(pct(pKcal))}%</span>
        <span><span class="dot" style="background:var(--carbs)"></span>${t("macro_carbs")} ${fmt(r.carbsG)} g &middot; ${Math.round(pct(cKcal))}%</span>
        <span><span class="dot" style="background:var(--fat)"></span>${t("macro_fat")} ${fmt(r.fatG)} g &middot; ${Math.round(pct(fKcal))}%</span>
      </div>

      <table>
        <thead><tr><th>${t("table_macro")}</th><th>${t("table_grams_day")}</th><th>${t("table_kcal")}</th><th>${t("mp_status")}</th></tr></thead>
        <tbody>
          <tr><td>${t("macro_protein")}</td><td>${fmt(r.proteinG)} g</td><td>${fmt(pKcal)}</td><td><span class="chip chip-${proteinZ.tone}">${zoneLabel(proteinZ)}</span></td></tr>
          <tr><td>${t("macro_carbs")}</td><td>${fmt(r.carbsG)} g</td><td>${fmt(cKcal)}</td><td><span class="chip chip-${carbZ.tone}">${zoneLabel(carbZ)}</span></td></tr>
          <tr><td>${t("macro_fat")}</td><td>${fmt(r.fatG)} g</td><td>${fmt(fKcal)}</td><td><span class="chip chip-${fatZ.tone}">${zoneLabel(fatZ)}</span></td></tr>
        </tbody>
      </table>
    </div>

    <h2>${t("mp_foods_title")}</h2>
    <p class="section-note">${t("mp_foods_note")}</p>
    <div class="card foods-grid">
      <div>
        <h3 style="color:var(--protein)">${t("macro_protein")}</h3>
        <ul>${foodListHTML(proteinFoods)}</ul>
      </div>
      <div>
        <h3 style="color:var(--carbs)">${t("macro_carbs")}</h3>
        <ul>${foodListHTML(carbFoods)}</ul>
      </div>
      <div>
        <h3 style="color:var(--fat)">${t("macro_fat")}</h3>
        <ul>${foodListHTML(fatFoods)}</ul>
      </div>
    </div>

    <h2>${t("mp_ideas_title")}</h2>
    <p class="section-note">${t("mp_ideas_note")}</p>
    <div class="card ideas">
      <div class="ideas-grid">
        <div><h3>${t("mp_breakfast")}</h3><ul>${mealIdeaListHTML(ideasBreakfast)}</ul></div>
        <div><h3>${t("mp_lunch")}</h3><ul>${mealIdeaListHTML(ideasLunch)}</ul></div>
        <div><h3>${t("mp_dinner")}</h3><ul>${mealIdeaListHTML(ideasDinner)}</ul></div>
        <div><h3>${t("mp_snacks")}</h3><ul>${mealIdeaListHTML(ideasSnacks)}</ul></div>
      </div>
    </div>

    <div class="foot">
      <p>${t("footer_disclaimer")}</p>
      <p>${t("mp_generated_by")}</p>
    </div>
  </div>
</body>
</html>`;
}

function exportMealPlan() {
  const r = calculate();
  if (!r) return;
  const html = buildMealPlanHTML(r);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------- wiring ---------- */

function syncProfileFields() {
  const p = $("profile").value;
  $("hrt-field").hidden = !(p === "transfem" || p === "transmasc");
  $("blend-field").hidden = p !== "custom";
}

function saveState() {
  const state = {};
  document.querySelectorAll("#calc-form input, #calc-form select").forEach((el) => {
    state[el.id || el.value] = el.type === "radio" ? el.checked : el.value;
  });
  try { localStorage.setItem("macro-calc", JSON.stringify(state)); } catch { /* private mode */ }
}

function loadState() {
  let state;
  try { state = JSON.parse(localStorage.getItem("macro-calc")); } catch { return; }
  if (!state) return;
  document.querySelectorAll("#calc-form input, #calc-form select").forEach((el) => {
    const key = el.id || el.value;
    if (!(key in state)) return;
    if (el.type === "radio") el.checked = state[key];
    else el.value = state[key];
  });
  lastUnits = currentUnits();
}

function loadRegister() {
  let value = "academic";
  try { value = localStorage.getItem(REGISTER_KEY) || "academic"; } catch { /* private mode */ }
  applyRegister(value);
  const input = $(value === "conversational" ? "register-conversational" : "register-academic");
  if (input) input.checked = true;
}

function saveRegister(value) {
  try { localStorage.setItem(REGISTER_KEY, value); } catch { /* private mode */ }
}

function renderAllZones() {
  renderProteinZone();
  renderFatZone();
  renderCarbZone();
}

function refreshTexts() {
  translatePage();
  renderAllZones();
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  loadRegister();
  populateLangSelect();
  loadLang();
  syncUnitFields();
  syncProfileFields();
  updateSliderBounds();
  translatePage();
  renderAllZones();
  render();

  $("results").addEventListener("click", (e) => {
    if (e.target.closest("#export-mealplan")) exportMealPlan();
  });

  $("calc-form").addEventListener("input", (e) => {
    if (e.target.name === "units") {
      convertFieldValues();
      syncUnitFields();
    }
    if (e.target.id === "profile") syncProfileFields();
    // bounds and zones depend on weight/height/target and the sliders themselves
    if (["weight", "target-weight", "height-cm", "height-ft", "height-in"].includes(e.target.id) || e.target.name === "units") {
      updateSliderBounds();
    }
    if (e.target.classList.contains("g-slider") || ["weight", "target-weight", "height-cm", "height-ft", "height-in"].includes(e.target.id) || e.target.name === "units") {
      renderAllZones();
    }
    if (e.target.classList.contains("g-slider")) {
      showSliderBubble(e.target);
      hideSliderBubble(e.target, 900);
    }
    saveState();
    render();
  });

  document.querySelectorAll(".g-slider").forEach((el) => {
    el.addEventListener("pointerdown", () => showSliderBubble(el));
    el.addEventListener("pointerup", () => hideSliderBubble(el, 600));
    el.addEventListener("pointercancel", () => hideSliderBubble(el, 600));
    el.addEventListener("focus", () => showSliderBubble(el));
    el.addEventListener("blur", () => hideSliderBubble(el, 0));
  });

  document.querySelectorAll('input[name="register"]').forEach((el) => {
    el.addEventListener("change", (e) => {
      applyRegister(e.target.value);
      saveRegister(e.target.value);
      refreshTexts();
    });
  });

  const langSelect = $("lang-select");
  if (langSelect) {
    langSelect.addEventListener("change", (e) => {
      applyLang(e.target.value);
      saveLang(e.target.value);
      refreshTexts();
    });
  }

  // Reveal the science/references cards as they scroll into view.
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in-view"));
  }
});
