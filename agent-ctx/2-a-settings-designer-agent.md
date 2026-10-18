# Task 2-a — Settings module UI + Document Template Designer (settings-designer-agent)

## Context read
- worklog.md (Tasks 1–18), agent-ctx/6-d, 7-a, 7-b; src/lib/template-schema.ts, settings-store.ts,
  refs.ts; APIs settings/doc-templates; shared lib (api, format, page-header); products.tsx +
  employees.tsx for module conventions.

## Files created
- `src/app/api/sequences/route.ts` — GET only, force-dynamic, {data}/{error} envelope.
  Returns `db.sequence.findMany({ orderBy: { key: 'asc' } })` → `[{ key, value }]`
  (value = last used number; UI displays value+1 as "Next number"). 500 handled with console.error.
- `src/components/erp/modules/settings.tsx` (~1620 lines) — default-exported client component,
  PageHeader "Settings" (lucide Settings icon) + 4 Tabs (TabsList scrollable on mobile via
  overflow-x-auto wrapper):
  1. **Company** — SETTING_META group 'company' rendered as Inputs/Textareas; logo handled
     specially: h-16 rounded border preview `<img>`, hidden file input (accept=image/*) behind an
     outline "Upload logo" Button → FileReader.readAsDataURL; rejects non-images and >400 KB with
     destructive toasts; "Remove" clears the data URL. Save = store.save(patch of changed keys) →
     toast "Settings saved"; button shows Loader2 + "Saving…" while pending; footer hint shows
     "N unsaved changes"/"All changes saved" (role=status).
  2. **Preferences** — two cards: "Sales defaults" (default VAT rate Input type=number step 0.1
     min 0 max 100 + payment terms Select) and "Localization" (currency + date format Selects).
     Same save pattern; client-side guard: VAT must parse to a number 0..100 else destructive toast.
  3. **Numbering** — GET /api/sequences (TanStack ['sequences']); Card with Table
     (Prefix (+friendly label map SEQ_LABELS) | Next number (value+1) | Example reference
     `${key}${yymm}-${pad4(value+1)}`, yymm computed CLIENT-side); max-h-96 scroll + sticky header;
     muted (non-blue) Info Alert explaining refs are auto-generated (prefix + YYMM + sequence,
     e.g. IN2601-0042) and read-only in v2.
  4. **Document templates (THE DESIGNER)** —
     - List (aside, lg:w-72) grouped by TEMPLATE_TYPE_LABELS; rows: name + Default badge (accent),
       star → PUT {isDefault:true}, copy → POST {name+' (copy)', type, isDefault:false,
       config: parsed}, Trash2 + AlertDialog (always allowed; copy explains print falls back to
       built-in default). "+ New template" Dialog (name + type Select) → POST {name,type}.
     - Derived selection (effectiveSelected = selectedId ?? default INVOICE ?? first) — deleted or
       stale ids fall back automatically, NO setState-in-effect anywhere (react-compiler lint
       clean).
     - `DesignerPanel` (keyed by template.id → remounts per selection, state inits via useState —
       no effects): header with name/type/dirty status + Revert (restores last-saved snapshot) +
       Save template (PUT /api/doc-templates/[id] { name, config } → invalidate + toast; name
       required). Designer: name Input; accent = native color input (h-10 w-14) + synced hex Input
       (local hexDraft while typing, commits on valid #rrggbb, blur re-syncs); paper size Select
       (A4/US Letter); title pattern Input + header/footer Textareas each with "Insert variable"
       DropdownMenu (Braces icon, outline sm) listing all placeholders grouped by
       DropdownMenuLabel (Company/Document/Customer/Payment) that INSERTS {{token}} at the caret
       (selectionStart/End, caret restored via rAF; fallback = append); "Available parameter fields"
       Collapsible with compact token/label/example table of all placeholders (scrollable);
       "Fields shown on document" card with 11 Switches bound to config.fields.
     - `PreviewPaper` — always-mounted live preview, xl: right column (grid
       xl:grid-cols-[1fr_36rem]), below on smaller, max-w-[560px], bg-white text-[12px] paper:
       company block from live settings store (logo shown when showLogo && logoDataUrl), resolved
       title in accent color, meta chips (ref/date/due/status) + payment terms + resolved
       headerNote, Bill-to block, 3 sample lines whose columns toggle per showDescription/Qty/
       UnitPrice/Discount/Vat, totals (Subtotal / Discount* / VAT* / TOTAL accent / Paid / Amount
       due), Notes block, resolved footerNote + bank details + signature line, rotated PAID stamp
       in accent when showPaidBadge. Single SAMPLE_VALUES record with coherent math
       (2×260 + 360 + 2×100 = 1080 subtotal, 20% VAT = 216, total 1296, paid 1296, due 0) merged
       with live company.* settings.

## Verification
- bunx eslint settings.tsx + sequences/route.ts → 0 problems (note: initial draft used
  setState-in-effect patterns which react-hooks v7 flags as errors; refactored to
  useState-initializer + keyed-remount + derived-selection patterns — zero useEffect setState).
- bunx tsc --noEmit → NO errors in my files. Pre-existing error remains in
  src/lib/template-schema.ts(122,14) `.default({})` (fields object) — Task 18 file, not touched
  per instructions; runtime behavior is correct (zod fills inner defaults; API seeding works).
  Suggested fix for orchestrator: replace `.default({})` with
  `.prefault({})` or `.default(() => ({} as z.infer<...>))`.
- curl: GET /api/sequences → 12 counters (CT5 CU11 ER3 IN15 PD15 PJ4 PO6 PR17 SI4 SO16 TK6 TS12);
  GET/PUT /api/settings roundtrip OK (temp company.name PUT → verified → restored to
  "DoliNext Demo Ltd"); PUT unknown key → 400 "Unknown setting keys: bogus.key";
  GET /api/doc-templates → 5 seeded templates.
- Bundler-level render check: temporary page src/app/tpl-compile-check/page.tsx (dynamic
  ssr:false import, mirrors erp-app pattern) → GET 200, compiled in ~1s, zero errors in dev.log;
  page DELETED after check (no residue). agent-browser (dedicated --session settings-agent):
  app loads, dashboard renders, 0 console errors. Module is NOT yet registered in erp-app.tsx —
  full UI E2E deferred to orchestrator per task instructions.
- No test data residue: settings restored, templates untouched (5 rows), sequences read-only,
  temp page removed.

## Notes for orchestrator
- Register the module in erp-app.tsx as `settings: dynamic(() => import('./modules/settings'),
  { ssr: false, loading: loadingFallback })` and add the nav entry (key `settings`).
- react-hooks v7 (React Compiler lint) is now ERROR-level for setState-in-effect — new modules
  should avoid effects that setState synchronously (use keyed remounts / derived state /
  useState initializers).
- Pre-existing TS error in src/lib/template-schema.ts line 122 (see above) — one-line fix.
