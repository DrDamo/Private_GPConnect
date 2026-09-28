# Private GP Connect — notes for Claude

- A simulated middleware. Nothing may call a real NHS service; all data is synthetic.
  Keep the "SIMULATION" banner and the `x-simulation` header.
- `packages/gpc-fhir/src/{fhir,builder}` and `fixtures/` are copied verbatim from
  GP-Connect-Demo. Don't edit them in place: add new files instead, and record any
  unavoidable change in `packages/gpc-fhir/PROVENANCE.md`. Never push to GP-Connect-Demo.
- Don't use NHS identity branding (logos, NHS blue). This is not an NHS service.
- Run `npm run check` before committing, and `npm run build` if you've touched the
  build or deploy files.
