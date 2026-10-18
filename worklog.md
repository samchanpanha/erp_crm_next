# Worklog — Dolibarr ERP & CRM Rebuild (Next.js 16)

## Project Goal
Clone the Dolibarr ERP & CRM system (https://www.dolibarr.org/#features) and rebuild it
step-by-step as a modern Next.js 16 + TypeScript + Prisma (SQLite) + shadcn/ui single-page app.
The user-visible route is ONLY `/` (SPA with hash-based module navigation under `#/`).

## Feature Scope (mapped from dolibarr.org features section)
- CRM & Sales: Third Parties (Prospects/Customers), Contacts, Opportunities, Commercial Proposals,
  Sale Orders, Contracts/Subscriptions
- Billing & Finance: Customer Invoices, Payments, Bank Accounts & Transactions
- Purchasing: Supplier Orders, Supplier Invoices
- Product & Stock: Products & Services catalog, Warehouses, Stock Movements
- Projects: Projects, Tasks, Timesheets (time entries)
- HR: Employees, Leave Requests, Expense Reports
- Support: Tickets (Help Desk), Knowledge Base
- Productivity: Agenda (calendar events)
- Dashboard with cross-module KPIs & charts
- (Scoped out of v1, noted as roadmap: CMS/Website, POS, Manufacturing/BOM, Emailing, Surveys, Recruitment, Membership, double-entry accounting ledger, API importer/exporter UI)

## Architecture
- SPA shell: `src/app/page.tsx` → `src/components/erp/erp-app.tsx` (client) with hash router (`#/dashboard`, `#/third-parties`, ...) + module registry loaded via next/dynamic
- API: Next.js route handlers under `src/app/api/**` (zod validated, `{ data }` / `{ error }` JSON)
- DB: Prisma + SQLite (`db/custom.db`), ref sequences via `Sequence` table, helpers in `src/lib/refs.ts` + `src/lib/doc-math.ts`
- State: TanStack Query v5; UI: shadcn/ui (New York) + lucide icons; primary color = Dolibarr orange

## Status
- [x] Feature analysis from dolibarr.org completed
- [ ] Foundation schema + seed
- [ ] Shell + dashboard
- [ ] Modules (parallel agents)
- [ ] Integration + verification

---
Task ID: 1-5
Agent: Main orchestrator (Z.ai Code)
Task: Foundation — schema, seed, shared lib, app shell, dashboard

Work Log:
- Fetched https://www.dolibarr.org/#features via page_reader; mapped all feature groups to modules
- Wrote prisma/schema.prisma: 25 models (ThirdParty, Contact, Opportunity, Product, Warehouse, StockMovement, Proposal(+Line), SaleOrder(+Line), Invoice(+Line), Payment, PurchaseOrder(+Line), SupplierInvoice, Contract, Project, Task, TimeEntry, Ticket(+Message), KnowledgeArticle, Employee, LeaveRequest, ExpenseReport(+Line), BankAccount, BankTransaction, AgendaEvent, Sequence). SQLite => statuses are Strings (enums unsupported), enforced via zod in APIs
- bun run db:push OK; prisma client generated
- prisma/seed.ts: 8 third parties, 6 contacts, 5 opportunities, 2 warehouses, 13 products/services, stock movements, 5 proposals, 4 sale orders, 6 invoices, 2 payments, 2 bank accounts + 8 transactions, 3 POs, 2 supplier invoices, 3 contracts, 3 projects + 10 tasks + time entries, 4 employees, leaves, 3 expense reports, 5 tickets + messages, 4 KB articles, 6 agenda events. Ran OK
- Theme: primary set to Dolibarr orange (oklch 0.646 0.196 41.44) in globals.css
- Shared foundation:
  - src/lib/refs.ts (nextRef(prefix) -> e.g. PR2601-0001 via Sequence table)
  - src/lib/doc-math.ts (computeLineTotal/computeTotals/invoiceStatusFromPaid)
  - src/components/erp/lib/api.ts (fetchApi/get/post/put/del — {data}/{error} convention)
  - src/components/erp/lib/nav.ts (navigate(hash))
  - src/components/erp/shared/format.ts (formatMoney/formatDate/toDateInput/toDateTimeInput/relativeDays)
  - src/components/erp/shared/status-badge.tsx (StatusBadge + STATUS registry + DocStatusBadge + PriorityBadge)
  - src/components/erp/shared/stat-card.tsx (StatCard + formatMoneyCompact)
  - src/components/erp/shared/page-header.tsx (PageHeader + EmptyState)
- App shell: src/components/erp/erp-app.tsx — sidebar (9 module groups, 20 modules), topbar w/ module search + quick-create, hash router, next/dynamic module registry, sticky footer. src/app/page.tsx renders it; layout metadata updated
- Dashboard module + /api/dashboard aggregation (KPIs, 6-month revenue/purchases bars, invoice pie, unpaid/low-stock/agenda watchlists, recent invoices+tickets)
- Created stub modules for all 19 pending modules (agents will overwrite)
- Verified in agent-browser: page renders 200, dashboard shows live KPI data, no errors

Stage Summary:
- ARCHITECTURE: single-page ERP at / (hash routing), API route handlers per module, Prisma/SQLite
- API convention: GET list ?q=&status= → {data:[...]} with thirdParty/product includes; POST/PUT zod-validated; errors {error:string}; ref generation via nextRef(prefix)
- UI convention: modules = default-export client components in src/components/erp/modules/<key>.tsx using shared StatusBadge/DocStatusBadge/StatCard/PageHeader/EmptyState/format helpers; useToast from @/hooks/use-toast; TanStack Query; NO blue/indigo (primary = orange)
- Document math MUST use src/lib/doc-math.ts
---
Task ID: 6-a
Agent: CRM module agent (third parties / contacts / opportunities)
Task: CRM module — Third Parties + Contacts + Opportunities

Work Log:
- Read worklog + foundation code (api.ts, refs.ts, shared components, schema) to match conventions
- Built 6 API route handlers (all `force-dynamic`, zod-validated, {data}/{error} envelope):
  - GET /api/third-parties (?q=&type=&status=, _count of contacts/opportunities/proposals/saleOrders/invoices, createdAt desc)
  - POST /api/third-parties (code generated via nextRef('CU'); retry loop past P2002 collisions — seed hard-coded CU2610-000x while Sequence starts at 0)
  - GET /api/third-parties/:id (contacts sorted primary-first + full _count incl. contracts/POs/SI/tickets/projects/agenda)
  - PUT /api/third-parties/:id (partial update; '' → null clears nullable fields, omitted keys untouched)
  - DELETE /api/third-parties/:id (400 'Cannot delete: this third party has related documents' when proposals/saleOrders/invoices/contracts/POs/SIs exist; otherwise delete — contacts+opportunities cascade via schema)
  - GET /api/contacts (?thirdPartyId=&q=, primary first) · POST /api/contacts (isPrimary exclusivity in $transaction) · PUT /api/contacts/:id (partial, re-exclusive primary) · DELETE /api/contacts/:id
  - GET /api/opportunities (?stage=&thirdPartyId=&q= over title+thirdParty name, thirdParty {id,name,code} included) · POST (validates thirdPartyId exists) · PUT (partial — powers WON/LOST quick actions) · DELETE
- Smoke-tested every endpoint with curl incl. edge cases: 404s, zod 400s (bad email, probability>100, empty name), search case-insensitivity (SQLite LIKE is case-insensitive by default), doc-guard 400 on Acme, cascade delete of a temp TP's contact+opportunity; all temp records cleaned up
- Overwrote third-parties.tsx module: 4 StatCard type chips (Customer/Prospect/Supplier/All), search + type + status filters (client-side over one cached list), responsive table (Code, Name+email, Type badge CUSTOMER=success/PROSPECT=info/SUPPLIER=muted/CUSTOMER_SUPPLIER=neutral, City/Country, Phone, Terms, Docs count, Status, Eye/Pencil/Trash2), create/edit Dialog (all fields incl. address block, payment terms, notes), detail Dialog (badges, contact info grid, doc count boxes, contacts list with primary Star + inline add-contact form + per-contact delete), AlertDialog confirms for TP & contact deletes; server errors surfaced via toasts (e.g. doc-guard message)
- Overwrote opportunities.tsx module: pipeline summary = 6 clickable stage cards (count + amount, click filters) + highlighted orange "Weighted pipeline" card (Σ amount×probability/100, open stages only), search + stage filter, table (Title+notes, Third party+code, DocStatusBadge stage, Amount, probability Progress bar + %, expected close formatDate+relativeDays), quick Trophy (mark WON, probability 100) / XCircle (mark LOST, probability 0) actions on open deals, create/edit Dialog (title*, third party* Select fed by shared ['third-parties'] cache, stage, amount, probability 0-100, date, notes), AlertDialog delete confirm
- Quality gates: bunx eslint on all 8 files → 0 issues; bunx tsc --noEmit → no errors in src/ (only pre-existing examples/skills noise); page + 3 list endpoints return 200; no blue/indigo classes; strict types, no `any`

Stage Summary:
- CRM endpoints live: /api/third-parties(/:id), /api/contacts(/:id), /api/opportunities(/:id) with q/type/status/stage/thirdPartyId filters, server-generated CU refs, doc-guard delete, contact isPrimary exclusivity
- Modules 'third-parties' and 'opportunities' are now fully interactive (CRUD + pipeline quick-actions) and share the ['third-parties'] query cache between modules
- NOTE for other agents: seed hard-codes document refs while Sequence table starts at 0 → first POST of any ref-generating resource will collide; third-parties handles it with a bounded retry loop (pattern reusable elsewhere); POST /api/opportunities requires a real thirdPartyId (400 'Third party not found' otherwise)

---
Task ID: 6-b
Agent: Products & Stock agent (Z.ai Code)
Task: Products & Services catalog + Stock & Warehouses

Work Log:
- Wrote src/app/api/products/route.ts: GET list (?q= ref/label, ?type=, ?status=, ?lowStock=1 JS-filtered since SQLite can't compare columns; sort createdAt/ref desc; include _count.stockMovements). POST creates with ref via nextRef('PD'), forces manageStock=false for SERVICE, records initial stockQty>0 as traceable IN movement (ref INITIAL, default warehouse). P2002 retry loop (5x) on ref generation because shared Sequence counter lags seeded refs
- Wrote src/app/api/products/[id]/route.ts: GET one (404), PUT (partial zod; stockQty NOT accepted — stock edits must go through /api/stock; SERVICE forces manageStock false + zeroes counters; minStock editable), DELETE (400 if productId referenced by proposalLine/saleOrderLine/invoiceLine/purchaseOrderLine, else cascades movements)
- Wrote src/app/api/warehouses/route.ts: GET list incl. _count.movements (sort isDefault desc, name asc, ?q=), POST (zod; isDefault handled in tx clearing others; P2002 → 400 'code already exists')
- Wrote src/app/api/warehouses/[id]/route.ts: PUT (partial, default-transfer in tx, P2002 → 400), DELETE (400 'N stock movements recorded' if it holds movements, else 200)
- Wrote src/app/api/stock/route.ts: GET movements ?productId=&warehouseId=&type= incl. product{ref,label,unit}+warehouse{name,code}, orderBy date desc (take 500). POST business rules: product must exist (404) and manageStock (400 'Services cannot have stock movements'); IN→+abs, OUT→-abs, ADJUST→as given; rejects qty 0 / non-int; rejects stockQty+signed<0 with 'Insufficient stock (available: N)'; creates movement + increments product.stockQty in $transaction; returns movement incl. product+warehouse
- DATA FIX: seed never populated the Sequence table (PD=2 while 13 products existed) → first POSTs would collide. Synced PD sequence to 13 via one-off script (no code files touched); nextRef retry loop added as permanent guard
- INCIDENT + RECOVERY: smoke-test DELETE removed seeded 'Industrial Sensor Unit IS-200' (seed lines are label-only, no productId, so the guard had nothing to block — guard verified separately by creating a temp proposalLine). Restored the product exactly per seed: PD2610-0001, barcode 890123400001, stockQty 205 (145+60), min 40, description, IN 145 'INITIAL' d-120 + IN 60 'PO2610-0001' d-30 movements. DB is back to seed-consistent state (13 products)
- Built src/components/erp/modules/products.tsx: 4 StatCards (Products, Services, Stock value Σqty×cost, Low stock w/ danger tone) computed over FULL catalog; Tabs All/Products/Services/Low stock (+count chip) + search; Card>Table with Ref, Label+desc, Type badge (PRODUCT=neutral/SERVICE=info), sell/cost, Margin % (emerald >20 / amber 0-20 / rose <0, '—' for services or zero cost/sell), VAT, Stock (qty+unit, rose LOW chip when ≤ min), DocStatusBadge, edit/delete actions; Create/Edit dialog (max-h-[70vh] scroll): label*, type (locked on edit), description, sellPrice*, costPrice, VAT select 0/5/10/20, unit, barcode, manageStock Switch (forced-off+disabled for SERVICE), initial stockQty+minStock on CREATE only (edit shows read-only stock + editable min), status; AlertDialog delete; TanStack Query + toasts + skeletons + EmptyState
- Built src/components/erp/modules/stock.tsx: warehouse cards (name, code, isDefault star, address, # movements, edit/delete); 'New warehouse' dialog (code*, name*, address, city, country, default switch); 3 summary StatCards (total qty, stock value, low stock); movements Card with sticky header + max-h-[60vh] scroll, filters (product/warehouse/type), columns Date, Product(label+ref), Warehouse(code+name), Type badge (IN=success/OUT=danger/ADJUST=warning), signed Qty (emerald +/rose −), Reference, Note; 'New movement' dialog: product select (manageStock only, shows current stock + min), type select with per-type qty hint, qty, warehouse (none allowed), reference, date, note; live 'new stock level' preview + inline rose 'Insufficient stock (available: N)' warning + submit disabled when invalid
- Verified via curl: all GET filters, product create/get/put(delete guard 400→200 after line removal), IN/OUT/ADJUST signing, insufficient-stock 400, zero-qty 400, service guard, warehouse duplicate-code 400, default transfer, delete-with-movements 400, temp WH delete 200
- Verified via agent-browser: products + stock modules render, UI create/delete product flow works (PD2610-0015 created then deleted), movement dialog OUT 500 shows warning + disabled submit, valid OUT -5 recorded and stock/tables updated; 0px horizontal overflow at 390px viewport; no console errors; bunx eslint clean on all 7 files; tsc --noEmit has no errors in owned files

Stage Summary:
- ENDPOINTS: /api/products (GET+POST), /api/products/[id] (GET+PUT+DELETE w/ doc-line guard), /api/warehouses (GET+POST), /api/warehouses/[id] (PUT+DELETE w/ movement guard), /api/stock (GET+POST w/ signing+insufficient-stock rules) — all {data}/{error}, force-dynamic, async params
- INVARIANT: product.stockQty only changes via POST /api/stock (plus initial qty on product create → auto 'INITIAL' movement); PUT /api/products silently ignores stockQty
- UI: modules 'products' and 'stock' fully replace stubs; queryKeys ['products'], ['warehouses'], ['stock-movements', productId, warehouseId, type] — other modules should invalidate ['products'] after line mutations that touch stock, and can reuse these GETs for product/warehouse pickers
- NOTE FOR OTHER AGENTS: Sequence table starts empty; refs of yymm equal to seed month collide — either sync the sequence for your prefix or catch P2002 (products route has a retry pattern to copy)
---
Task ID: 6-d
Agent: Purchasing module agent (Z.ai Code)
Task: Purchasing — Supplier Orders + Supplier Invoices

Work Log:
- Read worklog + schema + shared libs (refs/doc-math/api/format/status-badge/stat-card/page-header), confirmed module registry entries in erp-app.tsx
- API /api/purchase-orders: GET list (?q=&status=&thirdPartyId=, thirdParty{id,name,code} + _count.lines, date desc); GET [id] (lines sort asc + thirdParty); POST (zod, ≥1 line, supplier verified, totals via computeTotals, ref nextRef('PO'), status DRAFT); PUT [id] actions validate (DRAFT→VALIDATED), cancel (blocked from RECEIVED/BILLED), receive (VALIDATED→RECEIVED only — idempotent guard; $transaction creates StockMovement IN per managed-product line, warehouse = isDefault else first, note 'Goods receipt', reference = po.ref, increments product.stockQty), full edit DRAFT-only (deleteMany lines + recreate, recompute); DELETE DRAFT-only
- API /api/supplier-invoices: GET list (?q=&status=, thirdParty + purchaseOrder{ref}); GET [id] (payments desc + thirdParty + PO); POST (total = round2(subtotal+vatTotal) server-side, status DRAFT, ref nextRef('SI')); PUT actions validate (DRAFT→UNPAID), cancel (blocked from PAID/CANCELLED), full edit DRAFT-only (recompute); DELETE DRAFT-only
- DEVIATION A: SupplierInvoice↔PurchaseOrder has no Prisma relation (scalar only, schema frozen) → SI routes merge PO refs manually; JSON still matches contract (purchaseOrder:{id,ref}|null)
- DEVIATION B: seed doesn't sync Sequence table (seed used local counters; PO refs 0002-0004 + SI 0001-0002 pre-owned) → both POST routes retry ref generation on P2002 (each retry consumes next sequence no., self-heals); flagged for orchestrator to sync sequences post-seed
- Note: StockMovement.qty is Int → receive rounds fractional line qty (Math.round) before movement/stock increment
- UI purchase-orders.tsx: PageHeader + 3 StatCards (open VALIDATED count, received last 30d, Σ total non-cancelled), search + status filter, Card>Table (Ref/Date/Expected/Supplier+line count/Total/Status/actions), row actions (view, edit DRAFT, menu Validate/Receive/Cancel/Delete), receive via AlertDialog warning about stock IN movements, detail dialog (meta + lines + TotalsBox + context actions), create/edit dialog with local POLineEditor (product Select prefills label/costPrice/vatRate from /api/products?status=ACTIVE, editable qty/cost/disc%/vat%, live totals via computeTotals), suppliers from /api/third-parties filtered client-side to SUPPLIER/CUSTOMER_SUPPLIER; toast "Stock updated" after receive
- UI supplier-invoices.tsx: 3 StatCards (unpaid Σ total-paid UNPAID/PARTIAL, overdue count dueDate<now, total paid Σ paidAmount), table (Ref/Date/Due+rose Overdue chip/Supplier/PO ref/Total/Paid/Status/actions), Record payment dialog for UNPAID/PARTIAL posting /api/payments {supplierInvoiceId, amount prefilled remaining, method, date, reference, note, bankAccountId} with bank accounts from /api/bank (retry:false, degrades to empty list since endpoint 404s today), detail dialog with payments history, create/edit dialog (supplier*, date, dueDate, subtotal, vatTotal, linked PO Select from ?status=RECEIVED, live total = subtotal+vat), validate/cancel/delete DRAFT rules
- Payments integration verified live: agent 6-c's /api/payments exists & matches contract; POSTed 400 payment on a temp SI → PARTIAL + payments list correct
- Smoke-tested everything with curl (list/detail/create/edit/validate/receive + re-receive 400/cancel guards/DELETE DRAFT-only/404/400s), then fully cleaned up test docs + movements + stock (DB back to seed state; POs=3, SIs=2)
- Browser-verified both modules via agent-browser (stats, prefill, live totals 136.80/27.36/164.16, receive AlertDialog, payment dialog w/ graceful empty bank list, RECEIVED-only PO linker); no console errors; ESLint + tsc clean

Stage Summary:
- Purchasing module complete end-to-end: /api/purchase-orders(+[id]) and /api/supplier-invoices(+[id]) with zod validation, {data}/{error} convention, Next 16 async params
- Receive flow creates stock IN movements transactionally (default warehouse fallback, managed products only) and is guarded idempotent
- Supplier invoices link to RECEIVED POs and take payments through the shared /api/payments endpoint (agent 6-c) — statuses UNPAID/PARTIAL/PAID flow from paidAmount
- FOUNDATION BUG FLAGGED for orchestrator: prisma/seed.ts resets Sequence without re-syncing consumed counters → first nextRef() calls collide with seeded refs; my POSTs retry-and-skip, but other modules (IN/SO/PR/CU...) likely have the same latent issue; recommend seeding Sequence rows for every prefix
- Also note: 6-c smoke payment (amount 10) remains on seeded SI2610-0002 (now PARTIAL) — intentional residue of payments agent, left untouched
---
Task ID: 7-b
Agent: Support module agent (Z.ai Code)
Task: Tickets (Help Desk) + Knowledge Base

Work Log:
- Read worklog + foundation (schema Ticket/TicketMessage/KnowledgeArticle, refs.ts, shared badge/stat/format/api helpers, opportunities module + routes as convention reference); inspected DB: 5 seeded tickets (TK2610-0001..0005), 4 KB articles, Sequence TK=5 (already synced, no P2002 risk)
- API /api/tickets: GET list (?q= over subject+third-party name, ?status=, ?priority=, ?category=, ?thirdPartyId=; include thirdParty{id,name,code}); SORT documented choice = open tickets first (NEW/ASSIGNED/IN_PROGRESS) then priority rank URGENT>HIGH>MEDIUM>LOW then createdAt desc — custom ranking done in JS since SQLite can't sort by mapped enum; POST create (zod: subject*, optional nullable thirdPartyId verified → 400 'Third party not found', contactId, status/priority/category/assignedTo/description; ref nextRef('TK') with 5x P2002 retry guard copied from products/PO pattern)
- API /api/tickets/[id]: GET one (messages orderBy createdAt asc + thirdParty, 404); PUT partial (subject/status/priority/category/assignedTo/description/resolution/thirdPartyId/contactId; '' → null clears, omitted keys untouched; STATUS TRANSITIONS: forward NEW→ASSIGNED→IN_PROGRESS→RESOLVED→CLOSED with skipping allowed, never backwards → 400 'Invalid status transition: X → Y', single exception CLOSED→IN_PROGRESS reopen, same-status no-op allowed; RESOLVED may carry { resolution } in same PUT, resolution also editable standalone); DELETE (messages cascade)
- API /api/tickets/[id]/messages: POST {author*, content*, isInternal?=false} → 201, 404 unknown ticket
- API /api/knowledge: GET list (?q= title+content, ?status=, ?category= exact; updatedAt desc); POST (title*, category default 'General' (empty → General), content*, status DRAFT|PUBLISHED|ARCHIVED default DRAFT)
- API /api/knowledge/[id]: GET **increments views** (single update+increment returns updated article — list reads never count); PUT partial (title/category/content/status); DELETE
- UI tickets.tsx: 4 StatCards over full list (Open = NEW+ASSIGNED+IN_PROGRESS, Unassigned = open && !assignedTo, High & urgent = open HIGH/URGENT, Resolved (30d) = RESOLVED|CLOSED with updatedAt ≤30d); toolbar search + status/priority/category Selects; Card>Table overflow-x-auto (Ref mono, Subject+third party, Category StatusBadge SALES=neutral/BILLING=info/TECHNICAL=warning/OTHER=muted, PriorityBadge, DocStatusBadge, Assignee, Age relativeDays, Eye/Pencil/Trash2); create/edit Dialog max-h-[70vh] (subject*, third-party Select from shared ['third-parties'], category/priority Selects, assignedTo Input + datalist fed by /api/employees (graceful [] until HR endpoint exists) merged with assignees already used, description); large detail Dialog sm:max-w-3xl: header ref+badges+meta, description block, green resolution block, status stepper = current badge + buttons for allowed next statuses only (Reopen w/ RotateCcw for CLOSED→IN_PROGRESS), clicking Resolved reveals green resolution-notes Textarea + Confirm (PUTs {status:'RESOLVED', resolution}), assignee/category/priority quick-edit Selects (PUT, 'Unassigned'→''→null), scrollable message thread max-h-96 w/ custom scrollbar (internal messages amber left border + amber 'Internal' chip, auto-scroll to newest), reply form (author fixed 'Alice Martin — Support', internal Checkbox → POST messages); AlertDialog delete
- UI knowledge.tsx: 3 StatCards (Published, Drafts, Total views Σ); toolbar search + category Select (built from distinct data categories) + status Select; table (Title+first-line preview, category chip neutral, status badge PUBLISHED=success/DRAFT=muted/ARCHIVED=muted, Views, Updated+relativeDays, Read/Edit/Delete); Read dialog fetches GET [id] (server-side view increment) and shows title/category/status chips + views + whitespace-pre-wrap content; closing read invalidates list so views column refreshes; create/edit Dialog (title*, free-text category w/ datalist suggestions General/Sales/Inventory/Finance/HR/IT, content Textarea rows=8, status Select); AlertDialog delete
- Quality gates: bunx eslint on all 7 files → 0 issues (fixed react-compiler rules: removed setState-in-effect by resetting detail-dialog state in onOpenChange, replaced useMemo w/ optional-chained deps by plain auto-memoized code); bunx tsc --noEmit → clean in owned files; agent-browser (isolated session) verified both modules: stats 3/1/1/2 + sorted table, detail stepper shows only Resolved/Closed for IN_PROGRESS, resolution textarea flow, reply sent from UI landed in DB and thread updated, read dialog renders pre-wrap content and list total views 329→330 after close, create/edit dialogs prefill correctly; no console errors
- Smoke-tested all endpoints via fetch scripts: list filters + sort order, create (201, ref TK2610-0006, format TKyymm-####), 2 messages (1 internal) → detail asc order verified on seeded Hooli ticket too, transitions NEW→RESOLVED (skip) OK, RESOLVED→ASSIGNED 400, RESOLVED→CLOSED OK, CLOSED→NEW 400, reopen CLOSED→IN_PROGRESS OK, RESOLVED w/ resolution same PUT, same-status no-op, field edits + '' clears, bad enum 400s, empty-body 400, 404s, KB lifecycle (create/views 0→1→2/PUT/DELETE), KB seed views unchanged by list reads; all temp records deleted afterwards + one UI-test reply removed from seeded TK2610-0001 + article views restored → DB back to seed state (5 tickets/9 messages/4 articles, Sequence TK=6 as only harmless side effect)

Stage Summary:
- Support module live end-to-end: /api/tickets(+[id]+[id]/messages), /api/knowledge(+[id]) with {data}/{error}, force-dynamic, Next 16 async params, zod 400s, documented ticket status machine (forward-skip OK, backwards 400, CLOSED→IN_PROGRESS reopen) and server-side KB view counter on GET [id]
- Tickets list order = open-first by priority (URGENT>…>LOW) then createdAt desc (JS sort); modules use queryKeys ['tickets'], ['ticket', id], ['knowledge'], ['knowledge-article', id]; tickets reuse ['third-parties'] cache and probe ['employees'] defensively (empty until HR agent ships /api/employees)
- UI: modules 'tickets' and 'knowledge' fully replace stubs; orange-only palette, shared StatusBadge/DocStatusBadge/PriorityBadge/StatCard/PageHeader/EmptyState/format helpers, 44px touch targets, max-h-[70vh] dialogs, scrollable thread w/ custom scrollbar
- NOTE for other agents: React-compiler ESLint rules in this repo reject setState-in-effect and manual useMemo whose deps use optional chaining — reset dialog state in onOpenChange handlers and write plain (auto-memoized) derived code instead
---
Task ID: 7-d
Agent: Finance (Bank & Cash) / Contracts / Agenda agent (Z.ai Code)
Task: Bank & Cash + Contracts + Agenda

Work Log:
- Read worklog + schema + shared libs (api/format/status-badge/stat-card/page-header, refs.ts, doc-math round2); confirmed module registry keys bank/contracts/agenda in erp-app.tsx; studied /api/payments (6-c) so my bank UI displays its SALES/PURCHASES BankTransactions without duplicating that logic
- Built 8 API route handlers (all force-dynamic, zod-validated, {data}/{error}, Next 16 async params):
  - GET /api/bank → { accounts (with _count.transactions), recentTransactions (20 latest, account {id,name,type,currency} included), totals { bank, cash, overall } (round2) } — also serves as the bank-accounts picker source
  - /api/bank/accounts GET (list w/ counts) + POST (zod; currentBalance initialized = openingBalance; currency forced USD)
  - /api/bank/accounts/[id] GET (account + transactions desc take 500 + _count), PUT (partial; when openingBalance present, currentBalance recomputed in $transaction as newOpening + Σ transactions.amount; '' → null clears bank/accountNumber), DELETE (400 'Cannot delete: this account has N transaction(s)' when transactions exist — balance audit trail guard)
  - /api/bank/transactions GET (?accountId=&category=&q= over label+reference, date desc, account included) + POST ({accountId, date?, label, amount>0, direction IN|OUT, category?, reference?, reconciled?} → signed ±amount; $transaction creates tx + updates account.currentBalance; 404 unknown account)
  - /api/contracts GET (?q= over ref/label/thirdParty.name, ?status=&thirdPartyId=, createdAt desc, thirdParty {id,name,code}) + POST (thirdParty verified 404, status DRAFT, ref nextRef('CT') with 5x P2002 retry — seed pre-owns CT2610-0001..0003 while Sequence was empty; first create self-healed to CT2610-0004)
  - /api/contracts/[id] GET, PUT (either {action}: activate DRAFT→ACTIVE / expire ACTIVE→EXPIRED / cancel DRAFT|ACTIVE→CANCELLED with 400 state guards, or partial edit incl. '' → null endDate/notes; edit server-permissive any status, UI gates to DRAFT), DELETE (allowed any status per spec)
  - /api/agenda GET (?from=&to= on start, ?type=, default ALL sorted start asc, thirdParty included) + POST (title*, start*, end?, allDay, location, thirdPartyId verified 404, owner, description)
  - /api/agenda/[id] GET, PUT (partial; '' → null clears nullable fields; thirdParty verified), DELETE
- Built src/components/erp/modules/bank.tsx: 4 StatCards (Total/Bank/Cash balance isMoney from /api/bank totals, Transactions this month counted from full tx list); account cards row (name, bank·number, BANK=neutral/CASH=warning badge, big balance rose when negative, tx count, edit pencil; delete Trash2 rendered ONLY when _count.transactions===0 → AlertDialog); toolbar (search + account Select + category Select); transactions Card table with max-h-96 scroll + custom thin-scrollbar classes, sticky header, columns Date/Label/Account/Category (SALES=success PURCHASES=warning SALARIES=danger EXPENSES=muted TRANSFER=info OTHER=muted)/Reference/signed Amount (+emerald/−rose)/Reconciled; New transaction dialog (account Select*, IN/OUT segmented toggle buttons emerald/rose, amount* with live signed preview, date, label*, category Select w/ None, reference); New account dialog (name*, type, bank, accountNumber, openingBalance with recompute hint on edit, currency USD fixed/disabled). Reconciled is DISPLAY-ONLY (✓/○ icon, tooltip on column header) — I do not own a transactions/[id] route so no toggle; documented here for the orchestrator
- Built src/components/erp/modules/contracts.tsx: 4 StatCards (Active count, MRR = Σ ACTIVE normalized MONTHLY=amount QUARTERLY=/3 YEARLY=/12, Total value excl. CANCELLED, Expiring soon = ACTIVE endDate within 60d); toolbar (search + status filter); table Ref/Label+notes/Third party+code/Cycle badge (ONE_TIME=muted MONTHLY=info QUARTERLY=neutral YEARLY=warning)/Amount/Period (start→end + amber 'ends in N days' when expiring)/DocStatusBadge/actions (DRAFT: activate+edit+delete; ACTIVE: expire+cancel+delete; EXPIRED/CANCELLED: delete); create/edit dialog (thirdParty Select* from shared ['third-parties'] cache, label*, cycle, amount per period, startDate/endDate, notes); AlertDialog delete
- Built src/components/erp/modules/agenda.tsx: 4 StatCards (Today's events, This week next-7d, Calls scheduled upcoming CALLs, Unassigned owner warning tone); Upcoming section = event cards (date block day/month + relativeDays, DocStatusBadge type MEETING=info CALL=neutral TASK=warning REMINDER=muted OTHER=muted, title, timeRange or 'All day' chip, thirdParty/location/owner meta rows, description line-clamp, edit/delete); Past section = Collapsible 'Past events (N)' with compact table sorted desc; create/edit dialog (title*, type Select, allDay Switch that swaps datetime-local → date inputs, start*/end with 'End is before start' guard, location, owner, thirdParty Select optional, description)
- BUG FOUND+FIXED during UI smoke: zod optionalDate fields rejected explicit null (UI sends endDate:null / end:null when cleared) → 'expected string, received null' 400; added .nullable() to contracts endDate (both routes), agenda end (both routes), bank tx date; re-tested OK. Pattern note: in zod 4.3.5 `.optional()` accepts absent keys only — always add `.nullable()` when clients may send null
- Verified in browser (agent-browser, isolated session): all 3 modules render with live data, zero console/page errors; UI flows exercised: bank New-transaction dialog created +$250 (totals invalidated 24,283.09→24,533.09), contracts table shows correct per-status actions (Active→Expire/Cancel/Delete, Expired→Delete), agenda dialog created event end-to-end; past-events Collapsible expands with table
- Smoke-tested every endpoint with curl incl. guards: zod 400s (empty name, negative opening, amount<=0, bad direction, missing label/title, invalid dates), 404s (ghost account/contract/event/third party), transaction IN/OUT signing + balance math (1000→1200→1150), opening-balance recompute (opening 2000 → current 2150), delete-blocked-with-transactions 400, contract lifecycle activate/re-activate 400/expire/re-expire 400/cancel-expired 400, contract DELETE any status, agenda from/to/type filters + PUT partial clears; then cleaned ALL temp data via one-off bun/prisma script (scripts kept out of src/, deleted after use)
- Seed state verified intact at the end: 2 bank accounts (balances 24,283.09 / 1,357.50), 8 transactions, 3 contracts, 6 agenda events. CT Sequence now at 5 (consumed by retry-heal + temp docs — expected, see 6-a/6-b/6-d notes)
- Quality gates: bunx eslint on all 11 files → 0 issues; bunx tsc --noEmit → no errors in owned files (remaining src/ errors are in expenses.tsx owned by another agent); dev.log shows no errors from my routes; no blue/indigo classes; strict TS, no `any`

Stage Summary:
- ENDPOINTS: /api/bank (GET overview {accounts,recentTransactions,totals{bank,cash,overall}}), /api/bank/accounts (GET/POST), /api/bank/accounts/[id] (GET/PUT w/ opening-balance recompute/DELETE guarded), /api/bank/transactions (GET ?accountId=&category=&q= + POST signed w/ transactional balance update), /api/contracts (GET/POST w/ CT ref retry-heal), /api/contracts/[id] (GET/PUT edit+actions/DELETE any status), /api/agenda (GET ?from=&to=&type= default start asc/POST), /api/agenda/[id] (GET/PUT/DELETE)
- INVARIANTS: bank account currentBalance changes ONLY via POST /api/bank/transactions, PUT /api/bank/accounts/[id] (opening change), and /api/payments (6-c) — all three paths are consistent (balance = opening + Σ transactions); account DELETE blocked while transactions exist; contract edit is server-permissive but UI offers edit on DRAFT only; EXPIRED/CANCELLED contracts are terminal for actions but deletable
- Query keys: ['bank'] (overview — also invalidated by my mutations so 6-c payments UI stays fresh), ['bank-accounts'], ['bank-transactions'], ['contracts'], ['agenda'] — other modules should invalidate ['bank']/['bank-accounts'] after payment mutations
- INTEGRATION WARNING for orchestrator: supplier-invoices.tsx (agent 6-d, not my file) does get<BankAccountLite[]>('/api/bank') and bankAccounts.map(...) — /api/bank now returns {accounts,recentTransactions,totals}, so that module's Record-payment dialog bank picker WILL crash (.map on object); payments.tsx (6-c) is fine (normalizeList over 'accounts'). Recommend patching supplier-invoices.tsx line ~684 to normalize like payments.tsx does
- Reconciled toggling intentionally not implemented (no /api/bank/transactions/[id] route owned); column is display-only with tooltip — if needed later, add PUT/PATCH transactions/[id] with reconciled-only update
---
Task ID: 6-c-final
Agent: Sales-chain verification & cleanup agent (Z.ai Code)
Task: Sales chain verification, cleanup and bugfixes

Work Log:
- Read worklog (Tasks 1-5, 6-a, 6-b, 6-d) + all 9 owned files (proposals/sale-orders/invoices/payments APIs, line-editor, 4 modules) to re-establish context
- Lint/typing pass: bunx eslint over all 12 owned files (9 listed + 3 extra module files) → 0 issues; bunx tsc --noEmit → no errors in src/ (only pre-existing examples/skills noise); strict types, no `any`
- KEY FORENSIC FINDING before cleanup: prisma/seed.ts consumes ref SO2610-0001 via a stock-movement reference (line 152, `reference: ref('SO')` 'Delivery to Hooli') and PO2610-0001 likewise (line 149) → the seeded sale orders are actually SO2610-0002..0005 (4938 DELIVERED / 11666.4 BILLED / 2224.8 VALIDATED / 2496 DRAFT) and POs PO2610-0002..0004. The task brief's "seed = SO2610-0001..0004, delete SO2610-0005+" was based on a wrong assumption — deleting SO2610-0005+ would have destroyed the seeded Umbrella DRAFT order. Cleanup therefore keyed on the seed's actual refs, NOT "ref >= X". Verified via seed source + stock-movement references in DB
- Residue cleanup (one-off bun script, since removed): deleted 6 test payments (TX-TEST-1 ×2, BANK-TEST 200, no-ref 62.2 ×2, 10 on SI2610-0002), 5 test invoices IN2610-0007..0011 (payments cascade), 9 test sale orders (incl. a 'Test item' CANCELLED doc squatting on ref SO2610-0001 + SO2610-0006..0013), 6 test proposals PR2610-0006/0007/0009/0010/0012/0013 (lines cascade); restored SI2610-0002 → UNPAID/paid 0; verified IN2610-0001..0006 statuses/paidAmounts all intact (0001/0002 PAID full, 0003 PARTIAL 1290.24 = 40%, 0004/0005 UNPAID, 0006 DRAFT); deleted test BankTransaction 'Customer payment — IN2610-0011' (+200) and fixed Main Operating balance 24483.09 → 24283.09 (= 50000 opening + Σ 7 seeded txs); Petty Cash already OK
- Golden-path E2E (bun script hitting live :3000 API, 26 checks ALL PASSED): POST proposal (2 lines: 2×100 −10% VAT20 + 1×50 VAT10) → DRAFT w/ totals exactly per computeTotals (sub 230 / disc 20 / VAT 41 / total 271) → validate → VALIDATED → accept → ACCEPTED → convert_to_order → order VALIDATED, same totals, proposalId linked, proposal stays ACCEPTED → convert_to_invoice → invoice DRAFT same totals, saleOrderId linked, order → BILLED → validate invoice → UNPAID/0 → payment 100 (CARD, linked to Main bank) → PARTIAL/100 + BankTransaction + balance +100 → payment 171 → PAID/271 + balance +271 → post-cleanup counts back to seed
- Error cases verified: re-validate VALIDATED proposal → 400; validate already-VALIDATED converted order → 400; payment on DRAFT invoice → 400; overpay (999 > 171 remaining) → 400 'Payment exceeds remaining balance'; payment on PAID invoice → 400 'not open for payment'
- E2E chain wiped in reverse (bank txs removed + balance reverted −271, invoice→order→proposal deleted, cascades verified); DB re-verified to seed state; temp scripts removed from repo
- UI verification (agent-browser, isolated --session after discovering the DEFAULT session was being driven by a concurrent agent — that caused phantom navigations/dialog closes and a stale-session ChunkLoadError, both harness artifacts, not app bugs): #/proposals renders 5 seed rows w/ correct statuses; New proposal dialog → LineEditor product prefill (IoT Valve V-22 @260), live totals correct (qty2 → 520/104/624; +10% disc → 468/−52/93.60/561.60), add-line works, detail dialog (lines + meta), action menu ACCEPTED → Convert to sale order/Close; #/sale-orders renders 4 seed rows, VALIDATED detail shows Mark delivered/Create invoice, New dialog product prefill RT-8 @1290 → total 1548; #/invoices renders 6 seed rows (Draft/Unpaid/Partially paid/Paid), PARTIAL detail shows Remaining $1,935.36 + Record payment/Cancel, DRAFT menu = Validate (send)/Cancel invoice/Delete draft, PAID row has no mutating actions, row Record payment dialog prefills remaining; #/payments renders exactly the 2 seed payments (TRX-88402/TRX-88231) w/ invoice links, New payment dialog has Customer/Supplier tabs, customer picker lists exactly the 3 open invoices (0005/0004/0003) w/ remaining amounts, select prefills amount = '1935.36' (confirmed via DOM eval — an earlier '1935.35998…' reading was a float32 a11y-snapshot artifact), supplier picker lists exactly SI2610-0002 ($2,940 due, SI0001 PAID excluded), submit disabled until valid, payment details popover shows doc + status + Open invoice shortcut
- Console errors: 0 in a fresh session across all 4 modules (the one ChunkLoadError seen earlier was stale-cache fallout of the dev-server restart mid-session, gone on fresh load). NOTE: the system dev server died once during verification (curl 000, no listener); restarted via `bun run dev` (nohup, logging into dev.log) and it stayed healthy
- Final state re-verified: proposals=5, saleOrders=4, invoices=6, payments=2, POs=3, SIs=2, bankTransactions=8, agendaEvents=6 (untouched); bank balances consistent; SI2610-0001 PAID / SI2610-0002 UNPAID; eslint+tsc clean; dev server 200

Stage Summary:
- VERDICT: the 6-c sales chain (proposals → sale orders → invoices → payments APIs + UI + shared LineEditor) is CORRECT end-to-end: doc-math totals exact, status transitions guarded server-side, conversion copies lines/links docs, payments update paidAmount+status (+optional BankTransaction & bank balance), error paths all 400 with clear messages. NO code bugs found or needed fixing
- RESIDUE CLEANED: 6 payments, 5 invoices, 9 sale orders, 6 proposals, 1 bank tx removed; SI2610-0002 restored to UNPAID; Main bank balance corrected −200 → 24283.09; all sanity counts match seed
- IMPORTANT CORRECTION FOR ORCHESTRATOR: seeded refs are SO2610-0002..0005 and PO2610-0002..0004 (seed stock movements consumed SO/PO …-0001 as references). Any 'delete SO2610-0005+' or similar instructions elsewhere should be re-checked against this. Proposal refs PR2610-0001..0005 and invoice refs IN2610-0001..0006 match the brief
- Harness notes for future agents: (1) use `agent-browser --session <name>` — the default session may be shared by concurrent agents; (2) a stale-session ChunkLoadError after a dev-server restart is benign (fresh load is clean); (3) the system dev server can die — check `ss -tlnp | grep 3000` and restart with `nohup bun run dev >> dev.log 2>&1 &` if needed
---
Task ID: 7-a
Agent: Projects module agent (Z.ai Code)
Task: Projects & Tasks + Timesheets

Work Log:
- Read worklog + foundation libs (refs/api/format/status-badge/stat-card/page-header), schema (Project/Task/TimeEntry cascade rules), seed (3 projects PJ2610-0001..3, 9 tasks, 18 entries/85.5h, 4 employees); confirmed Sequence table already synced (PJ=3, TS=9) but kept the 5x P2002 retry loop as permanent guard
- Built 5 API route handlers (force-dynamic, zod, {data}/{error}, Next 16 async params):
  - GET /api/projects (?q=&status=&thirdPartyId=) — includes thirdParty{id,name,code}, lightweight task summaries [{status,progress}] for progress/done columns, _count.tasks, and loggedHours per project (Σ timeEntries.hours merged from ONE groupBy + task→project map, no entry payloads)
  - POST /api/projects — ref PJyymm-#### via nextRef('PJ') + retry; thirdPartyId validated ('' | null → Internal); nullable dates accept '' / yyyy-mm-dd / ISO, '' clears
  - GET /api/projects/[id] — full detail: tasks createdAt asc, each enriched with loggedHours + entriesCount from a single timeEntry.groupBy (documented shape; full entries fetched per-task via /api/tasks/[id]/time); PUT partial (thirdParty existence check, '' → null clears); DELETE hard cascade → {ok, deletedTasks}
  - GET /api/tasks (?projectId=&status=&priority=&q= incl. project{id,ref,title} + loggedHours/entriesCount); POST /api/tasks — projectId must exist (400), ref TSyymm-#### via nextRef('TS') + retry, status DONE ⇒ progress forced 100 server-side, progress clamped 0..100
  - PUT /api/tasks/[id] — partial; clamp progress; DONE ⇒ 100; GET one; DELETE cascades entries
  - GET /api/tasks/[id]/time — entries date desc + createdAt desc incl. employee{id,firstName,lastName}|null; POST — {employeeId? validated (''→unassigned), date? (default now), hours>0 ≤24, note?} → 201
- Overwrote projects.tsx (~1050 lines): 4 StatCards (Active OPEN count, Total budget Σ non-closed, Logged hours Σ w/ exact value in hint, Open tasks TODO+IN_PROGRESS); search (ref/title/desc/client) + status filter + New project; Card>Table (Ref, Title+desc snippet, Client w/ 'Internal' fallback, DocStatusBadge, avg progress Progress bar, Tasks done/total, Budget, Dates+relativeDays, actions Eye / Pencil only when OPEN / Trash2 + AlertDialog warning about cascade); create/edit dialog (title*, description, Client Select fed by shared ['third-parties'] with 'Internal' sentinel, status, dates, budget); large detail dialog: meta boxes (budget, planned Σ, logged Σ rose when over planned, done/total), Suspend/Close/Reopen lifecycle PUT buttons, Tasks section max-h-[60vh] scroll w/ Add task button; per-task row = ref + PriorityBadge + label/desc, status Select (leaving DONE to TODO/IN_PROGRESS resets progress 0; cancelled keeps), Progress bar + ±10 buttons (disabled at bounds) + numeric % input (commit on blur/Enter, clamped), planned vs logged hours (rose over), Log time dialog (employee Select from /api/employees retry:false degrading to Unassigned, date default today, hours required >0, note → POST + toast), expandable time-entries list (date, employee, note, hours; query ['task-time', taskId]), task delete AlertDialog; Add task dialog (label*, priority, plannedHours, dates, description → POST shows generated TS ref)
- Smoke-tested every endpoint with curl incl. temp project full lifecycle: zod 400s (no title/label, priority enum), bad project/thirdParty/employee 400s, hours 0/30 rejected, DONE forces 100, progress 250→clamped 100, '' clears endDate, DONE→TODO resets progress 0, entries desc order + employee join, task delete + project delete cascade (deletedTasks/entries reported); temp data fully cleaned, seed state intact (3/9/18, 85.5h)
- Browser-verified via agent-browser: table columns + badges, edit hidden on SUSPENDED project row, detail dialog meta/lifecycle/tasks, status Select change persisted, ±10 progress buttons, log-time dialog (4 employees loaded from /api/employees, POST landed — verified in DB, entry removed after), entries expansion, Add task (TS2610-xxxx generated) + delete, New project dialog fields; 0px horizontal overflow at 1280px and 390px; no console errors from this module; reverted manual Gateway task status/progress tweak to keep seed intact
- Quality gates: bunx eslint clean on all 6 owned files; bunx tsc --noEmit — no errors in src/ (only pre-existing examples/skills noise); no blue/indigo classes (orange primary, emerald/amber/rose accents)

Stage Summary:
- Projects & Tasks module complete end-to-end: /api/projects(+[id]), /api/tasks(+[id], +[id]/time) with server-side refs, DONE⇒progress 100 derivation, progress clamping, cascading deletes
- Efficient aggregation shape: list rows carry lightweight task summaries + per-project loggedHours; project detail carries per-task loggedHours/entriesCount via one groupBy; raw entries only via GET /api/tasks/[id]/time
- Query keys for reuse: ['projects'] (list w/ loggedHours + task summaries — good for project pickers/dashboard), ['project', id], ['task-time', taskId]; shared ['third-parties'] and ['employees'] caches consumed for selects
- NOTE for HR-dependent UIs: /api/employees now exists (id, firstName, lastName, position, _count...) — my Log time dialog consumes it with retry:false and degrades to 'Unassigned' if unavailable
---
Task ID: 7-c
Agent: HR module agent (Z.ai Code)
Task: HR — Employees + Leave Requests + Expense Reports

Work Log:
- Read worklog + foundation (schema, refs.ts, api.ts, shared components) and inspected seed HR state via one-off prisma script (4 employees EM0001-04, 4 leaves, 3 expense reports w/ 6 lines, ER Sequence=3 synced)
- Built 8 API route handlers (all force-dynamic, zod-validated, {data}/{error} envelope, Next 16 async params `Promise<{id}>`):
  - GET/POST /api/employees — list ?q=(name/code/email/position)&department=&status= incl. _count{leaveRequests,expenseReports,timeEntries}, createdAt desc; POST generates employeeCode 'EM' + zero-padded(count+1) with 30x P2002 uniqueness retry (handles gaps after deletes); salary coerce ≥0, nullable email/phone/position/department/hireDate
  - GET/PUT/DELETE /api/employees/[id] — GET one incl. counts; PUT partial (stripUndefined, ''→null clears); DELETE guarded 400 'Cannot delete: this employee has leave requests or expense reports' (protects schema-cascade of leaves+reports; timeEntries are SetNull so not blocking)
  - GET/POST /api/leave — list ?status=&employeeId=&type= incl. employee{id,firstName,lastName,employeeCode}; POST validates employee exists (400 'Employee not found'), endDate>=startDate (400), days auto = round2((end-start)/86400000 + 1) when absent
  - PUT/DELETE /api/leave/[id] — PUT body.action approve/reject (PENDING only else 400 'Only pending requests can be …'), cancel (PENDING or APPROVED — deviation from "PENDING only" noted), edit PENDING-only with merged-date validation + days recompute when dates change and days not sent; DELETE PENDING-only
  - GET/POST /api/expenses — list ?status=&employeeId=&q=(ref + employee name/code via Prisma relation filter) incl. employee + _count.lines, date desc; POST always DRAFT w/ ref nextRef('ER') + 30x P2002 retry (Sequence already synced to 3 so no collision today, kept as guard), employee existence check, date defaults now
  - GET/PUT/DELETE /api/expenses/[id] — GET incl. employee + lines(date asc); PUT body.action submit/approve/reject/mark_paid with TRANSITIONS map (DRAFT→SUBMITTED→APPROVED/REJECTED→PAID) + 'Cannot …: report is STATUS' 400s + submit blocked when 0 lines ('Cannot submit a report without expense lines'); PUT edit DRAFT-only (employeeId re-validated, date, notes); DELETE DRAFT-only
  - POST /api/expenses/[id]/lines — DRAFT-only (400 otherwise), category enum default TRAVEL, amount >0 required, $transaction creates line + recomputes report.total = round2(Σ lines.amount); returns { ...line, reportTotal }
  - DELETE /api/expenses/[id]/lines/[lineId] — DRAFT-only, verifies line belongs to report (404), $transaction delete + recompute; returns { ok, total }
- Built 3 UI modules (default-export client components, TanStack Query, useToast, skeletons, EmptyState, dialogs max-h-[70vh] scroll, AlertDialog deletes, ≥44px touch targets, no blue/indigo):
  - employees.tsx: 4 StatCards (Headcount ACTIVE w/ total hint, Monthly payroll Σ salary, Departments distinct, New hires last 90d); search + department filter (derived from data, datalist in form) + status filter + New employee; table Code/Name+email/Position/Department/Hire date/Salary/Status/actions (edit, delete w/ AlertDialog mentioning the linked-records guard); create/edit dialog firstName*/lastName*/email/phone/position/department/hireDate/salary/status
  - leave.tsx: 4 StatCards (Pending approvals warning-toned, Approved this month w/ startDate-in-month rule, Days taken YTD Σ approved, Rejected); status/type/employee filters + New request; table Employee+code/Type StatusBadge (PAID=info, SICK=danger, UNPAID=muted, OTHER=warning)/Dates start→end/Days/Reason snippet/DocStatusBadge/actions — approve ✓ + reject ✕ + edit + delete on PENDING rows, 'Locked' hint otherwise; create/edit dialog employee* (locked on edit)/type/start+end dates w/ min + live 'Duration: N day(s)' role=status hint (invalid range shows destructive text + disables submit)/reason
  - expenses.tsx: 4 StatCards (Awaiting approval count+Σ submitted, Approved-unpaid Σ, Paid this month Σ w/ report.date in month, Drafts); search (ref/employee) + status + employee filters + New report; table Ref/Date/Employee/Lines/Total/DocStatusBadge/actions Eye + edit+delete (DRAFT) + workflow DropdownMenu (Submit DRAFT / Approve+Reject SUBMITTED / Mark as paid APPROVED); detail dialog = header (ref, badge, employee, notes) + workflow buttons + lines table (category StatusBadge MEAL=warning/TRAVEL=info/HOTEL=neutral/SUPPLIES=muted/OTHER=muted, date, note, amount, per-line delete when DRAFT) + inline add-line form when DRAFT (category Select/date/amount/note → POST lines, toast + invalidate) + orange footer Total (server-recomputed, refetched); shared ACTIONS_BY_STATUS map drives both row menu and detail buttons; detail query ['expense', id] invalidated alongside ['expenses']
- Smoke-tested all endpoints via curl: filters (department/status/q on employees, status/type/employeeId on leave, status/employeeId/q incl. 'bruno'→ER2610-0001 and ref search), create EM0005, zod 400s (missing name, bad email), PUT employee, leave create + end<start 400 + edit-recompute (5→9 days after endDate change) + approve + re-approve 400 + edit-approved 400 + delete-approved 400 + cancel-approved OK, expense create ER2610-0004 + submit-empty 400 + 2 lines + amount≤0 400 + line delete recompute (55.75→42.5→55.75) + submit + add-line-after-submit 400 + edit-after-submit 400 + mark_paid-after-submit 400 + approve + reject-after-approve 400 + mark_paid + delete-paid 400 + delete-employee-with-records 400 + 404s
- Full UI verification in agent-browser (dedicated --session because the default session is contended by parallel agents): employees stats/filters/table/create dialog (EM0005 'Ui Tester' created + deleted via AlertDialog), leave module stats (Approved this month 2, YTD 7, Rejected 1) + create dialog (employee Select, auto Duration hint, 3-day request) + Approve ✓ button flips row to Approved/Locked, expenses create → detail → 2 lines via inline form (total recomputed live to $98.25) → Submit from detail header (add-form disappears, Approve/Reject appear) → Approve (Mark as paid appears) → row shows Approved; 0px horizontal overflow at 390px viewport; fixed Radix a11y warning by adding DialogTitle/DialogDescription to the detail-dialog loading branch; no page errors
- Cleanup: all smoke/UI temp records removed (temp employee + its leave + its report via prisma script, UI temp leave via prisma, UI temp report via prisma); ER Sequence restored to 3; DB verified back to seed state — 4 employees, 4 leaves, 3 expense reports, 6 lines
- Quality gates: bunx eslint on all 11 owned files → 0 issues; bunx tsc --noEmit → no errors in owned files (pre-existing src/app/api/bank/transactions/route.ts TS error belongs to another agent — untouched); GET page + 3 list endpoints 200; dev.log clean (no 500s)

Stage Summary:
- HR endpoints live: /api/employees(+[id]), /api/leave(+[id]), /api/expenses(+[id], +/[id]/lines, +/[id]/lines/[lineId]) — {data}/{error} convention, force-dynamic, Next 16 async params
- employeeCode EM#### auto (count+1 padded, retry on P2002); ER refs via nextRef('ER') with P2002 retry guard; expense totals ALWAYS recomputed server-side inside $transaction on line add/remove
- Workflow rules: leave approve/reject PENDING-only, cancel PENDING/APPROVED, edit/delete PENDING-only; expenses submit DRAFT→SUBMITTED (≥1 line required), approve/reject SUBMITTED, mark_paid APPROVED, edit/delete DRAFT-only; employees delete blocked while leaves/expenses exist
- Modules 'employees', 'leave', 'expenses' fully replace stubs; queryKeys ['employees'] (shared with leave/expenses pickers), ['leave-requests'], ['expenses'], ['expense', id]; leave GET supports ?employeeId= for future cross-module widgets (e.g. dashboard)
- Deviation: employee DELETE has a 400 guard (not in spec) to prevent silent cascade of leave/expense data; leave 'cancel' allowed from APPROVED (spec listed cancel without a rule); POST /api/expenses/[id]/lines returns extra reportTotal field for convenience
- NOTE: default agent-browser session is shared between parallel agents — use --session <name>; constant Fast Refresh rebuilds from concurrent edits can reset SPA state mid-test (caused a false-negative on date-input fills, resolved atomically via React __reactProps onChange dispatch)

---
Task ID: 14-16
Agent: Main orchestrator (Z.ai Code)
Task: Integration, lint, fixes and end-to-end browser verification

Work Log:
- Fixed cross-module integration bug: supplier-invoices.tsx expected /api/bank to return a plain array; adapted it to the real {accounts,...} contract (graceful fallback kept)
- Ran scripts/sync-sequences.ts and appended a permanent note to seed.ts (Sequence table now ≥ max consumed ref per prefix: CU 8, PD 13, PR 13, SO 13, IN 11, PO 4, SI 2, CT 3, PJ 3, TS 9, TK 5, ER 3)
- Fixed Radix a11y error "DialogContent requires DialogTitle" in 4 loading branches: third-parties.tsx, projects.tsx, tickets.tsx, knowledge.tsx (sr-only titles + aria-busy)
- StatCard: mobile money values truncate → text-lg on mobile; formatMoneyCompact added ($200k style)
- Full-project `bun run lint` → clean; `bunx tsc --noEmit` → clean for all src/ (only pre-existing errors in bundled examples/ and skills/ reference folders)
- Smoke-tested all 24 API endpoints → all 200
- Browser verification (agent-browser): navigation sweep across all 20 modules — every module renders real data (no blank screens), zero page errors, zero console errors after fixes
- Golden path E2E in UI: invoices → Record payment on IN2610-0004 ($1,296, bank-linked) → invoice flipped Unpaid→Paid; bank balance 24,283.09→25,579.09; "Customer payment — IN2610-0004" transaction appears in Bank & Cash (cross-module consistency verified)
- Verified ticket reply flow (internal note posted to thread), project detail task board, third-party summary chips
- Responsive check at 390px: no horizontal overflow, hamburger nav works, 2-col KPI grid
- Footer: mt-auto sticky-bottom verified (footer bottom == viewport bottom on scroll; pushed naturally on long pages)

Stage Summary:
- FINAL STATE: complete Dolibarr-style ERP & CRM running at / (SPA, hash-routed)
- 20 modules: Dashboard, Third Parties, Opportunities, Proposals, Sale Orders, Contracts, Invoices, Payments, Bank & Cash, Supplier Orders, Supplier Invoices, Products & Services, Stock & Warehouses, Projects & Tasks, Employees, Leave Requests, Expense Reports, Tickets, Knowledge Base, Agenda
- 24 API endpoints, 25 Prisma models, seeded demo data
- Tech: Next.js 16 App Router, TypeScript strict, Prisma/SQLite, TanStack Query, shadcn/ui, recharts, zod; orange primary (no blue/indigo)
- Known scoped-out v1 items (roadmap): CMS/Website, POS, Manufacturing/BOM, Emailing, Surveys, Recruitment, Membership, double-entry ledger, import/export UI
