# Task 2-b — import-export-agent

## What was built
CSV import & export with downloadable templates for Third Parties and Products:
server-validated import (dry-run capable), server-generated CSV export, shared UI
(Export/Import toolbar buttons + 3-step import wizard dialog).

## Files
- CREATED `src/app/api/import/[entity]/route.ts` — POST bulk import
- CREATED `src/app/api/export/[entity]/route.ts` — GET CSV export
- CREATED `src/components/erp/shared/import-export.tsx` — `ImportExportButtons` ('use client', named export)
- MODIFIED `src/components/erp/modules/third-parties.tsx` — 2 surgical edits (import + actions fragment)
- MODIFIED `src/components/erp/modules/products.tsx` — 2 surgical edits (import + actions fragment)

## API contracts
- `POST /api/import/third-parties | products` body `{ rows: Record<string,string>[] (≤5000), dryRun?: boolean (default false) }`
  → `{ data: { imported, updated, skipped, errors: {row, message}[] } }`; errors capped at 50 + sentinel `{row:0, message:"…and N more"}`;
  400 invalid body/>5000 rows; 404 unknown entity; per-row errors don't abort the batch.
  - `code` (TP) / `ref` (PD) = upsert key: present → update-if-exists else create-with-that-code
    (P2002 race falls back to update); empty → nextRef('CU'|'PD') + 30x P2002 retry (same helper as create APIs).
    Dry-run never consumes Sequence values and never writes.
  - TP: name required ≤200; type/status/paymentTerms enums w/ defaults CUSTOMER/ACTIVE/NET30; email basic-format
    ≤200; currency uppercase 3-letter default USD; phone50/website200/address300/zip20/city100/country100/vat50/notes2000
    ('' → null). Products: label required ≤200; PRODUCT|SERVICE; unit default 'unit' ≤50; sell/cost/vat numbers ≥0
    ("1,234.56" accepted, vat ≤100 default 20); stockQty/minStock int ≥0; SERVICE forces manageStock=false + qty 0;
    barcode ≤100; status default ACTIVE. manageStock accepts yes/no/true/false/1/0.
  - Product CREATE with stockQty>0 writes an INITIAL IN StockMovement (mirrors POST /api/products, default warehouse).
    Product UPDATE never touches stockQty (same rule as PUT /api/products/[id] — ledger stays consistent);
    minStock/manageStock are updated; !manageStock forces stockQty+minStock to 0.
- `GET /api/export/third-parties | products` → CSV (orderBy createdAt desc, take 10000) with the EXACT template
  headers; `Content-Type: text/csv; charset=utf-8`; `Content-Disposition: attachment; filename="third-parties-YYYYMMDD.csv"`;
  manageStock as yes/no. 404 for unknown entity. A UTF-8 BOM is prepended (Excel-safe; our parseCsv strips it on re-import).

## UI contract
`<ImportExportButtons entity="third-parties"|"products" queryKeysToInvalidate={string[][]} />` — outline Export anchor
(aria-label "Export CSV", `href=/api/export/{entity}` download) + Import button opening a max-w-2xl dialog
(content max-h-[70vh] scroll): Download template (client-side stringifyCsv + downloadTextFile, 2 realistic sample rows),
file input (FileReader → parseCsv → "N rows, M columns detected" + first-5-rows preview, destructive Alert on missing
required header, 400 KB client-side guard), dry-run Switch, primary button (disabled until parsed & headers OK),
results panel (emerald Alert "Imported X, updated Y" / dry-run wording + errors table max-h-40; row 0 sentinel shows "—").
Non-dry-run success invalidates queryKeysToInvalidate + toast (useToast convention, not sonner).

## Verified (all passing)
- eslint 0 issues on all 5 files; tsc: 0 errors in my files (pre-existing errors only in src/app/api/reports/top — another agent)
- curl: export header lines exact; dry-run imported:2 with zero DB writes (GET verified empty); real run imported:2;
  dup-code re-import → updated:1 (name+city changed); auto-code CU2610-0011 generated via nextRef; missing name →
  row error; bad email/currency → per-row errors; products: SERVICE forced manageStock=no/qty=0, "1,234.56"→1234.56,
  INITIAL movement created (1), product update kept stockQty=7 while updating label/price; "abc"/"-5" → row errors;
  error cap (55 bad rows → 50 + "…and 5 more"); 5001 rows → 400; bogus entity → 404 (import & export)
- Browser (dedicated --session import-agent, closed after): both modules show Export/Import left of the primary
  "New …" button; wizard renders; template download click OK; file upload → preview + "Import 1 row" enabled;
  dry-run → "Validation finished, 1 row would be created…No errors"; real import → "Import finished, Imported 1" +
  row visible in list without reload (invalidation works); Export link downloaded valid CSV incl. new row.
- DB restored: deleted all ZZTEST-* rows (3rd parties via prisma deleteMany, products cascade movements);
  final counts thirdParties 8 / products 13 = pre-task state. Sequence counters advanced by test creates (normal
  monotonic behavior, same as UI creates).

## Deviations / notes for next agents
- Server export prepends BOM (Excel UTF-8 compatibility) — not in spec but parseCsv strips it, round-trip is clean.
- Auto-ref retry loop uses 30 attempts for both entities (products create API uses 5); harmless, more robust for bulk.
- Row numbers in errors are 1-based DATA row indexes (matching the wizard preview), not file line numbers.
- Duplicate codes WITHIN one file = first creates, subsequent ones update (upsert semantics), no special error.
