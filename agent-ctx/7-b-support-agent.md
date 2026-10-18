# Task 7-b — Support modules (Tickets + Knowledge Base)

Agent: Support module agent (Z.ai Code)
Date: 2026-10-18
Status: DONE — APIs + UI + smoke tests complete, seed state intact

## Files owned (touched nothing else)
- src/app/api/tickets/route.ts (GET list + POST create)
- src/app/api/tickets/[id]/route.ts (GET one + PUT + DELETE)
- src/app/api/tickets/[id]/messages/route.ts (POST message)
- src/app/api/knowledge/route.ts (GET list + POST create)
- src/app/api/knowledge/[id]/route.ts (GET one w/ view counter + PUT + DELETE)
- src/components/erp/modules/tickets.tsx (stub → full module)
- src/components/erp/modules/knowledge.tsx (stub → full module)

## Contracts (for other agents)
- GET /api/tickets?q=&status=&priority=&category=&thirdPartyId= → { data: Ticket[] }
  - include thirdParty {id,name,code} | null
  - SORT (documented choice): open first (NEW/ASSIGNED/IN_PROGRESS), then priority URGENT>HIGH>MEDIUM>LOW, then createdAt desc — done in JS (SQLite can't rank custom maps)
- POST /api/tickets {subject*, thirdPartyId?, contactId?, status?=NEW, priority?=MEDIUM, category?, assignedTo?, description?} → 201; ref via nextRef('TK') + P2002 retry (5x); bad thirdPartyId → 400
- GET /api/tickets/:id → ticket + messages orderBy createdAt **asc** + thirdParty; 404
- PUT /api/tickets/:id — partial; status transitions NEW→ASSIGNED→IN_PROGRESS→RESOLVED→CLOSED forward-skip OK, backwards 400 `Invalid status transition: X → Y`, CLOSED→IN_PROGRESS reopen allowed, same-status no-op allowed; {status:'RESOLVED', resolution} may be sent in one PUT; '' clears nullable fields (assignedTo/category/description/resolution/thirdPartyId/contactId)
- POST /api/tickets/:id/messages {author*, content*, isInternal?=false} → 201; 404 unknown ticket
- DELETE /api/tickets/:id → { ok: true }, messages cascade
- GET /api/knowledge?q=&status=&category= → updatedAt desc; q matches title+content
- POST /api/knowledge {title*, category?='General', content*, status?=DRAFT} → 201
- GET /api/knowledge/:id → **increments views** then returns updated article (list reads do NOT count views)
- PUT /api/knowledge/:id partial; DELETE → { ok: true }

## Query keys shared
- ['tickets'], ['ticket', id], ['knowledge'], ['knowledge-article', id], reuses ['third-parties'] for pickers, ['employees'] (read-only, degrades to [] until HR module ships its endpoint — tickets datalist falls back to plain text + assignees already used)

## Notes for orchestrator
- TK Sequence was already synced (=5); smoke test consumed one number → Sequence TK=6, next real ticket = TK2610-0007 (no collision risk)
- Smoke residues fully cleaned: temp ticket + 2 messages deleted, temp KB article deleted, one UI-test reply removed from seeded TK2610-0001, seeded article views restored to 152
- React-compiler lint rules bite: no setState-in-effect (reset dialog state in onOpenChange), avoid useMemo with optional-chained deps (plain code auto-memoizes)
- Radix "Missing Description/aria-describedby" console warnings on AlertDialogs are app-wide pre-existing pattern (same in other modules)
