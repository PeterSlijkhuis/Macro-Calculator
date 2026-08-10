# Macro Calculator 🥗

A free, no-build, single-page, **open-science** web tool that calculates your
daily calories and macros to **lose fat at a healthy pace while preserving
muscle**, with every formula and every threshold linked to the peer-reviewed
research it's based on. Explanations are available in two registers, academic
and conversational, toggled from a switch at the top of the page.

**[Open the calculator](https://peterslijkhuis.github.io/Macro-Calculator/)** (GitHub Pages)

## Features

- **Metric & imperial.** kg/cm or lb/ft·in, with automatic value conversion when you switch
- **Target weight.** Get a weekly loss rate and an estimated finish date
- **Inclusive hormonal profiles.** Options for trans women, trans men, and
  non-binary/intersex people, including a months-on-HRT input that gradually
  shifts the metabolism estimate toward the hormone-matched profile
- **Academic and conversational explanations.** A toggle at the top of the
  page switches every hint, warning, and results explanation between a formal
  register and a plain-language one, without changing any of the numbers
- **Live-feedback sliders for every macro.** Protein (1.0–3.0 g/kg) and fat
  (0.4–1.6 g/kg) each have a slider with a status chip, a large pop-up gram
  readout while you drag, and an explanation of what that level means for
  muscle retention, hormone health, satiety, and the rest of the calorie
  budget. Carbs are the leftover dial: they fill the remaining calories
  automatically and get their own live zone readout (keto territory, low,
  moderate, or high fuel)
- **Muscle-sparing defaults.** Protein 2.0 g/kg, fat 0.8 g/kg, deficit capped
  at 25% of maintenance
- **Safety rails.** Warnings for very low calories, very low carbs, and under-18 users
- **In-app "How the maths works".** A numbered, cited walkthrough of every
  formula, plus a full reference list with DOI links, right on the page
- Animated results (numbers count up, the macro bar morphs, cards reveal on
  scroll) that back off automatically for `prefers-reduced-motion`
- Works offline once loaded, remembers your inputs locally, light & dark mode,
  no tracking, no dependencies, MIT-licensed

## How the math works

| Step | Formula |
|---|---|
| Resting metabolism (BMR) | Mifflin–St Jeor: `10·kg + 6.25·cm − 5·age + s` |
| Sex constant `s` | Interpolated between −161 (estrogen-dominant) and +5 (testosterone-dominant): `s = −161 + 166·b` |
| HRT adjustment | Blend factor `b` shifts linearly from the pre-HRT profile to the hormone-matched profile over the first 6 months of HRT |
| Maintenance (TDEE) | `BMR × activity factor` (1.2 – 1.9) |
| Deficit | Chosen pace (0.5–1% of body weight/week) × 7700 kcal/kg ÷ 7, **capped at 25% of TDEE** |
| Protein | User-chosen 1.0–3.0 g per kg body weight, default 2.0 (target weight is used as the reference when BMI ≥ 30, as a better proxy for lean mass); below 1.6 g/kg in a deficit the tool warns that weight loss will include muscle |
| Fat | User-chosen 0.4–1.6 g/kg, default 0.8; below 0.6 g/kg the tool warns about hormone production and fat-soluble vitamin absorption |
| Carbs | Whatever calories remain, with a live readout of what that level means for training fuel (thresholds at 0.75 / 2 / 4 g/kg) |
| Budget clamp | If protein + fat exceed the calorie budget, fat is trimmed first (to a 0.5 g/kg floor), then protein, with a warning |

The hormonal-profile handling reflects that metabolism formulas track
hormone-driven body composition rather than gender identity: resting energy
expenditure measurably shifts within the first months of hormone therapy.
The 6-month linear blend is a pragmatic approximation, not a clinical claim.

The calculator itself shows this same table with full narrative context and
citations under **"How the maths works"**, in both explanation registers,
followed by a numbered reference list with DOI links: nothing above is
asserted without a source.

## References

1. Mifflin MD, St Jeor ST, Hill LA, et al. A new predictive equation for resting energy expenditure in healthy individuals. *Am J Clin Nutr.* 1990;51(2):241–247. [doi:10.1093/ajcn/51.2.241](https://doi.org/10.1093/ajcn/51.2.241)
2. Frankenfield D, Roth-Yousey L, Compher C. Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults. *J Am Diet Assoc.* 2005;105(5):775–789. [doi:10.1016/j.jada.2005.02.005](https://doi.org/10.1016/j.jada.2005.02.005)
3. FAO/WHO/UNU. Human energy requirements: report of a Joint FAO/WHO/UNU Expert Consultation. Rome; 2001. [fao.org/3/y5686e](https://www.fao.org/3/y5686e/y5686e00.htm)
4. Wishnofsky M. Caloric equivalents of gained or lost weight. *Am J Clin Nutr.* 1958;6(5):542–546. [doi:10.1093/ajcn/6.5.542](https://doi.org/10.1093/ajcn/6.5.542)
5. Hall KD. What is the required energy deficit per unit weight loss? *Int J Obes.* 2008;32(3):573–576. [doi:10.1038/sj.ijo.0803720](https://doi.org/10.1038/sj.ijo.0803720)
6. Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different weight-loss rates on body composition and performance in elite athletes. *Int J Sport Nutr Exerc Metab.* 2011;21(2):97–104. [doi:10.1123/ijsnem.21.2.97](https://doi.org/10.1123/ijsnem.21.2.97)
7. Morton RW, Murphy KT, McKellar SR, et al. Effect of protein supplementation on resistance training-induced gains in muscle mass and strength. *Br J Sports Med.* 2018;52(6):376–384. [doi:10.1136/bjsports-2017-097608](https://doi.org/10.1136/bjsports-2017-097608)
8. Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation. *J Int Soc Sports Nutr.* 2014;11:20. [doi:10.1186/1550-2783-11-20](https://doi.org/10.1186/1550-2783-11-20)
9. Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM. Higher dietary protein during an energy deficit promotes greater lean mass gain and fat mass loss. *Am J Clin Nutr.* 2016;103(3):738–746. [doi:10.3945/ajcn.115.119339](https://doi.org/10.3945/ajcn.115.119339)
10. Leidy HJ, Clifton PM, Astrup A, et al. The role of protein in weight loss and maintenance. *Am J Clin Nutr.* 2015;101(6):1320S–1329S. [doi:10.3945/ajcn.114.084038](https://doi.org/10.3945/ajcn.114.084038)
11. Westerterp KR. Diet induced thermogenesis. *Nutr Metab (Lond).* 2004;1(1):5. [doi:10.1186/1743-7075-1-5](https://doi.org/10.1186/1743-7075-1-5)
12. Whittaker J, Wu K. Low-fat diets and testosterone in men: systematic review and meta-analysis. *J Steroid Biochem Mol Biol.* 2021;210:105878. [doi:10.1016/j.jsbmb.2021.105878](https://doi.org/10.1016/j.jsbmb.2021.105878)
13. Burke LM, Hawley JA, Wong SHS, Jeukendrup AE. Carbohydrates for training and competition. *J Sports Sci.* 2011;29(sup1):S17–S27. [doi:10.1080/02640414.2011.585473](https://doi.org/10.1080/02640414.2011.585473)
14. Klaver M, de Blok CJM, Wiepjes CM, et al. Changes in regional body fat, lean body mass and body shape in trans persons using cross-sex hormonal therapy. *Eur J Endocrinol.* 2018;178(2):163–171. [doi:10.1530/EJE-17-0496](https://doi.org/10.1530/EJE-17-0496)
15. Spanos C, Bretherton I, Zajac JD, Cheung AS. Effects of gender-affirming hormone therapy on insulin resistance and body composition in transgender individuals. *World J Diabetes.* 2020;11(3):66–77. [doi:10.4239/wjd.v11.i3.66](https://doi.org/10.4239/wjd.v11.i3.66)

## Running locally

It's plain HTML/CSS/JS, no build step:

```sh
git clone https://github.com/PeterSlijkhuis/Macro-Calculator.git
cd Macro-Calculator
# open index.html in a browser, or:
python3 -m http.server 8000
```

## Hosting on GitHub Pages

A workflow (`.github/workflows/pages.yml`) deploys automatically on every
push via GitHub Actions, with no build step and no branch juggling. The repo
needs to be public (or on a paid plan) for Pages to be available.

## Disclaimer

This tool provides evidence-based *estimates* for healthy adults and is not
medical advice. Talk to a doctor or registered dietitian before making big
dietary changes, especially if you're under 18, pregnant, have a medical
condition or eating-disorder history, or are on hormone therapy.

## License

[MIT](LICENSE). Use it, fork it, audit it.
