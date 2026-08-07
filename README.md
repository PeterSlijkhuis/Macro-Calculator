# Macro Calculator 🥗

A free, no-build, single-page web tool that calculates your daily calories and
macros to **lose fat at a healthy pace while preserving muscle**.

**[Open the calculator](https://peterslijkhuis.github.io/Macro-Calculator/)** (GitHub Pages)

## Features

- **Metric & imperial** — kg/cm or lb/ft·in, with automatic value conversion when you switch
- **Target weight** — get a weekly loss rate and an estimated finish date
- **Inclusive hormonal profiles** — options for trans women, trans men, and
  non-binary/intersex people, including a months-on-HRT input that gradually
  shifts the metabolism estimate toward the hormone-matched profile
- **Muscle-sparing macros** — protein set at 2.0 g/kg (evidence range 1.6–2.2 g/kg),
  fat never below 0.7 g/kg, deficit capped at 25% of maintenance
- **Safety rails** — warnings for very low calories, very low carbs, and under-18 users
- Works offline once loaded, remembers your inputs locally, light & dark mode,
  no tracking, no dependencies

## How the math works

| Step | Formula |
|---|---|
| Resting metabolism (BMR) | Mifflin–St Jeor: `10·kg + 6.25·cm − 5·age + s` |
| Sex constant `s` | Interpolated between −161 (estrogen-dominant) and +5 (testosterone-dominant): `s = −161 + 166·b` |
| HRT adjustment | Blend factor `b` shifts linearly from the pre-HRT profile to the hormone-matched profile over the first 6 months of HRT |
| Maintenance (TDEE) | `BMR × activity factor` (1.2 – 1.9) |
| Deficit | Chosen pace (0.5–1% of body weight/week) × 7700 kcal/kg ÷ 7, **capped at 25% of TDEE** |
| Protein | 2.0 g per kg body weight (target weight is used as the reference when BMI ≥ 30, as a better proxy for lean mass) |
| Fat | The larger of 0.7 g/kg or 25% of calories |
| Carbs | Whatever calories remain |

The hormonal-profile handling reflects that metabolism formulas track
hormone-driven body composition rather than gender identity: resting energy
expenditure measurably shifts within the first months of hormone therapy.
The 6-month linear blend is a pragmatic approximation, not a clinical claim.

## Running locally

It's plain HTML/CSS/JS — no build step:

```sh
git clone https://github.com/PeterSlijkhuis/Macro-Calculator.git
cd Macro-Calculator
# open index.html in a browser, or:
python3 -m http.server 8000
```

## Hosting on GitHub Pages

Repository **Settings → Pages → Deploy from a branch**, pick the default
branch and `/ (root)`. That's it.

## Disclaimer

This tool provides evidence-based *estimates* for healthy adults and is not
medical advice. Talk to a doctor or registered dietitian before making big
dietary changes — especially if you're under 18, pregnant, have a medical
condition or eating-disorder history, or are on hormone therapy.
