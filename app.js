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

// Pick the string for the active register from a {academic, conversational} pair.
// Plain strings (no register split) pass through unchanged.
function reg(pair) {
  if (typeof pair === "string") return pair;
  return pair[currentRegister()];
}

function applyRegister(value) {
  document.documentElement.dataset.register = value === "conversational" ? "conversational" : "academic";
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
 * zone carries an academic and a conversational explanation of the same
 * evidence.
 */
function proteinZone(gkg) {
  if (gkg < 1.4) return {
    label: { academic: "Catabolic risk", conversational: "Muscle at risk" },
    tone: "critical",
    icon: "⛔",
    text: {
      academic: "At this intake, protein availability is generally insufficient to offset a caloric deficit without loss of skeletal muscle protein<sup class=\"cite\"><a href=\"#ref-7\">7</a></sup>. Protein is also the most satiating macronutrient<sup class=\"cite\"><a href=\"#ref-10\">10</a></sup>; at low intakes, hunger and cravings tend to increase.",
      conversational: "At this level, your body doesn't get enough protein to cover the shortfall, so it starts breaking down muscle along with fat<sup class=\"cite\"><a href=\"#ref-7\">7</a></sup>. It's also the least filling setting: protein keeps you full longer<sup class=\"cite\"><a href=\"#ref-10\">10</a></sup>, so hunger and cravings tend to win more often here.",
    },
  };
  if (gkg < 1.6) return {
    label: { academic: "Suboptimal", conversational: "Bare minimum" },
    tone: "serious",
    icon: "⚠",
    text: {
      academic: "This intake slows the rate of muscle loss relative to lower levels but remains below the range studied in dieting individuals who train. Some reduction in lean mass alongside fat mass should be expected, along with lower satiety than in the optimal range.",
      conversational: "This slows muscle loss, but it's still below what's usually studied for people dieting while training. Expect to lose a little muscle along with the fat, and to feel hungrier between meals than in the sweet spot.",
    },
  };
  if (gkg <= 2.2) return {
    label: { academic: "Optimal range", conversational: "Sweet spot" },
    tone: "good",
    icon: "✓",
    text: {
      academic: "This range (1.6–2.2 g/kg) is associated with near-complete preservation of muscle mass during a deficit, provided resistance training continues<sup class=\"cite\"><a href=\"#ref-7\">7</a>,<a href=\"#ref-8\">8</a>,<a href=\"#ref-9\">9</a></sup>. Protein also has the highest satiety value<sup class=\"cite\"><a href=\"#ref-10\">10</a></sup> and thermic effect of the three macronutrients, with 20 to 30 percent of its calories spent on digestion<sup class=\"cite\"><a href=\"#ref-11\">11</a></sup>, which supports appetite control.",
      conversational: "This range (1.6–2.2 g/kg) is the sweet spot for keeping virtually all your muscle in a deficit, as long as you keep lifting<sup class=\"cite\"><a href=\"#ref-7\">7</a>,<a href=\"#ref-8\">8</a>,<a href=\"#ref-9\">9</a></sup>. Bonus: protein is the most filling macro<sup class=\"cite\"><a href=\"#ref-10\">10</a></sup> and burns the most calories just to digest, about 20 to 30% of its own energy<sup class=\"cite\"><a href=\"#ref-11\">11</a></sup>, so hunger is easiest to manage here.",
    },
  };
  if (gkg <= 2.6) return {
    label: { academic: "Added margin", conversational: "Extra insurance" },
    tone: "neutral",
    icon: "🛡",
    text: {
      academic: "Additional appetite control and a margin of safety, most useful when body fat is already low or the deficit is aggressive, the conditions under which muscle loss risk is highest<sup class=\"cite\"><a href=\"#ref-8\">8</a>,<a href=\"#ref-9\">9</a></sup>. The added muscle-retention benefit above 2.2 g/kg is marginal<sup class=\"cite\"><a href=\"#ref-7\">7</a></sup>, and each extra gram of protein raises total daily calories without a proportional muscle-retention gain.",
      conversational: "A bit more appetite control and a safety margin, worth having if you're already lean or cutting hard, since that's when muscle is most at risk<sup class=\"cite\"><a href=\"#ref-8\">8</a>,<a href=\"#ref-9\">9</a></sup>. The muscle-protection benefit above 2.2 g/kg is marginal<sup class=\"cite\"><a href=\"#ref-7\">7</a></sup>, and every extra gram adds to your daily total without much extra payoff.",
    },
  };
  return {
    label: { academic: "Above requirement", conversational: "More than needed" },
    tone: "serious",
    icon: "⚠",
    text: {
      academic: "No additional muscle-retention benefit accrues beyond this point; the effect has plateaued. Excess protein simply raises total daily calories, which can work against a lower total intake, though it poses no known risk to kidney function in healthy individuals.",
      conversational: "No extra muscle protection up here, the benefit already plateaued. It mostly just adds calories to your day without much payoff, and becomes a chore to eat every day. Not harmful for healthy kidneys, just unnecessary.",
    },
  };
}

/**
 * What a given fat intake (g per kg body weight) means for hormone health,
 * satiety, and total daily calories.
 */
function fatZone(gkg) {
  if (gkg < 0.6) return {
    label: { academic: "Hormonal risk", conversational: "Hormones at risk" },
    tone: "critical",
    icon: "⛔",
    text: {
      academic: "Dietary fat supplies the precursor molecules for steroid hormone synthesis, including estrogen and testosterone, and carries the fat-soluble vitamins A, D, E, and K. Sustained intake below this threshold is associated with reduced hormone levels<sup class=\"cite\"><a href=\"#ref-12\">12</a></sup>, a consideration of particular relevance during hormone therapy. Contest-preparation guidance recommends maintaining fat at 15 to 30 percent of calories even during aggressive deficits<sup class=\"cite\"><a href=\"#ref-8\">8</a></sup>.",
      conversational: "Dietary fat is the raw material for hormones like estrogen and testosterone, and it carries vitamins A, D, E, and K. Held this low for a while, hormone levels tend to suffer<sup class=\"cite\"><a href=\"#ref-12\">12</a></sup>, which matters even more if you're on HRT. Even in deep cuts, guidance keeps fat at 15 to 30% of calories<sup class=\"cite\"><a href=\"#ref-8\">8</a></sup>. This isn't the place to save calories.",
    },
  };
  if (gkg < 0.75) return {
    label: { academic: "Marginal", conversational: "Cutting it close" },
    tone: "serious",
    icon: "⚠",
    text: {
      academic: "Workable for a brief, disciplined phase, but the margin is small. Indicators worth monitoring include low energy, dry skin, poor sleep, and changes in menstrual cycle or hormonal symptoms; any of these warrant increasing intake.",
      conversational: "Workable for a short, disciplined cut, but there's not much room to spare. Watch for low energy, dry skin, poor sleep, or cycle and hormonal changes, and nudge the slider up if any of those show up.",
    },
  };
  if (gkg <= 1.1) return {
    label: { academic: "Optimal range", conversational: "Sweet spot" },
    tone: "good",
    icon: "✓",
    text: {
      academic: "Sufficient to support hormone production and fat-soluble vitamin absorption. Fat also slows gastric emptying, extending satiety, at a moderate calorie cost given its 9 kcal per gram density.",
      conversational: "Enough fat to keep hormone production and vitamin absorption running smoothly. It also slows digestion, so meals keep you full for longer, without dragging your daily total up too far.",
    },
  };
  if (gkg <= 1.35) return {
    label: { academic: "Above requirement", conversational: "Higher fat" },
    tone: "neutral",
    icon: "🥑",
    text: {
      academic: "A reasonable preference if fat-dense foods aid dietary adherence; hormonal needs are already met at this point. Each gram of fat costs 9 kcal, more than double protein or carbohydrate, so total daily calories climb quickly beyond this level.",
      conversational: "A fine choice if fatty foods are what keep you satisfied. Your hormones were already covered a while back. Just remember every gram of fat costs 9 kcal, more than double protein or carbs, so your daily total climbs fast up here.",
    },
  };
  return {
    label: { academic: "Displacing calorie budget", conversational: "Costly to keep low" },
    tone: "serious",
    icon: "⚠",
    text: {
      academic: "Beyond any hormonal benefit. At 9 kcal per gram, fat intake at this level makes a meaningful contribution to total daily calories on its own. Appropriate for a deliberate higher-fat approach; otherwise, consider reducing intake to lower the daily total.",
      conversational: "Beyond any hormonal benefit. At 9 kcal a gram, fat at this level is doing a lot of the work in your daily total on its own. Fine if you're deliberately going higher-fat, otherwise slide it back down to bring your total calories lower.",
    },
  };
}

/**
 * What a given carb intake (g per kg body weight) means for training fuel
 * and total daily calories. Carbs are also protein-sparing fuel: with
 * glycogen available the body has less reason to burn amino acids.
 */
function carbZone(gPerKg) {
  if (gPerKg < 0.75) return {
    label: { academic: "Ketogenic range", conversational: "Keto territory" },
    tone: "serious",
    icon: "⚠",
    text: {
      academic: "A markedly low carbohydrate intake, and the easiest lever for reducing total daily calories toward their floor. Sustainable if adopted deliberately; some individuals report improved appetite control at this level, but reduced training capacity should be expected during the initial adaptation period, particularly for high-intensity efforts.",
      conversational: "Very low carb, and the fastest way to bring your daily total down. Totally doable if it's a deliberate choice (some people like it for appetite control), but expect flat, heavy workouts for the first few weeks, and less top-end in intense training.",
    },
  };
  if (gPerKg < 2) return {
    label: { academic: "Limited fuel", conversational: "Low fuel" },
    tone: "neutral",
    icon: "🔋",
    text: {
      academic: "Sufficient for daily activity and light training. Hard or prolonged sessions will draw on glycogen reserves; reduced training performance at this level is attributable to carbohydrate availability. Concentrating intake around training sessions improves utilization.",
      conversational: "Enough for daily life and light training. Hard or long sessions will dip into your reserves; if workouts start feeling flat, this is probably why. Time most of these carbs around training for the best return.",
    },
  };
  if (gPerKg <= 4) return {
    label: { academic: "Adequate fuel", conversational: "Moderate fuel" },
    tone: "good",
    icon: "✓",
    text: {
      academic: "Adequate glycogen replenishment for regular training<sup class=\"cite\"><a href=\"#ref-13\">13</a></sup>. Carbohydrate is also protein-sparing: when glycogen is available, the body relies less on amino acid oxidation for energy, providing an additional layer of muscle protection. This is typically the lowest carbohydrate level within the well-supported range, making it the natural starting point when minimizing total calories.",
      conversational: "Solid glycogen for regular training<sup class=\"cite\"><a href=\"#ref-13\">13</a></sup>. Carbs are also protein-sparing: with fuel on hand, your body has less reason to burn muscle for energy, one more layer of protection for the muscle you're working to keep. This is usually the low end of the comfortable zone, a good place to aim for if you're trying to bring your total calories down without leaving the sweet spot.",
    },
  };
  return {
    label: { academic: "High fuel", conversational: "High fuel" },
    tone: "good",
    icon: "🚀",
    text: {
      academic: "Ample glycogen availability, well suited to high training volumes or physically demanding occupations. If activity level is lower than this, reducing carbohydrate toward the adequate-fuel range would lower total daily calories with little practical downside.",
      conversational: "Plenty of glycogen, well suited to high training volumes or a physical job. If you're not that active, easing this down toward the moderate-fuel range would bring your daily total down without much of a downside.",
    },
  };
}

function renderZone(outId, zoneId, gdayId, refKg, grams, zone, decimals) {
  $(outId).value = Math.round(grams);
  const gkg = Number.isFinite(refKg) && refKg > 0 ? grams / refKg : NaN;
  $(gdayId).textContent = Number.isFinite(gkg) ? `(${gkg.toFixed(decimals)} g/kg)` : "";
  $(zoneId).innerHTML = `
    <span class="zone-chip zone-${zone.tone}"><span aria-hidden="true">${zone.icon}</span> ${reg(zone.label)}</span>
    <p>${reg(zone.text)}</p>`;
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
      warnings.push({
        academic: "The pace selected would imply a deficit exceeding 25 percent of maintenance calories for the suggested target. The suggestion has been capped at 25 percent; a slower pace is recommended.",
        conversational: "Your chosen pace would put the suggested target's deficit above 25% of maintenance. We've capped the suggestion at 25%, so pick a gentler pace if you want the target itself to move.",
      });
    }
    targetCalories = tdee - suggestedDeficit;
  } else {
    suggestedDeficit = 0;
    targetCalories = tdee;
    warnings.push(
      targetKg > weightKg + 0.05
        ? {
            academic: "Target weight exceeds current weight, so the suggested target reflects maintenance intake. For lean mass gain, a surplus of 5 to 10 percent above maintenance, combined with adequate protein intake, is generally recommended.",
            conversational: "Your target is above your current weight, so the suggested number is for maintaining, not losing. For lean muscle gain, add a small surplus of 5 to 10% on top and keep protein high.",
          }
        : {
            academic: "Target weight equals current weight, so the suggested target reflects maintenance intake.",
            conversational: "Your target is the same as your current weight, so the suggested number is for maintaining.",
          }
    );
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
    warnings.push({
      academic: `Actual intake falls below ${MIN_CALORIES} kcal/day, a level generally considered inadequate to meet nutrient needs without clinical supervision. Increasing one or more macronutrient settings, or consulting a qualified professional, is recommended.`,
      conversational: `Your sliders add up to under ${MIN_CALORIES} kcal a day, which is hard to get proper nutrition from without medical supervision. Bring one of the sliders up, or talk to a professional.`,
    });
  } else if (actualDeficit > MAX_DEFICIT_FRACTION * tdee) {
    warnings.push({
      academic: "The current macro settings create an energy deficit exceeding 25 percent of maintenance calories, which increases the risk of muscle loss and metabolic rebound. Increasing carbohydrate or fat intake is recommended.",
      conversational: "Your sliders currently add up to more than 25% below maintenance, which risks losing muscle and rebounding later. Try adding back some carbs or fat.",
    });
  }

  if (gkg < 1.6) {
    warnings.push({
      academic: "Protein intake is set below 1.6 g/kg. If total intake is also below maintenance, a portion of the resulting weight loss is likely to derive from skeletal muscle rather than fat mass. Increasing intake toward the 1.6–2.2 g/kg range is recommended.",
      conversational: "Protein is set below 1.6 g/kg. If you're also in a deficit, some of the weight you lose will likely come from muscle instead of fat. Slide protein up toward the 1.6–2.2 g/kg range to protect it.",
    });
  }
  if (fkg < 0.6) {
    warnings.push({
      academic: "Fat intake is set below 0.6 g/kg. Sustained at this level, hormone production and fat-soluble vitamin absorption may be impaired. Increasing intake to at least 0.6–0.8 g/kg is recommended.",
      conversational: "Fat is set below 0.6 g/kg. Kept there for a while, hormone production and vitamin absorption tend to suffer. Slide fat up to at least 0.6–0.8 g/kg.",
    });
  }

  if (age < 18) {
    warnings.push({
      academic: "This calculator is not calibrated for individuals under 18 years of age, whose nutritional requirements differ substantially due to ongoing growth and development. Consultation with a doctor or registered dietitian is recommended.",
      conversational: "You're under 18: growing bodies have different needs, and this calculator isn't built for that. Please loop in a doctor or dietitian.",
    });
  }

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
    { name: "Protein", grams: r.proteinG, kcal: pKcal, cls: "protein" },
    { name: "Carbs", grams: r.carbsG, kcal: cKcal, cls: "carbs" },
    { name: "Fat", grams: r.fatG, kcal: fKcal, cls: "fat" },
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

  const delta = r.actualCalories - r.targetCalories;
  const closeEnough = Math.abs(delta) < 15;
  const compareLine = closeEnough
    ? reg({
        academic: `This closely matches the suggested target of ${fmt(r.targetCalories)} kcal.`,
        conversational: `That's right at your ~${fmt(r.targetCalories)} kcal suggested target.`,
      })
    : delta < 0
    ? reg({
        academic: `This is ${fmt(-delta)} kcal below the suggested target of ${fmt(r.targetCalories)} kcal.`,
        conversational: `That's ${fmt(-delta)} kcal below your ~${fmt(r.targetCalories)} kcal target.`,
      })
    : reg({
        academic: `This is ${fmt(delta)} kcal above the suggested target of ${fmt(r.targetCalories)} kcal.`,
        conversational: `That's ${fmt(delta)} kcal above your ~${fmt(r.targetCalories)} kcal target.`,
      });

  const etaDate = new Date(Date.now() + r.weeks * 7 * 864e5);
  const eta = etaDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  let timeline;
  if (r.timelineState === "losing") {
    timeline = `<div class="tile">
         <div class="tile-label">Weekly loss</div>
         <div class="tile-value">${fmtWeight(r.actualWeeklyLossKg)}</div>
         <div class="tile-sub">${reg({
           academic: `approximately ${Math.ceil(r.weeks)} weeks, reaching target around ${eta}`,
           conversational: `about ${Math.ceil(r.weeks)} weeks, around ${eta}`,
         })}</div>
       </div>`;
  } else if (r.timelineState === "gaining") {
    timeline = `<div class="tile">
         <div class="tile-label">Weekly change</div>
         <div class="tile-value">+${fmtWeight(-r.actualWeeklyLossKg)}</div>
         <div class="tile-sub">${reg({
           academic: "current settings produce a caloric surplus",
           conversational: "your sliders add up to a surplus right now",
         })}</div>
       </div>`;
  } else {
    timeline = `<div class="tile">
         <div class="tile-label">Mode</div>
         <div class="tile-value">Maintain</div>
         <div class="tile-sub">${reg({
           academic: "intake closely matches maintenance expenditure",
           conversational: "your total is right around maintenance",
         })}</div>
       </div>`;
  }

  const warnings = r.warnings
    .map((w) => `<div class="notice"><span class="notice-icon" aria-hidden="true">⚠</span><p>${reg(w)}</p></div>`)
    .join("");

  const proteinZ = proteinZone(r.proteinG / r.proteinRefKg);
  const carbZ = carbZone(r.carbsG / r.weightKg);
  const fatZ = fatZone(r.fatG / r.proteinRefKg);

  const goodNotice = r.allGood
    ? `<div class="notice success">
        <span class="notice-icon" aria-hidden="true">🎯</span>
        <p>${reg({
          academic: `All three macronutrients fall within their evidence-based optimal ranges at a total daily intake of ${fmt(r.actualCalories)} kcal. This is approximately the lowest energy level achievable here without moving a macronutrient outside its recommended range.`,
          conversational: `Every macro is in its sweet spot at just ${fmt(r.actualCalories)} kcal a day. That's about as low as you can go here without pushing one of them out of its safe range.`,
        })}</p>
      </div>`
    : "";

  out.innerHTML = `
    <div class="card">
      <div class="hero-number">
        <div class="tile-label">${reg({ academic: "Total daily intake", conversational: "Your daily total" })}</div>
        <div class="hero-value"><span data-count="cal">${fmt(r.actualCalories)}</span> <span class="hero-unit">kcal</span></div>
        <div class="tile-sub">${compareLine}</div>
      </div>

      ${goodNotice}

      <h2 class="section-title">Daily macros</h2>
      ${macroBar(r)}
      <table class="macro-table">
        <thead><tr><th scope="col">Macro</th><th scope="col">Grams / day</th><th scope="col">kcal</th><th scope="col">Why</th></tr></thead>
        <tbody>
          <tr><td>Protein</td><td>${fmt(r.proteinG)} g</td><td>${fmt(r.proteinG * 4)}</td><td>${(r.proteinG / r.proteinRefKg).toFixed(1)} g/kg · ${reg(proteinZ.label).toLowerCase()}</td></tr>
          <tr><td>Carbs</td><td>${fmt(r.carbsG)} g</td><td>${fmt(r.carbsG * 4)}</td><td>${(r.carbsG / r.weightKg).toFixed(1)} g/kg · ${reg(carbZ.label).toLowerCase()}</td></tr>
          <tr><td>Fat</td><td>${fmt(r.fatG)} g</td><td>${fmt(r.fatG * 9)}</td><td>${(r.fatG / r.proteinRefKg).toFixed(2)} g/kg · ${reg(fatZ.label).toLowerCase()}</td></tr>
        </tbody>
      </table>

      <h2 class="section-title">The numbers behind it</h2>
      <div class="tiles">
        <div class="tile">
          <div class="tile-label">Resting metabolism (BMR)</div>
          <div class="tile-value"><span data-count="bmr">${fmt(r.bmr)}</span> kcal</div>
          <div class="tile-sub">Mifflin-St Jeor <sup class="cite"><a href="#ref-1">1</a></sup></div>
        </div>
        <div class="tile">
          <div class="tile-label">Maintenance (TDEE)</div>
          <div class="tile-value"><span data-count="tdee">${fmt(r.tdee)}</span> kcal</div>
          <div class="tile-sub">BMR × activity <sup class="cite"><a href="#ref-3">3</a></sup></div>
        </div>
        <div class="tile">
          <div class="tile-label">Suggested target</div>
          <div class="tile-value">${fmt(r.targetCalories)} kcal</div>
          <div class="tile-sub">${reg({ academic: "from selected pace", conversational: "based on your pace" })}</div>
        </div>
        ${timeline}
      </div>

      ${warnings}

      <div class="notice tip">
        <span class="notice-icon" aria-hidden="true">💪</span>
        <p>${reg({
          academic: `<strong>Muscle preservation:</strong> a caloric deficit spares muscle only when resistance training provides a physiological stimulus to retain it<sup class="cite"><a href="#ref-9">9</a></sup>. Resistance train 2 to 4 times weekly, meet the daily protein target across 3 to 5 meals, and obtain 7 to 9 hours of sleep.`,
          conversational: `<strong>Keep the muscle:</strong> a calorie deficit only spares muscle if you give your body a reason to keep it<sup class="cite"><a href="#ref-9">9</a></sup>. Do resistance training 2 to 4 times a week, hit your protein number daily (spread over 3 to 5 meals), and sleep 7 to 9 hours.`,
        })}</p>
      </div>
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

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  loadRegister();
  syncUnitFields();
  syncProfileFields();
  updateSliderBounds();
  renderAllZones();
  render();

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
      renderAllZones();
      render();
    });
  });

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
