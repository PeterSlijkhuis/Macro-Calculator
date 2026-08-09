"use strict";

/* ---------- constants ---------- */

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const KCAL_PER_KG_FAT = 7700; // energy in ~1 kg of body fat
const HRT_SETTLE_MONTHS = 6;  // metabolic shift settles over ~first 6 months of HRT
const MAX_DEFICIT_FRACTION = 0.25; // never cut more than 25% below maintenance
const MIN_CALORIES = 1200;    // below this, flag as too low without supervision

const FAT_FLOOR_G_PER_KG = 0.5; // absolute floor when the budget clamp kicks in

const $ = (id) => document.getElementById(id);

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
 * The Mifflin–St Jeor sex constant is interpolated: s = -161 + 166 * b.
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

/* ---------- macro sliders & zones ---------- */

function proteinGkg() {
  const v = parseFloat($("protein-gkg").value);
  return Number.isFinite(v) ? v : 2.0;
}

function fatGkg() {
  const v = parseFloat($("fat-gkg").value);
  return Number.isFinite(v) ? v : 0.8;
}

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

/**
 * What a given protein intake (g per kg body weight) means in a calorie
 * deficit — for muscle retention, satiety, and the rest of the budget.
 */
function proteinZone(gkg) {
  if (gkg < 1.4) return {
    label: "Muscle at risk",
    tone: "critical",
    icon: "⛔",
    text: "In a calorie deficit this doesn't supply enough amino acids, so your body covers the shortfall by breaking down muscle — the \"cannibalisation\" you want to avoid. It's also the least filling setting: protein is the most satiating macro, and with this little of it hunger bites harder and cravings win more often.",
  };
  if (gkg < 1.6) return {
    label: "Bare minimum",
    tone: "serious",
    icon: "⚠",
    text: "Enough to slow muscle loss, but below the range studied for people dieting with training. Expect to give up some muscle along with the fat, and to feel hungrier between meals than you would in the sweet spot.",
  };
  if (gkg <= 2.2) return {
    label: "Sweet spot",
    tone: "good",
    icon: "✓",
    text: "The evidence-based range (1.6–2.2 g/kg) for keeping virtually all your muscle in a deficit — provided you also lift. Bonus: protein is the most filling macro and costs the most calories to digest (~25% of its energy), so hunger is easiest to manage here.",
  };
  if (gkg <= 2.6) return {
    label: "Extra insurance",
    tone: "neutral",
    icon: "🛡",
    text: "A little more appetite control and a safety margin worth having if you're already lean or cutting briskly — that's when muscle is most at risk. Muscle-wise the benefit beyond 2.2 g/kg is marginal, and every extra gram of protein takes calories away from the carbs that fuel your training.",
  };
  return {
    label: "More than needed",
    tone: "serious",
    icon: "⚠",
    text: "No extra muscle protection up here — the retention benefit plateaus. It mostly crowds carbs and fat out of your budget (harder workouts, low energy) and is a chore to eat every day. Not harmful for healthy kidneys, just pointless.",
  };
}

/**
 * What a given fat intake (g per kg body weight) means — for hormone health,
 * satiety, and how much of the calorie budget is left for carbs.
 */
function fatZone(gkg) {
  if (gkg < 0.6) return {
    label: "Hormones at risk",
    tone: "critical",
    icon: "⛔",
    text: "Dietary fat is the raw material for sex hormones (estrogen and testosterone) and carries vitamins A, D, E and K. Held below ~0.6 g/kg, hormone levels, skin, joints, mood and sleep tend to suffer — extra relevant if you're on HRT. This is not the place to save calories.",
  };
  if (gkg < 0.75) return {
    label: "Cutting it close",
    tone: "serious",
    icon: "⚠",
    text: "Workable for a short, disciplined cut, but there's little margin. Watch for low energy, dry skin, poor sleep or cycle/hormonal changes, and nudge the slider up if any of those show up.",
  };
  if (gkg <= 1.1) return {
    label: "Sweet spot",
    tone: "good",
    icon: "✓",
    text: "Enough fat to keep hormone production and vitamin absorption running smoothly, it slows digestion (so meals keep you full for longer), and it still leaves solid room in the budget for the carbs that fuel your training.",
  };
  if (gkg <= 1.35) return {
    label: "Higher fat",
    tone: "neutral",
    icon: "🥑",
    text: "A fine preference if fatty foods are what keep you satisfied — your hormones were fully covered a while ago. Just remember every gram of fat costs 9 kcal, more than double protein or carbs, so carb room shrinks quickly up here.",
  };
  return {
    label: "Carb squeeze",
    tone: "serious",
    icon: "⚠",
    text: "Beyond any hormonal benefit — at this level fat is mostly displacing carbs from the budget, which makes hard training sessions feel flat. Fine on a deliberate low-carb approach; otherwise slide it back down.",
  };
}

/**
 * What the leftover carb allowance means. Carbs are protein-sparing fuel:
 * with glycogen available the body has less reason to burn amino acids.
 * Thresholds in g per kg body weight.
 */
function carbZone(gPerKg) {
  if (gPerKg < 0.75) return {
    label: "Keto territory",
    tone: "serious",
    icon: "⚠",
    text: "Very low carb. Doable if it's a deliberate choice (some people love it for appetite control), but expect flat, heavy workouts for the first weeks and less top-end in intense training. To free up carb room, nudge protein or fat down, or pick a gentler pace.",
  };
  if (gPerKg < 2) return {
    label: "Low fuel",
    tone: "neutral",
    icon: "🔋",
    text: "Enough for daily life and light training. Hard or long sessions will dip into reserves — if workouts start feeling flat, this number is the reason. Time most of these carbs around training for the best return.",
  };
  if (gPerKg <= 4) return {
    label: "Moderate fuel",
    tone: "good",
    icon: "✓",
    text: "Solid glycogen for regular training. Carbs are also protein-sparing: with fuel on hand, your body has less reason to burn amino acids for energy — one more layer of protection for your muscle.",
  };
  return {
    label: "High fuel",
    tone: "good",
    icon: "🚀",
    text: "Plenty of glycogen — well suited to high training volumes or a physical job. If you're not that active, some of this budget might serve you better as fat (satiety) or a slightly brisker pace.",
  };
}

function renderZone(outId, zoneId, gdayId, gkg, zone, decimals) {
  $(outId).value = gkg.toFixed(decimals);
  const ref = refWeightKg();
  $(gdayId).textContent = Number.isFinite(ref) ? `≈ ${Math.round(gkg * ref)} g/day` : "";
  $(zoneId).innerHTML = `
    <span class="zone-chip zone-${zone.tone}"><span aria-hidden="true">${zone.icon}</span> ${zone.label}</span>
    <p>${zone.text}</p>`;
}

function renderProteinZone() {
  renderZone("protein-out", "protein-zone", "protein-gday", proteinGkg(), proteinZone(proteinGkg()), 1);
}

function renderFatZone() {
  renderZone("fat-out", "fat-zone", "fat-gday", fatGkg(), fatZone(fatGkg()), 2);
}

/* ---------- slider value bubbles ---------- */

const bubbleTimers = {};

function updateSliderBubble(input) {
  const wrap = input.closest(".slider-wrap");
  if (!wrap) return;
  const bubble = wrap.querySelector(".slider-bubble");
  const v = parseFloat(input.value);
  const decimals = input.id === "fat-gkg" ? 2 : 1;
  const ref = refWeightKg();
  bubble.innerHTML = Number.isFinite(ref)
    ? `<strong>${Math.round(v * ref)} g</strong>${v.toFixed(decimals)} g/kg`
    : `<strong>${v.toFixed(decimals)}</strong>g/kg`;
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
  const losing = targetKg < weightKg - 0.05;

  let calories, deficit, weeklyLossKg, weeks;

  if (losing) {
    weeklyLossKg = paceFraction * weightKg;
    deficit = (weeklyLossKg * KCAL_PER_KG_FAT) / 7;

    const maxDeficit = MAX_DEFICIT_FRACTION * tdee;
    if (deficit > maxDeficit) {
      const overshoot = deficit / maxDeficit;
      deficit = maxDeficit;
      weeklyLossKg = (deficit * 7) / KCAL_PER_KG_FAT;
      if (overshoot > 1.05) {
        warnings.push(
          "Your chosen pace would need a deficit larger than 25% of maintenance, which risks muscle loss and rebound. We've capped it at 25% — pick a gentler pace for a smoother ride."
        );
      }
    }

    calories = tdee - deficit;
    weeks = (weightKg - targetKg) / weeklyLossKg;

    if (calories < MIN_CALORIES) {
      warnings.push(
        `This lands below ${MIN_CALORIES} kcal/day, which is hard to meet nutrient needs on without medical supervision. Choose a gentler pace, or talk to a professional.`
      );
    }
  } else {
    calories = tdee;
    deficit = 0;
    weeklyLossKg = 0;
    weeks = 0;
    warnings.push(
      targetKg > weightKg + 0.05
        ? "Your target weight is above your current weight, so this shows maintenance numbers. For lean muscle gain, add a small surplus of 5–10% on top and keep protein high."
        : "Your target equals your current weight, so this shows maintenance numbers."
    );
  }

  // Protein and fat come from the sliders (g per kg of reference weight);
  // carbs fill whatever calories remain. For higher body-fat levels the
  // target weight is a better proxy for lean mass than current weight.
  const gkg = proteinGkg();
  const fkg = fatGkg();
  const bmi = weightKg / Math.pow(heightCm / 100, 2);
  const proteinRefKg = refWeightKg();
  let proteinG = gkg * proteinRefKg;
  let fatG = fkg * proteinRefKg;

  if (losing && gkg < 1.6) {
    warnings.push(
      "Protein is set below 1.6 g/kg while in a deficit. Part of your weight loss will come from muscle instead of fat — slide protein up into the 1.6–2.2 g/kg range to protect it."
    );
  }
  if (fkg < 0.6) {
    warnings.push(
      "Fat is set below 0.6 g/kg. Held there for long, hormone production and vitamin absorption suffer — slide fat up to at least 0.6–0.8 g/kg."
    );
  }

  // Keep the three macros inside the calorie budget: trim fat first (down to
  // an absolute floor), then protein.
  if (proteinG * 4 + fatG * 9 > calories) {
    fatG = Math.max(FAT_FLOOR_G_PER_KG * proteinRefKg, (calories - proteinG * 4) / 9);
    if (proteinG * 4 + fatG * 9 > calories) {
      proteinG = Math.max(Math.min(gkg, 1.6) * proteinRefKg, (calories - fatG * 9) / 4);
    }
    warnings.push(
      "Your protein and fat settings add up to more than the calorie budget, so they've been trimmed to fit and carbs are at zero. Lower one of the sliders, or pick a gentler pace."
    );
  }

  const carbsG = Math.max(0, (calories - proteinG * 4 - fatG * 9) / 4);

  if (age < 18) {
    warnings.push(
      "You're under 18: growing bodies have different needs and this calculator isn't calibrated for you. Please involve a doctor or dietitian."
    );
  }

  return {
    bmr, tdee, calories, deficit, weeklyLossKg, weeks, losing, warnings,
    proteinG, fatG, carbsG, proteinRefKg, weightKg, targetKg, bmi, blend: b, gkg, fkg,
  };
}

/* ---------- rendering ---------- */

const fmt = (n) => Math.round(n).toLocaleString("en-US");

function macroBar(r) {
  const pKcal = r.proteinG * 4, cKcal = r.carbsG * 4, fKcal = r.fatG * 9;
  const total = pKcal + cKcal + fKcal || 1;
  const pct = (x) => Math.max((x / total) * 100, 0);
  const seg = [
    { name: "Protein", grams: r.proteinG, kcal: pKcal, cls: "protein" },
    { name: "Carbs", grams: r.carbsG, kcal: cKcal, cls: "carbs" },
    { name: "Fat", grams: r.fatG, kcal: fKcal, cls: "fat" },
  ];

  const bars = seg
    .filter((s) => s.kcal > 0)
    .map((s) => `<div class="seg-fill ${s.cls}" style="width:${pct(s.kcal).toFixed(1)}%" title="${s.name}: ${fmt(s.kcal)} kcal"></div>`)
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
    <div class="macro-bar" role="img" aria-label="Calorie split: protein ${Math.round(pct(pKcal))}%, carbs ${Math.round(pct(cKcal))}%, fat ${Math.round(pct(fKcal))}%">${bars}</div>
    <div class="legend">${legend}</div>`;
}

function render() {
  const r = calculate();
  const out = $("results");

  if (!r) {
    out.innerHTML = `<div class="card muted-card"><p>Fill in your details above and your numbers will appear here.</p></div>`;
    return;
  }

  const etaDate = new Date(Date.now() + r.weeks * 7 * 864e5);
  const eta = etaDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const timeline = r.losing
    ? `<div class="tile">
         <div class="tile-label">Weekly loss</div>
         <div class="tile-value">${fmtWeight(r.weeklyLossKg)}</div>
         <div class="tile-sub">≈ ${Math.ceil(r.weeks)} weeks — around ${eta}</div>
       </div>`
    : `<div class="tile">
         <div class="tile-label">Mode</div>
         <div class="tile-value">Maintain</div>
         <div class="tile-sub">no deficit applied</div>
       </div>`;

  const warnings = r.warnings
    .map((w) => `<div class="notice"><span class="notice-icon" aria-hidden="true">⚠</span><p>${w}</p></div>`)
    .join("");

  out.innerHTML = `
    <div class="card">
      <div class="hero-number">
        <div class="tile-label">${r.losing ? "Daily calorie target" : "Daily maintenance calories"}</div>
        <div class="hero-value">${fmt(r.calories)} <span class="hero-unit">kcal</span></div>
        ${r.losing ? `<div class="tile-sub">a ${fmt(r.deficit)} kcal/day deficit below your ${fmt(r.tdee)} kcal maintenance</div>` : ""}
      </div>

      <h2 class="section-title">Daily macros</h2>
      ${macroBar(r)}
      <table class="macro-table">
        <thead><tr><th scope="col">Macro</th><th scope="col">Grams / day</th><th scope="col">kcal</th><th scope="col">Why</th></tr></thead>
        <tbody>
          <tr><td>Protein</td><td>${fmt(r.proteinG)} g</td><td>${fmt(r.proteinG * 4)}</td><td>${(r.proteinG / r.proteinRefKg).toFixed(1)} g/kg — ${proteinZone(r.proteinG / r.proteinRefKg).label.toLowerCase()}</td></tr>
          <tr><td>Carbs</td><td>${fmt(r.carbsG)} g</td><td>${fmt(r.carbsG * 4)}</td><td>${(r.carbsG / r.weightKg).toFixed(1)} g/kg — ${carbZone(r.carbsG / r.weightKg).label.toLowerCase()}</td></tr>
          <tr><td>Fat</td><td>${fmt(r.fatG)} g</td><td>${fmt(r.fatG * 9)}</td><td>${(r.fatG / r.proteinRefKg).toFixed(2)} g/kg — ${fatZone(r.fatG / r.proteinRefKg).label.toLowerCase()}</td></tr>
        </tbody>
      </table>

      ${(() => {
        const z = carbZone(r.carbsG / r.weightKg);
        return `
      <div class="zone-feedback carb-note">
        <span class="zone-chip zone-${z.tone}"><span aria-hidden="true">${z.icon}</span> Carbs: ${z.label.toLowerCase()}</span>
        <p><strong>Carbs are the leftover dial</strong> — they fill the ${fmt(r.carbsG * 4)} kcal that remain after your protein and fat settings. ${z.text}</p>
      </div>`;
      })()}

      <h2 class="section-title">The numbers behind it</h2>
      <div class="tiles">
        <div class="tile">
          <div class="tile-label">Resting metabolism (BMR)</div>
          <div class="tile-value">${fmt(r.bmr)} kcal</div>
          <div class="tile-sub">Mifflin–St Jeor</div>
        </div>
        <div class="tile">
          <div class="tile-label">Maintenance (TDEE)</div>
          <div class="tile-value">${fmt(r.tdee)} kcal</div>
          <div class="tile-sub">BMR × activity</div>
        </div>
        ${timeline}
      </div>

      ${warnings}

      <div class="notice tip">
        <span class="notice-icon" aria-hidden="true">💪</span>
        <p><strong>Keep the muscle:</strong> a calorie deficit only spares muscle if you give your body a reason to keep it. Do resistance training 2–4× a week, hit the protein number daily (spread over 3–5 meals), and sleep 7–9 hours.</p>
      </div>
    </div>`;
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

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  syncUnitFields();
  syncProfileFields();
  renderProteinZone();
  renderFatZone();
  render();

  $("calc-form").addEventListener("input", (e) => {
    if (e.target.name === "units") {
      convertFieldValues();
      syncUnitFields();
    }
    if (e.target.id === "profile") syncProfileFields();
    if (e.target.id === "protein-gkg") renderProteinZone();
    if (e.target.id === "fat-gkg") renderFatZone();
    // grams shown for the sliders depend on the weight fields too
    if (["weight", "target-weight", "height-cm", "height-ft", "height-in"].includes(e.target.id) || e.target.name === "units") {
      renderProteinZone();
      renderFatZone();
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
});
