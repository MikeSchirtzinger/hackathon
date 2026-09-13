# Page surface transparency

The page card showed a white rectangular canvas on GitHub in dark mode. Both the injected iframe element and its child root now declare `color-scheme: dark`, keeping their transparent backgrounds. The runtime change consists of those two property values.

`SPARK_PROOF_PHASE=baseline CHROME_PATH=<Chrome for Testing 151 executable> node scripts/surface-transparency-proof.mjs` reproduced the defect at base `ff1a8a322f45c62f6ce27388ab7e65a70b380897`. The unchanged proof with `SPARK_PROOF_PHASE=fixed` passed all six cases. [The receipt](surface-transparency.json) retains the baseline failures, source hashes, pixel measurements and screenshot hashes.

Four controlled cases combine light/dark host CSS with light/dark preferred schemes. The hosts include `<meta name="color-scheme" content="light dark">`. Two further cases use the actual public repository page, `https://github.com/MikeSchirtzinger/spark`, in light and dark preferences. The proof invokes the real capture hotkey in its own fresh headless Chrome profile. The controlled cases also assert local persistence, unchanged textarea focus, no native notification and automatic dismissal.

Measured by `node scripts/surface-transparency-proof.mjs`, GitHub capture follows `Page.bringToFront`; the screenshot is taken 600 ms after the host exists. The card measures 380 by 167 CSS pixels. In the dark case, the baseline corner pixel differences reach 252 channel levels; the fixed result is at most 1. All fixed cases remain within the 16-level tolerance for the existing shadow. Screenshots were visually inspected. Reduced motion is enabled for both baseline and fixed runs.

`npm run verify` passed TypeScript, all 39 tests, the build, validation of 362 installed model assets and the publication gate. `impeccable detect --json extension/surface.html extension/surface.css` returned no findings. This change does not modify audio, model, consent or attention policy. No audio or hosted provider rerun was performed. The prior audio integration limitation remains recorded in [the concept evidence](CONCEPT-UI.md).

[Independent read-only QA](surface-transparency-independent.json) passed on implementation head `e97065491a97ec16d2ced80739112a03305f4304`. Its receipt records three hosts, 27 corner and trailing-canvas pixel comparisons, private-surface denial and zero worker HTTP requests. All 25 source and bundle hashes stayed stable and still match after this evidence-only followup.

Local browser screenshots and raw reports remain in `.evidence/surface-transparency/baseline/` and `.evidence/surface-transparency/fixed/`. The proof uses its own profile and port 19334. Existing visible profiles were left untouched.
