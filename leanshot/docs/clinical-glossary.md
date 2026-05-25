# LeanShot Clinical Glossary — EN/ES Term Pairs

> **NOTICE: Machine-generated ES translations.**
> Clinical accuracy has NOT yet been verified by a clinical advisor.
> All clinical rows are flagged `signoff-pending` for Phase 70 HUMAN-UAT review.
> Mistranslated dose/unit/site copy is a patient-harm vector (threat T-58-02).
> Numbers and measurement units (mg, mL, etc.) remain verbatim in all locales.

---

## How to Use This Glossary

When machine-translating `public/locales/en/*.json` keys that contain clinical terms, use the **ES term** in this table verbatim. Do NOT re-translate these terms independently — use the glossary entry as the canonical source. Flag any novel clinical term not in this table for Phase 70 review before committing.

**Invariant:** Numeric values and SI units (`mg`, `mL`, `kg`, `cm`, `kcal`) are NEVER translated — they appear identically in EN and ES strings. Only surrounding text and non-SI unit words are translated.

---

## Term Table

| EN term | ES term | Category | Signoff status |
|---------|---------|----------|----------------|
| Ozempic | Ozempic | medication | signoff-pending |
| Wegovy | Wegovy | medication | signoff-pending |
| Mounjaro | Mounjaro | medication | signoff-pending |
| Zepbound | Zepbound | medication | signoff-pending |
| semaglutide | semaglutida | medication | signoff-pending |
| tirzepatide | tirzepatida | medication | signoff-pending |
| mg | mg | dose-unit | signoff-pending |
| mL | mL | dose-unit | signoff-pending |
| units | unidades | dose-unit | signoff-pending |
| unit | unidad | dose-unit | signoff-pending |
| dose | dosis | dose-unit | signoff-pending |
| injection | inyección | dose-unit | signoff-pending |
| nausea | náuseas | symptom | signoff-pending |
| vomiting | vómitos | symptom | signoff-pending |
| diarrhea | diarrea | symptom | signoff-pending |
| constipation | estreñimiento | symptom | signoff-pending |
| fatigue | fatiga | symptom | signoff-pending |
| abdomen | abdomen | anatomical-site | signoff-pending |
| thigh | muslo | anatomical-site | signoff-pending |
| arm | brazo | anatomical-site | signoff-pending |
| weight | peso | safety-copy | signoff-pending |
| height | estatura | safety-copy | signoff-pending |
| body fat | grasa corporal | safety-copy | signoff-pending |
| calorie | caloría | safety-copy | signoff-pending |
| calories | calorías | safety-copy | signoff-pending |
| protein | proteína | safety-copy | signoff-pending |
| fiber | fibra | safety-copy | signoff-pending |
| water | agua | safety-copy | signoff-pending |
| blood glucose | glucosa en sangre | safety-copy | signoff-pending |
| blood pressure | presión arterial | safety-copy | signoff-pending |

---

## Phase 70 Clinical Advisor Signoff Requirements

All rows in this glossary are marked `signoff-pending`. Before Phase 70 HUMAN-UAT, a qualified clinical advisor must verify:

1. **Medication names** — Ozempic, Wegovy, Mounjaro, Zepbound trade names are identical across locales; semaglutida/tirzepatida are the INN generic equivalents used in Latin-American Spanish labeling.
2. **Dose units** — `mg`, `mL` are SI units and do not change. `units` → `unidades` is the accepted lay term for injection pen units.
3. **Symptom terms** — náuseas, vómitos, diarrea, estreñimiento, fatiga are standard Latin-American neutral Spanish medical terms. Advisor must confirm suitability for a lay patient audience.
4. **Anatomical sites** — abdomen (unchanged), muslo (thigh), brazo (arm) are anatomical terms; advisor must confirm clarity for self-injection instruction context.
5. **Safety copy** — peso, estatura, grasa corporal, caloría/s, proteína, fibra, agua must be consistent with the app's safe-harbor disclaimer wording.

**Escalation path:** Any term requiring change must be updated in both this glossary AND the corresponding `public/locales/es/*.json` entry, followed by re-running `npm run i18n:check` and CI push.
