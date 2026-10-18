# Task 6-d — Purchasing (Supplier Orders + Supplier Invoices)

Agent: purchase module agent (Task ID 6-d)
Date: 2026-10-18

## Files owned / written
- src/app/api/purchase-orders/route.ts (GET list ?q=&status=&thirdPartyId=, POST create DRAFT)
- src/app/api/purchase-orders/[id]/route.ts (GET one; PUT actions validate/cancel/receive or full DRAFT edit; DELETE DRAFT-only)
- src/app/api/supplier-invoices/route.ts (GET list ?q=&status=, POST create DRAFT)
- src/app/api/supplier-invoices/[id]/route.ts (GET one incl. payments; PUT actions validate/cancel or full DRAFT edit; DELETE DRAFT-only)
- src/components/erp/modules/purchase-orders.tsx (full module, overwrote stub)
- src/components/erp/modules/supplier-invoices.tsx (full module, overwrote stub)

## Key findings for later agents
1. **SupplierInvoice has NO Prisma relation to PurchaseOrder** (scalar `purchaseOrderId` only; schema frozen). Prisma `include: { purchaseOrder }` throws. Both SI routes merge PO refs manually so the JSON still contains `purchaseOrder: { id, ref } | null` per the contract.
2. **Sequence table is NOT synced with seed refs** (prisma/seed.ts uses a local counter + `sequence.deleteMany()` without re-creating rows). `nextRef('PO')` returned PO2610-0001 while seeded POs already used 0002–0004; `nextRef('SI')` can collide with seeded SI refs on first create. Both my POST routes retry on Prisma P2002 (each retry consumes the next sequence number, self-healing up to 25 attempts). RECOMMENDATION for orchestrator: after seeding, upsert Sequence rows with the consumed counters for every prefix.
3. **StockMovement.qty is Int** while PO line qty is Float → `receive` rounds qty via Math.round before creating movements / incrementing stockQty (documented in route).
4. `/api/bank` does not exist yet (404 at time of testing) — supplier-invoices UI queries it with `retry: false` and degrades to an empty bank-account list.
5. `/api/payments` (agent 6-c) landed and matches the contract: POST `{ supplierInvoiceId, amount>0, method, date?, reference?, note?, bankAccountId? }`; verified end-to-end (payment 400 on SI2610-0003 → status PARTIAL, paidAmount updated, visible in GET [id] payments desc).
6. Residue note: agent 6-c's smoke payment (amount 10, note 'smoke') remains applied to seeded SI2610-0002 → it shows PARTIAL/paid=10. Not touched by me.

## Verification done
- ESLint clean on all 4 files; `tsc --noEmit` clean for these files.
- Full curl smoke suite: list/detail/create/edit/validate/receive(+idempotent 400)/cancel guards/DELETE DRAFT-only/404s/400 validation.
- Receive transaction verified: movement IN qty 5 note 'Goods receipt' @ WH-MAIN + stockQty 12→17, then fully reverted in cleanup.
- Browser (agent-browser): both modules render with stats/table/dialogs; product prefill (costPrice+vat), live totals (4×38 −10% = 136.80 / VAT 27.36 / 164.16), receive AlertDialog, payment dialog (remaining prefilled, graceful empty bank list), linked-PO select shows RECEIVED orders. No console/page errors. All smoke docs deleted afterwards (POs back to 3 seeded, SIs 2 seeded, stock restored).
