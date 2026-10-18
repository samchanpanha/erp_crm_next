# Task 7-a — Projects & Tasks + Timesheets

Agent: Projects module agent (Z.ai Code)
Status: COMPLETE

## Files owned (all written)
- `src/app/api/projects/route.ts` — GET list, POST create
- `src/app/api/projects/[id]/route.ts` — GET detail, PUT, DELETE (cascade)
- `src/app/api/tasks/route.ts` — GET list, POST create (nextRef('TS'))
- `src/app/api/tasks/[id]/route.ts` — GET, PUT, DELETE
- `src/app/api/tasks/[id]/time/route.ts` — GET entries desc, POST log time
- `src/components/erp/modules/projects.tsx` — full module (overwrote stub)

## Endpoint contracts
- `GET /api/projects?q=&status=&thirdPartyId=` → `{data: [Project + thirdParty{id,name,code} + tasks:[{status,progress}] (lightweight summaries for progress/done columns) + _count.tasks + loggedHours (Σ timeEntries.hours)]}` sorted createdAt desc.
- `POST /api/projects` `{title*, description?, thirdPartyId? (''/null → Internal), status?, startDate?, endDate?, budget?}` → 201; ref `PJyymm-####` via nextRef('PJ') with P2002 retry loop (5x).
- `GET /api/projects/:id` → `{data: Project + thirdParty + tasks:[...task, loggedHours, entriesCount]}` (tasks createdAt asc; hours/counts merged from ONE timeEntry.groupBy — no full entry payloads; entries fetched per task via `/api/tasks/:id/time`).
- `PUT /api/projects/:id` partial; `''` → null clears description/thirdPartyId/startDate/endDate; thirdPartyId validated (400 'Third party not found'); DELETE cascades tasks+timeEntries → `{data:{ok, deletedTasks}}`.
- `GET /api/tasks?projectId=&status=&priority=&q=` → `{data:[Task + project{id,ref,title} + loggedHours + entriesCount]}`.
- `POST /api/tasks` `{projectId* (400 'Project not found' if bad), label*, description?, status? (DONE ⇒ progress forced 100 server-side), priority?, progress? (clamped 0..100), plannedHours?, startDate?, endDate?}`; ref `TSyymm-####` w/ retry.
- `PUT /api/tasks/:id` partial; progress clamped 0..100; status DONE forces progress 100. `DELETE /api/tasks/:id` cascades entries.
- `GET /api/tasks/:id/time` → entries date desc, createdAt desc, incl. employee{id,firstName,lastName}|null. 404 if task missing.
- `POST /api/tasks/:id/time` `{employeeId? (''/null → unassigned; validated 400), date? (default now), hours* (>0, ≤24), note?}` → 201 incl. employee.
- All: `force-dynamic`, zod 400 (first issue message), 404s, 500 catch-all, `{data}/{error}`.

## UI (module 'projects')
- 4 StatCards: Active (OPEN), Total budget (Σ non-closed), Logged hours (Σ, exact in hint), Open tasks (TODO+IN_PROGRESS).
- Toolbar search (ref/title/desc/client) + status filter + New project. Table: Ref, Title+desc, Client ('Internal' fallback), Status, avg Progress bar, Tasks done/total, Budget, Dates (+relativeDays), actions Eye / Pencil(OPEN only) / Trash2+AlertDialog.
- Detail dialog (sm:max-w-3xl): meta boxes (budget, planned Σ, logged Σ w/ rose over-budget tone, tasks done/total), Suspend/Close/Reopen lifecycle buttons, tasks section `max-h-[60vh] overflow-y-auto`: per-task status Select (leaving DONE to TODO/IN_PROGRESS resets progress to 0), Progress bar + ±10 buttons + numeric input (blur/Enter commit, clamped), planned vs logged hours (rose when over), Log time dialog (employee Select from /api/employees w/ retry:false → degrades to Unassigned, date, hours, note), expandable entries list (date, employee, note, hours), delete task AlertDialog; Add task dialog (label*, description, priority, plannedHours, dates).
- Query keys: `['projects']`, `['project', id]`, `['task-time', taskId]`; reuses shared `['third-parties']`, `['employees']`. Helper `useInvalidateProjects()` invalidates all three module keys.

## Verified
- curl smoke: all endpoints + filters, zod 400s, 404s, bad employee/project 400, hours 0/30 rejected, DONE⇒100, clamp 250→100, '' clears dates, temp project full lifecycle (create → add tasks → log time → status changes → delete cascade) — DB restored to seed state (3 projects / 9 tasks / 18 entries / 85.5 h).
- Browser (agent-browser): table + badges + progress columns, edit hidden on SUSPENDED row, detail dialog all controls, status select, ±10 progress, log-time flow (POST landed, verified in DB, entry removed after), entries expansion, add task (TS ref generated), task delete AlertDialog, mobile 390px no horizontal overflow, no console errors from this module.
- `bunx eslint` clean on all 6 files; `bunx tsc --noEmit` no errors in src/.

## Notes for other agents
- Sequence table is already synced (PJ=4, TS=12 after smoke; retry loop guards anyway).
- Reuse `['projects']`/`['project']` keys if you need project pickers (e.g., agenda/invoice project links); each list row carries `loggedHours` and task summaries.
- Project delete is a hard cascade (tasks + time entries) — no doc-guard needed (no cross-module FKs from Proposal/SaleOrder/Invoice.projectId are enforced; they store bare scalars).
