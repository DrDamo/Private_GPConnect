# Provenance

The code in `src/fhir/`, `src/builder/` and `fixtures/` is copied from the
GP Connect Demonstrator. The upstream repository is **read-only** for this project:
we never push changes back to it.

| | |
|---|---|
| Upstream | https://github.com/DrDamo/GP-Connect-Demo |
| Commit | `b49223fc937074626b195231497498106c33acb1` (2026-09-25) |
| Copied on | 2026-09-28 |
| Data | All fixtures are dummy/synthetic data (confirmed by the upstream author) |

## File mapping

| Upstream | Here | Notes |
|---|---|---|
| `src/fhir/*.ts` | `src/fhir/` | Unchanged. **Excluded:** `snomedLookup.ts` and `snomedDegrade.ts`, which call the terminology proxy with `fetch` and `import.meta.env` and aren't needed for the mock |
| `src/builder/types.ts`, `idMap.ts`, `sampleData.ts` | `src/builder/` | Unchanged |
| `src/builder/generate/*.ts` | `src/builder/generate/` | Unchanged |
| `public/gpc-sample-bundle.json` | `fixtures/` | Unchanged |
| `src/sample-data/*.json` | `fixtures/` | Unchanged |

The files are kept byte-identical to upstream, which lets `scripts/sync-gpc-fhir.sh`
re-sync them and show a diff. Anything added locally goes in **new** files, such as
`src/index.ts` and `test/`, and never in the copied ones. If a copied file has to change,
list the change in this table.
