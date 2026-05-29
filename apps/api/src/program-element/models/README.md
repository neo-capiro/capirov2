# Program Element Models

## Conference Probability ML (v1)

`ConferenceProbabilityService` predicts conference mark outcomes when HASC/SASC exist but conference is not yet published.

### Model target

For each historical row (same service):

- `gap = sascMark - hascMark`
- `actualClosure = conference - hascMark`
- `closureRatio = actualClosure / gap` (rows with `gap = 0` are excluded from training)

### Features (v1)

Regression over closure ratio using:

- `gap_pct_of_request = gap / request`
- `sasc_higher` (directional feature; modeled as a per-direction bias)
- `service` (training set is filtered per service before fitting)

Implementation uses `simple-statistics` linear regression and residual standard deviation for CI.

### Prediction

For a target FY with HASC+SASC and no conference:

- `predictedClosureRatio = f(gap_pct_of_request, sasc_higher, service)`
- `predictedConference = hascMark + predictedClosureRatio * (sascMark - hascMark)`
- CI from residual stddev (`±1.96σ` on closure ratio, mapped to dollars)

### Confidence

Confidence is a bounded [0.10, 0.95] score derived from:

- sample size weight (`min(1, n/10)`)
- residual-noise penalty (`1 / (1 + 2σ)`)

Special case:
- `gap = 0` => `predicted = hasc = sasc`, zero-width CI, low confidence (0.10).

### Caching

Predictions are upserted into `conference_probability` on `(pe_code, fy)` with:

- `predicted`
- `ci_low`
- `ci_high`
- `confidence`
- `model_version`
- `computed_at`

### Batch recompute

Nightly recompute entrypoint:

- `apps/api/scripts/recompute-conference-probability.ts`
- npm script: `npm run recompute:conference-probability`

This scans all active rows where conference is still null and has both HASC+SASC.
