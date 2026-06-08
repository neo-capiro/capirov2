# Golden sets — §22 accuracy measurement

These JSON files are the ground-truth samples the accuracy harness
(`scripts/measure-accuracy.ts` → `src/intelligence/metrics/accuracy-metrics.ts`)
replays against current DB state to compute the plan's **§22 accuracy targets**:

| Golden file                      | Metric                    | §22 target |
| -------------------------------- | ------------------------- | ---------- |
| `r1-identity.golden.json`        | PE identity accuracy      | ≥ 0.99     |
| `r1-identity.golden.json`        | Funding-value accuracy    | ≥ 0.99     |
| `program-match.golden.json`      | PE→program precision      | ≥ 0.95     |
| `person-role.golden.json`        | Person→role precision     | ≥ 0.97     |
| `delta-classification.golden.json` | Delta classification    | ≥ 0.98     |

## ⚠️ These are SYNTHETIC placeholders — NOT human-verified

Every file carries a top-level `"_note"` saying so. They exist ONLY so the harness
runs end-to-end and emits the §22 metric table in development. **A real accuracy
number requires a human-curated sample verified against the source PDFs.** Do not
quote a number produced from these files as a "verified" accuracy figure.

## Curation procedure (how to produce a real, trustworthy set)

The principle: **sample programmatically, verify by hand against the primary source,
then freeze.** Sampling by hand biases toward familiar/easy rows and inflates the
metric.

### 1. Sample programmatically (random, reproducible)

Pick the rows with a fixed seed so the sample is reproducible and auditable, e.g.:

```sql
-- 100 random R-1 rows (PE identity + funding)
SELECT pe_code, title FROM program_element
WHERE retired_at IS NULL
ORDER BY md5(pe_code || '<seed>') LIMIT 100;

-- 25 accepted + 25 rejected program matches
(SELECT id FROM pe_program_match WHERE status='accepted' ORDER BY md5(id || '<seed>') LIMIT 25)
UNION ALL
(SELECT id FROM pe_program_match WHERE status='rejected' ORDER BY md5(id || '<seed>') LIMIT 25);
```

Record the seed and the sampling query in the file (a `_sampling` block) so anyone
can re-derive the exact sample.

### 2. Verify each row against the PRIMARY source — by a human

- **R-1 identity / funding**: open the J-book / R-1 PDF at the cited page and confirm
  the `peCode`, `title`, and BY `amount` ($ MILLIONS) char-for-char. Record the
  `sourcePage`. The funding tolerance the harness uses is
  `FUNDING_TOLERANCE_M` ($0.001M); set a per-set override if the source rounds
  differently.
- **Program / person-role matches**: an analyst opens the match in the resolution
  console, reads the evidence, and records `correct: true|false`. (The plan's
  "export tool provided" is this console export.)
- **Delta classification**: open the two source rows that produced the delta and
  confirm the `deltaType` is the right classification.

### 3. Freeze

Commit the verified rows, replacing the synthetic ones, and DELETE the `"_note"`
synthetic warning (or change it to a provenance note: who verified, when, against
which document revision). Re-run `pnpm --filter @capiro/api measure:accuracy` and
paste the resulting §22 table into the step's report.

## Schema per file

Each file is `{ "_note", "_schema", "rows": [...] }`. The `_schema` string documents
the row shape and how `id` joins to live data. The harness reads `rows`; everything
else is provenance/metadata for humans.
