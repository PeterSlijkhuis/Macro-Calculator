"use strict";

/* ---------- constants ---------- */

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const KCAL_PER_KG_FAT = 7700; // energy in ~1 kg of body fat
const HRT_SETTLE_MONTHS = 6;  // metabolic shift settles over ~first 6 months of HRT
const MAX_DEFICIT_FRACTION = 0.25; // never cut more than 25% below maintenance
const MIN_CALORIES = 1200;    // below this, flag as too low without supervision

const FAT_FLOOR_G_PER_KG = 0.5; // absolute floor when the budget clamp kicks in

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
      academic: "Additional appetite control and a margin of safety, most useful when body fat is already low or the deficit is aggressive, the conditions under which muscle loss risk is highest<sup class=\"cite\"><a href=\"#ref-8\">8</a>,<a href=\"#ref-9\">9</a></sup>. The added muscle-retention benefit above 2.2 g/kg is marginal<sup class=\"cite\"><a href=\"#ref-7\">7</a></sup>, and each extra gram of protein displaces calories that would otherwise support carbohydrate intake.",
      conversational: "A bit more appetite control and a safety margin, worth having if you're already lean or cutting hard, since that's when muscle is most at risk<sup class=\"cite\"><a href=\"#ref-8\">8</a>,<a href=\"#ref-9\">9</a></sup>. The muscle-protection benefit above 2.2 g/kg is marginal<sup class=\"cite\"><a href=\"#ref-7\">7</a></sup>, and every extra gram of protein takes calories away from the carbs that fuel your training.",
    },
  };
  return {
    label: { academic: "Above requirement", conversational: "More than needed" },
    tone: "serious",
    icon: "⚠",
    text: {
      academic: "No additional muscle-retention benefit accrues beyond this point; the effect has plateaued. Excess protein primarily displaces carbohydrate and fat from the budget, which can reduce training capacity and daily energy, though it poses no known risk to kidney function in healthy individuals.",
      conversational: "No extra muscle protection up here, the benefit already plateaued. It mostly crowds carbs and fat out of your budget (harder workouts, lower energy) and becomes a chore to eat every day. Not harmful for healthy kidneys, just unnecessary.",
    },
  };
}

/**
 * What a given fat intake (g per kg body weight) means for hormone health,
 * satiety, and how much of the calorie budget is left for carbs.
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
      academic: "Sufficient to support hormone production and fat-soluble vitamin absorption. Fat also slows gastric emptying, extending satiety, while leaving adequate room in the calorie budget for the carbohydrate intake that supports training.",
      conversational: "Enough fat to keep hormone production and vitamin absorption running smoothly. It also slows digestion, so meals keep you full for longer, and it still leaves plenty of room in the budget for the carbs that fuel your training.",
    },
  };
  if (gkg <= 1.35) return {
    label: { academic: "Above requirement", conversational: "Higher fat" },
    tone: "neutral",
    icon: "🥑",
    text: {
      academic: "A reasonable preference if fat-dense foods aid dietary adherence; hormonal needs are already met at this point. Each gram of fat costs 9 kcal, more than double protein or carbohydrate, so the remaining carbohydrate budget shrinks quickly beyond this level.",
      conversational: "A fine choice if fatty foods are what keep you satisfied. Your hormones were already covered a while back. Just remember every gram of fat costs 9 kcal, more than double protein or carbs, so carb room shrinks fast up here.",
    },
  };
  return {
    label: { academic: "Displacing carbohydrate", conversational: "Carb squeeze" },
    tone: "serious",
    icon: "⚠",
    text: {
      academic: "Beyond any hormonal benefit. At this level, fat intake substantially displaces carbohydrate from the budget, which can reduce training capacity during intense sessions. Appropriate for a deliberate low-carbohydrate approach; otherwise, consider reducing intake.",
      conversational: "Beyond any hormonal benefit. At this level, fat is mostly squeezing carbs out of the budget, which makes hard training sessions feel flat. Fine if you're deliberately going low-carb, otherwise slide it back down.",
    },
  };
}

/**
 * What the leftover carb allowance means. Carbs are protein-sparing fuel:
 * with glycogen available the body has less reason to burn amino acids.
 * Thresholds in g per kg body weight.
 */
function carbZone(gPerKg) {
  if (gPerKg < 0.75) return {
    label: { academic: "Ketogenic range", conversational: "Keto territory" },
    tone: "serious",
    icon: "⚠",
    text: {
      academic: "A markedly low carbohydrate intake. Sustainable if adopted deliberately; some individuals report improved appetite control at this level, but reduced training capacity should be expected during the initial adaptation period, particularly for high-intensity efforts. To increase carbohydrate room, reduce the protein or fat setting, or select a slower pace.",
      conversational: "Very low carb. Totally doable if it's a deliberate choice (some people like it for appetite control), but expect flat, heavy workouts for the first few weeks, and less top-end in intense training. To free up carb room, nudge protein or fat down, or pick a gentler pace.",
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
      academic: "Adequate glycogen replenishment for regular training<sup class=\"cite\"><a href=\"#ref-13\">13</a></sup>. Carbohydrate is also protein-sparing: when glycogen is available, the body relies less on amino acid oxidation for energy, providing an additional layer of muscle protection.",
      conversational: "Solid glycogen for regular training<sup class=\"cite\"><a href=\"#ref-13\">13</a></sup>. Carbs are also protein-sparing: with fuel on hand, your body has less reason to burn muscle for energy, one more layer of protection for the muscle you're working to keep.",
    },
  };
  return {
    label: { academic: "High fuel", conversational: "High fuel" },
    tone: "good",
    icon: "🚀",
    text: {
      academic: "Ample glycogen availability, well suited to high training volumes or physically demanding occupations. If activity level is lower than this, reallocating part of this budget toward fat (for satiety) or a marginally faster pace may be more appropriate.",
      conversational: "Plenty of glycogen, well suited to high training volumes or a physical job. If you're not that active, some of this budget might serve you better as fat (more filling) or a slightly brisker pace.",
    },
  };
}

function renderZone(outId, zoneId, gdayId, gkg, zone, decimals) {
  $(outId).value = gkg.toFixed(decimals);
  const ref = refWeightKg();
  $(gdayId).textContent = Number.isFinite(ref) ? `≈ ${Math.round(gkg * ref)} g/day` : "";
  $(zoneId).innerHTML = `
    <span class="zone-chip zone-${zone.tone}"><span aria-hidden="true">${zone.icon}</span> ${reg(zone.label)}</span>
    <p>${reg(zone.text)}</p>`;
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
        warnings.push({
          academic: "The selected pace would require a deficit exceeding 25 percent of maintenance calories, which increases the risk of muscle loss and metabolic rebound. Intake has been capped at 25 percent; a slower pace is recommended.",
          conversational: "Your chosen pace would need a deficit bigger than 25% of maintenance, which risks losing muscle and rebounding later. We've capped it at 25%, so pick a gentler pace for a smoother ride.",
        });
      }
    }

    calories = tdee - deficit;
    weeks = (weightKg - targetKg) / weeklyLossKg;

    if (calories < MIN_CALORIES) {
      warnings.push({
        academic: `Estimated intake falls below ${MIN_CALORIES} kcal/day, a level generally considered inadequate to meet nutrient needs without clinical supervision. Selecting a slower pace, or consulting a qualified professional, is recommended.`,
        conversational: `This lands under ${MIN_CALORIES} kcal a day, which is hard to get proper nutrition from without medical supervision. Choose a gentler pace, or talk to a professional.`,
      });
    }
  } else {
    calories = tdee;
    deficit = 0;
    weeklyLossKg = 0;
    weeks = 0;
    warnings.push(
      targetKg > weightKg + 0.05
        ? {
            academic: "Target weight exceeds current weight, so the figures shown reflect maintenance intake. For lean mass gain, a surplus of 5 to 10 percent above maintenance, combined with adequate protein intake, is generally recommended.",
            conversational: "Your target is above your current weight, so these numbers are for maintaining, not losing. For lean muscle gain, add a small surplus of 5 to 10% on top and keep protein high.",
          }
        : {
            academic: "Target weight equals current weight, so the figures shown reflect maintenance intake.",
            conversational: "Your target is the same as your current weight, so these numbers are for maintaining.",
          }
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
    warnings.push({
      academic: "Protein intake is set below 1.6 g/kg while in a caloric deficit. A portion of the resulting weight loss is likely to derive from skeletal muscle rather than fat mass. Increasing intake toward the 1.6–2.2 g/kg range is recommended.",
      conversational: "Protein is set below 1.6 g/kg while you're in a deficit. Some of the weight you lose will likely come from muscle instead of fat. Slide protein up toward the 1.6–2.2 g/kg range to protect it.",
    });
  }
  if (fkg < 0.6) {
    warnings.push({
      academic: "Fat intake is set below 0.6 g/kg. Sustained at this level, hormone production and fat-soluble vitamin absorption may be impaired. Increasing intake to at least 0.6–0.8 g/kg is recommended.",
      conversational: "Fat is set below 0.6 g/kg. Kept there for a while, hormone production and vitamin absorption tend to suffer. Slide fat up to at least 0.6–0.8 g/kg.",
    });
  }

  // Keep the three macros inside the calorie budget: trim fat first (down to
  // an absolute floor), then protein.
  if (proteinG * 4 + fatG * 9 > calories) {
    fatG = Math.max(FAT_FLOOR_G_PER_KG * proteinRefKg, (calories - proteinG * 4) / 9);
    if (proteinG * 4 + fatG * 9 > calories) {
      proteinG = Math.max(Math.min(gkg, 1.6) * proteinRefKg, (calories - fatG * 9) / 4);
    }
    warnings.push({
      academic: "Combined protein and fat settings exceed the available calorie budget; both have been reduced to fit, leaving no calories for carbohydrate. Lowering one of the sliders, or selecting a slower pace, is recommended.",
      conversational: "Your protein and fat settings add up to more than your calorie budget, so we've trimmed them to fit, which leaves carbs at zero. Lower one of the sliders, or pick a gentler pace.",
    });
  }

  const carbsG = Math.max(0, (calories - proteinG * 4 - fatG * 9) / 4);

  if (age < 18) {
    warnings.push({
      academic: "This calculator is not calibrated for individuals under 18 years of age, whose nutritional requirements differ substantially due to ongoing growth and development. Consultation with a doctor or registered dietitian is recommended.",
      conversational: "You're under 18: growing bodies have different needs, and this calculator isn't built for that. Please loop in a doctor or dietitian.",
    });
  }

  return {
    bmr, tdee, calories, deficit, weeklyLossKg, weeks, losing, warnings,
    proteinG, fatG, carbsG, proteinRefKg, weightKg, targetKg, bmi, blend: b, gkg, fkg,
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

  const etaDate = new Date(Date.now() + r.weeks * 7 * 864e5);
  const eta = etaDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const timeline = r.losing
    ? `<div class="tile">
         <div class="tile-label">Weekly loss</div>
         <div class="tile-value">${fmtWeight(r.weeklyLossKg)}</div>
         <div class="tile-sub">${reg({
           academic: `approximately ${Math.ceil(r.weeks)} weeks, reaching target around ${eta}`,
           conversational: `about ${Math.ceil(r.weeks)} weeks, around ${eta}`,
         })}</div>
       </div>`
    : `<div class="tile">
         <div class="tile-label">Mode</div>
         <div class="tile-value">Maintain</div>
         <div class="tile-sub">no deficit applied</div>
       </div>`;

  const warnings = r.warnings
    .map((w) => `<div class="notice"><span class="notice-icon" aria-hidden="true">⚠</span><p>${reg(w)}</p></div>`)
    .join("");

  const proteinZ = proteinZone(r.proteinG / r.proteinRefKg);
  const carbZ = carbZone(r.carbsG / r.weightKg);
  const fatZ = fatZone(r.fatG / r.proteinRefKg);

  out.innerHTML = `
    <div class="card">
      <div class="hero-number">
        <div class="tile-label">${r.losing ? "Daily calorie target" : "Daily maintenance calories"}</div>
        <div class="hero-value"><span data-count="cal">${fmt(r.calories)}</span> <span class="hero-unit">kcal</span></div>
        ${r.losing ? `<div class="tile-sub">${reg({
          academic: `an estimated ${fmt(r.deficit)} kcal/day deficit relative to maintenance expenditure of ${fmt(r.tdee)} kcal`,
          conversational: `a ${fmt(r.deficit)} kcal/day deficit below your ${fmt(r.tdee)} kcal maintenance`,
        })}</div>` : ""}
      </div>

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

      <div class="zone-feedback carb-note">
        <span class="zone-chip zone-${carbZ.tone}"><span aria-hidden="true">${carbZ.icon}</span> Carbs: ${reg(carbZ.label).toLowerCase()}</span>
        <p>${reg({
          academic: `<strong>Carbohydrate is calculated as the residual macronutrient:</strong> it fills the remaining ${fmt(r.carbsG * 4)} kcal once protein and fat allocations are set.`,
          conversational: `<strong>Carbs are the leftover dial:</strong> they fill the ${fmt(r.carbsG * 4)} kcal left over after your protein and fat settings.`,
        })} ${reg(carbZ.text)}</p>
      </div>

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
    animateCount(out.querySelector('[data-count="cal"]'), renderCache.calories, r.calories);
    animateCount(out.querySelector('[data-count="bmr"]'), renderCache.bmr, r.bmr);
    animateCount(out.querySelector('[data-count="tdee"]'), renderCache.tdee, r.tdee);
    animateBarFrom(renderCache.widths);
  }
  const widths = {};
  out.querySelectorAll(".macro-bar .seg-fill").forEach((seg) => { widths[seg.dataset.macro] = seg.style.width; });
  renderCache = { calories: r.calories, bmr: r.bmr, tdee: r.tdee, widths };
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

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  loadRegister();
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

  document.querySelectorAll('input[name="register"]').forEach((el) => {
    el.addEventListener("change", (e) => {
      applyRegister(e.target.value);
      saveRegister(e.target.value);
      renderProteinZone();
      renderFatZone();
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
