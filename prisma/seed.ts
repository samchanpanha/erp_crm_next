/**
 * Seed script — realistic demo data for the Dolibarr-style ERP & CRM.
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ---------- helpers ----------
const now = new Date()
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000)
const daysAhead = (n: number) => new Date(now.getTime() + n * 86400000)
const pad = (n: number, l = 4) => String(n).padStart(l, '0')
const yy = String(now.getFullYear()).slice(2)
const mm = String(now.getMonth() + 1).padStart(2, '0')
let counters: Record<string, number> = {}
const ref = (prefix: string) => {
  counters[prefix] = (counters[prefix] ?? 0) + 1
  return `${prefix}${yy}${mm}-${pad(counters[prefix])}`
}

interface L { qty: number; unitPrice: number; discountPct?: number; vatRate?: number }
const lineTotal = (l: L) => l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100)
const totals = (lines: L[]) => {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0)
  const discountTotal = lines.reduce((s, l) => s + l.qty * l.unitPrice * ((l.discountPct ?? 0) / 100), 0)
  const vatTotal = lines.reduce((s, l) => s + lineTotal(l) * ((l.vatRate ?? 20) / 100), 0)
  return { subtotal: r2(subtotal), discountTotal: r2(discountTotal), vatTotal: r2(vatTotal), total: r2(subtotal + vatTotal) }
}
const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  console.log('Seeding DoliNext ERP & CRM...')
  await db.sequence.deleteMany()
  counters = {}
  await db.bankTransaction.deleteMany()
  await db.payment.deleteMany()
  await db.invoiceLine.deleteMany()
  await db.invoice.deleteMany()
  await db.saleOrderLine.deleteMany()
  await db.saleOrder.deleteMany()
  await db.proposalLine.deleteMany()
  await db.proposal.deleteMany()
  await db.purchaseOrderLine.deleteMany()
  await db.purchaseOrder.deleteMany()
  await db.supplierInvoice.deleteMany()
  await db.contract.deleteMany()
  await db.opportunity.deleteMany()
  await db.contact.deleteMany()
  await db.timeEntry.deleteMany()
  await db.task.deleteMany()
  await db.project.deleteMany()
  await db.ticketMessage.deleteMany()
  await db.ticket.deleteMany()
  await db.knowledgeArticle.deleteMany()
  await db.expenseLine.deleteMany()
  await db.expenseReport.deleteMany()
  await db.leaveRequest.deleteMany()
  await db.employee.deleteMany()
  await db.agendaEvent.deleteMany()
  await db.stockMovement.deleteMany()
  await db.warehouse.deleteMany()
  await db.product.deleteMany()
  await db.bankAccount.deleteMany()
  await db.thirdParty.deleteMany()

  // ---------- Third parties ----------
  const tpData = [
    { name: 'Acme Manufacturing', type: 'CUSTOMER', email: 'contact@acme-mfg.com', phone: '+1 555 010 2201', city: 'Chicago', country: 'USA', vatNumber: 'US-4412213', notes: 'Key account since 2021. Prefers NET30 payment terms.' },
    { name: 'Globex Corporation', type: 'PROSPECT', email: 'info@globexcorp.com', phone: '+1 555 010 3345', city: 'New York', country: 'USA', vatNumber: 'US-8890312', notes: 'Evaluating our offer vs competitor.' },
    { name: 'Initech Solutions', type: 'CUSTOMER', email: 'hello@initech.io', phone: '+1 555 010 4412', city: 'Austin', country: 'USA', city2: '', vatNumber: 'US-2213312' },
    { name: 'Umbrella Health Group', type: 'CUSTOMER_SUPPLIER', email: 'procurement@umbrellahealth.com', phone: '+1 555 010 5523', city: 'Boston', country: 'USA', vatNumber: 'US-9912001' },
    { name: 'Stark Industries', type: 'PROSPECT', email: 'sales@starkind.com', phone: '+1 555 010 6634', city: 'Los Angeles', country: 'USA' },
    { name: 'Wayne Logistics', type: 'SUPPLIER', email: 'orders@waynelogistics.com', phone: '+1 555 010 7745', city: 'Gotham', country: 'USA', vatNumber: 'US-5567890', notes: 'Primary hardware supplier.' },
    { name: 'Oceanic Freight Co.', type: 'SUPPLIER', email: 'ops@oceanicfreight.com', phone: '+61 2 5550 1200', city: 'Sydney', country: 'Australia' },
    { name: 'Hooli Cloud Services', type: 'CUSTOMER', email: 'ap@hooli.io', phone: '+1 555 010 8856', city: 'San Francisco', country: 'USA', vatNumber: 'US-7734567' },
  ] as const

  const tps: Record<string, { id: string; name: string }> = {}
  for (const t of tpData) {
    const created = await db.thirdParty.create({
      data: {
        code: ref('CU'), name: t.name, type: t.type, email: t.email, phone: t.phone,
        address: '100 Corporate Ave', zip: '10001', city: t.city, country: t.country,
        vatNumber: 'vatNumber' in t ? (t as { vatNumber?: string }).vatNumber : undefined,
        notes: 'notes' in t ? (t as { notes?: string }).notes : undefined,
        paymentTerms: t.type === 'SUPPLIER' ? 'NET15' : 'NET30',
      },
    })
    tps[t.name] = { id: created.id, name: created.name }
  }

  // Contacts
  await db.contact.createMany({ data: [
    { thirdPartyId: tps['Acme Manufacturing'].id, firstName: 'Sarah', lastName: 'Connor', position: 'Procurement Manager', email: 'sarah.connor@acme-mfg.com', phone: '+1 555 010 2202', isPrimary: true },
    { thirdPartyId: tps['Acme Manufacturing'].id, firstName: 'Miles', lastName: 'Dyson', position: 'CTO', email: 'miles.dyson@acme-mfg.com' },
    { thirdPartyId: tps['Globex Corporation'].id, firstName: 'Hank', lastName: 'Scorpio', position: 'CEO', email: 'hank@globexcorp.com', isPrimary: true },
    { thirdPartyId: tps['Initech Solutions'].id, firstName: 'Peter', lastName: 'Gibbons', position: 'Engineer', email: 'peter@initech.io', isPrimary: true },
    { thirdPartyId: tps['Wayne Logistics'].id, firstName: 'Lucius', lastName: 'Fox', position: 'Account Manager', email: 'lucius@waynelogistics.com', isPrimary: true },
    { thirdPartyId: tps['Hooli Cloud Services'].id, firstName: 'Jared', lastName: 'Dunn', position: 'COO', email: 'jared@hooli.io', isPrimary: true },
  ]})

  // ---------- Opportunities ----------
  await db.opportunity.createMany({ data: [
    { title: 'Acme — Annual hardware renewal', thirdPartyId: tps['Acme Manufacturing'].id, stage: 'NEGOTIATION', amount: 48500, probability: 70, expectedCloseDate: daysAhead(21) },
    { title: 'Globex — Pilot deployment (50 licenses)', thirdPartyId: tps['Globex Corporation'].id, stage: 'PROPOSAL', amount: 22000, probability: 45, expectedCloseDate: daysAhead(35) },
    { title: 'Stark Industries — R&D department suite', thirdPartyId: tps['Stark Industries'].id, stage: 'QUALIFIED', amount: 120000, probability: 25, expectedCloseDate: daysAhead(60) },
    { title: 'Hooli — Cloud migration package', thirdPartyId: tps['Hooli Cloud Services'].id, stage: 'WON', amount: 66000, probability: 100, expectedCloseDate: daysAgo(12) },
    { title: 'Umbrella — Support contract extension', thirdPartyId: tps['Umbrella Health Group'].id, stage: 'NEW', amount: 9500, probability: 15, expectedCloseDate: daysAhead(45) },
  ]})

  // ---------- Warehouses & Products ----------
  const whMain = await db.warehouse.create({ data: { code: 'WH-MAIN', name: 'Main Warehouse', address: '12 Industrial Park', city: 'Chicago', country: 'USA', isDefault: true } })
  const whWest = await db.warehouse.create({ data: { code: 'WH-WEST', name: 'West Coast Depot', address: '88 Harbor Rd', city: 'Los Angeles', country: 'USA' } })

  const productDefs = [
    { label: 'Industrial Sensor Unit IS-200', type: 'PRODUCT', sellPrice: 189, costPrice: 112, unit: 'unit', qty: 145, min: 40, description: 'Wireless industrial sensor, IP67 rated.' },
    { label: 'Controller Board CX-1', type: 'PRODUCT', sellPrice: 349, costPrice: 210, unit: 'unit', qty: 68, min: 25 },
    { label: 'Edge Gateway G4', type: 'PRODUCT', sellPrice: 899, costPrice: 640, unit: 'unit', qty: 22, min: 10, description: '4G/LTE edge computing gateway.' },
    { label: 'Cable Kit Pro (5m)', type: 'PRODUCT', sellPrice: 24.5, costPrice: 11, unit: 'kit', qty: 320, min: 80 },
    { label: 'Mounting Bracket MB-3', type: 'PRODUCT', sellPrice: 12.9, costPrice: 4.2, unit: 'unit', qty: 540, min: 100 },
    { label: 'Power Supply 24V 5A', type: 'PRODUCT', sellPrice: 45, costPrice: 22, unit: 'unit', qty: 96, min: 30 },
    { label: 'Rugged Tablet RT-8', type: 'PRODUCT', sellPrice: 1290, costPrice: 950, unit: 'unit', qty: 9, min: 8, description: '8-inch Android rugged tablet.' },
    { label: 'IoT Valve V-22', type: 'PRODUCT', sellPrice: 260, costPrice: 165, unit: 'unit', qty: 41, min: 15 },
    { label: 'Backup Battery Pack', type: 'PRODUCT', sellPrice: 79, costPrice: 38, unit: 'unit', qty: 12, min: 20, description: 'LiFePO4 20Ah battery pack.' },
    { label: 'Firmware License Key', type: 'SERVICE', sellPrice: 99, costPrice: 0, unit: 'license', stock: false },
    { label: 'Installation Service (on-site)', type: 'SERVICE', sellPrice: 650, costPrice: 0, unit: 'day', stock: false },
    { label: 'Premium Support (per year)', type: 'SERVICE', sellPrice: 2400, costPrice: 0, unit: 'year', stock: false },
    { label: 'Training Workshop', type: 'SERVICE', sellPrice: 1800, costPrice: 0, unit: 'session', stock: false },
  ] as const

  const products: Record<string, string> = {}
  for (const p of productDefs) {
    const created = await db.product.create({
      data: {
        ref: ref('PD'), label: p.label, type: p.type, description: 'description' in p ? p.description : undefined,
        sellPrice: p.sellPrice, costPrice: p.costPrice, unit: p.unit, manageStock: p.type === 'PRODUCT',
        stockQty: p.type === 'PRODUCT' ? p.qty : 0, minStock: 'min' in p ? p.min : 0,
        barcode: p.type === 'PRODUCT' ? `8901234${pad(Object.keys(products).length + 1, 5)}` : undefined,
      },
    })
    products[p.label] = created.id
    if (p.type === 'PRODUCT') {
      await db.stockMovement.create({ data: { productId: created.id, warehouseId: whMain.id, type: 'IN', qty: p.qty, reference: 'INITIAL', note: 'Initial stock', date: daysAgo(120) } })
    }
  }
  // a few extra movements for realism (net effect kept on top of initial)
  const sensorId = products['Industrial Sensor Unit IS-200']
  await db.stockMovement.create({ data: { productId: sensorId, warehouseId: whMain.id, type: 'IN', qty: 60, reference: ref('PO'), note: 'Restock from supplier', date: daysAgo(30) } })
  await db.product.update({ where: { id: sensorId }, data: { stockQty: { increment: 60 } } })
  const tabletId = products['Rugged Tablet RT-8']
  await db.stockMovement.create({ data: { productId: tabletId, warehouseId: whWest.id, type: 'OUT', qty: -3, reference: ref('SO'), note: 'Delivery to Hooli', date: daysAgo(9) } })
  await db.product.update({ where: { id: tabletId }, data: { stockQty: { decrement: 3 } } })

  // ---------- Proposals ----------
  const mkProposal = async (tp: string, status: string, dateA: number, lines: (L & { label: string })[], extra?: { validUntil?: Date; notes?: string }) => {
    const t = totals(lines)
    return db.proposal.create({ data: {
      ref: ref('PR'), thirdPartyId: tps[tp].id, status, date: daysAgo(dateA),
      validUntil: extra?.validUntil ?? daysAhead(30), notes: extra?.notes,
      ...t,
      lines: { create: lines.map((l, i) => ({ label: l.label, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0, vatRate: l.vatRate ?? 20, sort: i })) },
    }})
  }
  await mkProposal('Acme Manufacturing', 'ACCEPTED', 25, [
    { label: 'Edge Gateway G4', qty: 10, unitPrice: 899 },
    { label: 'Installation Service (on-site)', qty: 2, unitPrice: 650 },
    { label: 'Premium Support (per year)', qty: 1, unitPrice: 2400 },
  ], { notes: 'Signed by Sarah Connor.' })
  await mkProposal('Globex Corporation', 'VALIDATED', 8, [
    { label: 'Industrial Sensor Unit IS-200', qty: 80, unitPrice: 189, discountPct: 5 },
    { label: 'Cable Kit Pro (5m)', qty: 40, unitPrice: 24.5 },
  ], { notes: 'Pilot deployment for Building 7.' })
  await mkProposal('Stark Industries', 'VALIDATED', 3, [
    { label: 'Rugged Tablet RT-8', qty: 25, unitPrice: 1290, discountPct: 3 },
    { label: 'Training Workshop', qty: 2, unitPrice: 1800 },
  ])
  await mkProposal('Initech Solutions', 'DRAFT', 1, [
    { label: 'Controller Board CX-1', qty: 12, unitPrice: 349 },
  ])
  await mkProposal('Umbrella Health Group', 'REFUSED', 40, [
    { label: 'Premium Support (per year)', qty: 3, unitPrice: 2400 },
  ], { notes: 'Client chose a local provider.' })

  // ---------- Sale orders ----------
  const mkOrder = async (tp: string, status: string, dateA: number, lines: (L & { label: string })[]) => {
    const t = totals(lines)
    return db.saleOrder.create({ data: {
      ref: ref('SO'), thirdPartyId: tps[tp].id, status, date: daysAgo(dateA),
      deliveryDate: daysAhead(7), ...t,
      lines: { create: lines.map((l, i) => ({ label: l.label, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0, vatRate: l.vatRate ?? 20, sort: i })) },
    }})
  }
  const soHooli = await mkOrder('Hooli Cloud Services', 'DELIVERED', 15, [
    { label: 'Rugged Tablet RT-8', qty: 3, unitPrice: 1290 },
    { label: 'Cable Kit Pro (5m)', qty: 10, unitPrice: 24.5 },
  ])
  await mkOrder('Acme Manufacturing', 'BILLED', 22, [
    { label: 'Industrial Sensor Unit IS-200', qty: 50, unitPrice: 189, discountPct: 4 },
    { label: 'Installation Service (on-site)', qty: 1, unitPrice: 650 },
  ])
  await mkOrder('Initech Solutions', 'VALIDATED', 5, [
    { label: 'Power Supply 24V 5A', qty: 24, unitPrice: 45 },
    { label: 'Mounting Bracket MB-3', qty: 60, unitPrice: 12.9 },
  ])
  await mkOrder('Umbrella Health Group', 'DRAFT', 0, [
    { label: 'IoT Valve V-22', qty: 8, unitPrice: 260 },
  ])

  // ---------- Invoices + payments ----------
  const mkInvoice = async (tp: string, status: string, dateA: number, dueIn: number, lines: (L & { label: string })[], extra?: { saleOrderId?: string }) => {
    const t = totals(lines)
    const paidAmount = status === 'PAID' ? t.total : status === 'PARTIAL' ? r2(t.total * 0.4) : 0
    return db.invoice.create({ data: {
      ref: ref('IN'), thirdPartyId: tps[tp].id, status, date: daysAgo(dateA), dueDate: daysAgo(dateA - dueIn),
      paidAmount, saleOrderId: extra?.saleOrderId, ...t,
      lines: { create: lines.map((l, i) => ({ label: l.label, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0, vatRate: l.vatRate ?? 20, sort: i })) },
    }})
  }
  const invHooli = await mkInvoice('Hooli Cloud Services', 'PAID', 45, 30, [
    { label: 'Rugged Tablet RT-8', qty: 3, unitPrice: 1290 },
    { label: 'Cable Kit Pro (5m)', qty: 10, unitPrice: 24.5 },
  ], { saleOrderId: soHooli.id })
  const invAcme = await mkInvoice('Acme Manufacturing', 'PAID', 60, 30, [
    { label: 'Industrial Sensor Unit IS-200', qty: 30, unitPrice: 189 },
  ])
  await mkInvoice('Acme Manufacturing', 'PARTIAL', 18, 30, [
    { label: 'Controller Board CX-1', qty: 6, unitPrice: 349 },
    { label: 'Firmware License Key', qty: 6, unitPrice: 99 },
  ])
  await mkInvoice('Initech Solutions', 'UNPAID', 10, 20, [
    { label: 'Power Supply 24V 5A', qty: 24, unitPrice: 45 },
  ])
  await mkInvoice('Hooli Cloud Services', 'UNPAID', 4, 26, [
    { label: 'Premium Support (per year)', qty: 1, unitPrice: 2400 },
  ])
  await mkInvoice('Umbrella Health Group', 'DRAFT', 1, 30, [
    { label: 'IoT Valve V-22', qty: 8, unitPrice: 260 },
  ])

  // ---------- Bank accounts & transactions ----------
  const bankMain = await db.bankAccount.create({ data: { name: 'Main Operating Account', bank: 'First National Bank', accountNumber: '**** 4821', type: 'BANK', openingBalance: 50000 } })
  const bankCash = await db.bankAccount.create({ data: { name: 'Petty Cash', type: 'CASH', openingBalance: 1500 } })
  const txs: { accountId: string; date: Date; label: string; amount: number; category?: string; reference?: string }[] = [
    { accountId: bankMain.id, date: daysAgo(44), label: 'Customer payment — ' + invHooli.ref, amount: 4248.95, category: 'SALES', reference: invHooli.ref },
    { accountId: bankMain.id, date: daysAgo(52), label: 'Supplier bill — Wayne Logistics', amount: -8900, category: 'PURCHASES' },
    { accountId: bankMain.id, date: daysAgo(29), label: 'Customer payment — ' + invAcme.ref, amount: 6803.88, category: 'SALES', reference: invAcme.ref },
    { accountId: bankMain.id, date: daysAgo(25), label: 'Office rent', amount: -3200, category: 'EXPENSES' },
    { accountId: bankMain.id, date: daysAgo(20), label: 'Payroll — October', amount: -21500, category: 'SALARIES' },
    { accountId: bankMain.id, date: daysAgo(14), label: 'Customer payment — Acme (partial)', amount: 1430.26, category: 'SALES' },
    { accountId: bankMain.id, date: daysAgo(7), label: 'Marketing — Q4 campaign', amount: -4600, category: 'EXPENSES' },
    { accountId: bankCash.id, date: daysAgo(12), label: 'Team lunch reimbursement', amount: -142.5, category: 'EXPENSES' },
  ]
  for (const tx of txs) await db.bankTransaction.create({ data: tx })
  for (const acc of [bankMain, bankCash]) {
    const sum = txs.filter(t => t.accountId === acc.id).reduce((s, t) => s + t.amount, 0)
    await db.bankAccount.update({ where: { id: acc.id }, data: { currentBalance: r2(acc.openingBalance + sum) } })
  }

  // ---------- Payments ----------
  await db.payment.create({ data: { amount: 4248.95, method: 'BANK_TRANSFER', date: daysAgo(44), reference: 'TRX-88231', invoiceId: invHooli.id, bankAccountId: bankMain.id, note: 'Full settlement' } })
  await db.payment.create({ data: { amount: 6803.88, method: 'BANK_TRANSFER', date: daysAgo(29), reference: 'TRX-88402', invoiceId: invAcme.id, bankAccountId: bankMain.id } })

  // ---------- Purchase orders ----------
  const mkPO = async (tp: string, status: string, dateA: number, lines: (L & { label: string })[]) => {
    const t = totals(lines)
    return db.purchaseOrder.create({ data: {
      ref: ref('PO'), thirdPartyId: tps[tp].id, status, date: daysAgo(dateA), expectedDate: daysAhead(10), ...t,
      lines: { create: lines.map((l, i) => ({ label: l.label, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0, vatRate: l.vatRate ?? 20, sort: i })) },
    }})
  }
  await mkPO('Wayne Logistics', 'RECEIVED', 20, [
    { label: 'Industrial Sensor Unit IS-200', qty: 60, unitPrice: 112 },
    { label: 'Mounting Bracket MB-3', qty: 200, unitPrice: 4.2 },
  ])
  await mkPO('Wayne Logistics', 'VALIDATED', 8, [
    { label: 'Backup Battery Pack', qty: 30, unitPrice: 38 },
  ])
  await mkPO('Oceanic Freight Co.', 'DRAFT', 2, [
    { label: 'Edge Gateway G4', qty: 10, unitPrice: 640 },
  ])

  // ---------- Supplier invoices ----------
  await db.supplierInvoice.create({ data: { ref: ref('SI'), thirdPartyId: tps['Wayne Logistics'].id, status: 'PAID', date: daysAgo(18), dueDate: daysAgo(3), subtotal: 7592, vatTotal: 1518.4, total: 9110.4, paidAmount: 9110.4, purchaseOrderId: (await db.purchaseOrder.findFirst({ where: { status: 'RECEIVED' } }))?.id } })
  await db.supplierInvoice.create({ data: { ref: ref('SI'), thirdPartyId: tps['Oceanic Freight Co.'].id, status: 'UNPAID', date: daysAgo(6), dueDate: daysAhead(9), subtotal: 2450, vatTotal: 490, total: 2940 } })

  // ---------- Contracts ----------
  await db.contract.create({ data: { ref: ref('CT'), thirdPartyId: tps['Acme Manufacturing'].id, label: 'Premium Support & Maintenance 2026', status: 'ACTIVE', startDate: daysAgo(90), endDate: daysAhead(275), amount: 24000, billingCycle: 'QUARTERLY' } })
  await db.contract.create({ data: { ref: ref('CT'), thirdPartyId: tps['Hooli Cloud Services'].id, label: 'Cloud hosting — dedicated nodes', status: 'ACTIVE', startDate: daysAgo(150), endDate: daysAhead(215), amount: 5400, billingCycle: 'MONTHLY' } })
  await db.contract.create({ data: { ref: ref('CT'), thirdPartyId: tps['Initech Solutions'].id, label: 'Legacy system maintenance', status: 'EXPIRED', startDate: daysAgo(500), endDate: daysAgo(135), amount: 9600, billingCycle: 'YEARLY' } })

  // ---------- Projects, tasks, time entries ----------
  const empsData = [
    { firstName: 'Alice', lastName: 'Martin', position: 'Project Manager', department: 'Operations', salary: 7200 },
    { firstName: 'Bruno', lastName: 'Chen', position: 'Field Engineer', department: 'Technical', salary: 5400 },
    { firstName: 'Chloe', lastName: 'Dubois', position: 'Accountant', department: 'Finance', salary: 4900 },
    { firstName: 'Diego', lastName: 'Ramirez', position: 'Support Specialist', department: 'Support', salary: 3800 },
  ]
  const emps: Record<string, string> = {}
  for (let i = 0; i < empsData.length; i++) {
    const e = await db.employee.create({ data: { ...empsData[i], employeeCode: `EM${pad(i + 1)}`, email: `${empsData[i].firstName.toLowerCase()}@donext.io`, hireDate: daysAgo(400 - i * 60) } })
    emps[empsData[i].firstName] = e.id
  }

  const mkProject = async (title: string, tp: string | null, status: string, budget: number, tasks: { label: string; status: string; priority: string; progress: number; planned: number }[]) => {
    const p = await db.project.create({ data: { ref: ref('PJ'), title, description: `${title} — customer delivery project.`, thirdPartyId: tp ? tps[tp].id : null, status, startDate: daysAgo(30), endDate: daysAhead(30), budget } })
    for (const t of tasks) {
      const task = await db.task.create({ data: { projectId: p.id, ref: ref('TS'), label: t.label, status: t.status, priority: t.priority, progress: t.progress, plannedHours: t.planned, startDate: daysAgo(25), endDate: daysAhead(14) } })
      await db.timeEntry.create({ data: { taskId: task.id, employeeId: emps.Bruno, date: daysAgo(10), hours: 6.5, note: 'On-site work' } })
      await db.timeEntry.create({ data: { taskId: task.id, employeeId: emps.Alice, date: daysAgo(6), hours: 3, note: 'Planning & coordination' } })
    }
    return p
  }
  await mkProject('Acme — Factory sensor rollout', 'Acme Manufacturing', 'OPEN', 85000, [
    { label: 'Site survey (Plant 1)', status: 'DONE', priority: 'HIGH', progress: 100, planned: 16 },
    { label: 'Install 40 sensor nodes', status: 'IN_PROGRESS', priority: 'URGENT', progress: 60, planned: 80 },
    { label: 'Gateway configuration', status: 'TODO', priority: 'HIGH', progress: 0, planned: 24 },
    { label: 'Final acceptance test', status: 'TODO', priority: 'MEDIUM', progress: 0, planned: 12 },
  ])
  await mkProject('Hooli — Datacenter migration', 'Hooli Cloud Services', 'OPEN', 120000, [
    { label: 'Inventory & audit', status: 'DONE', priority: 'HIGH', progress: 100, planned: 20 },
    { label: 'Network re-cabling', status: 'IN_PROGRESS', priority: 'MEDIUM', progress: 45, planned: 60 },
    { label: 'Migration dry-run', status: 'TODO', priority: 'HIGH', progress: 10, planned: 30 },
  ])
  await mkProject('Internal — ISO 9001 certification', null, 'SUSPENDED', 15000, [
    { label: 'Gap analysis', status: 'DONE', priority: 'MEDIUM', progress: 100, planned: 12 },
    { label: 'Document control setup', status: 'TODO', priority: 'LOW', progress: 0, planned: 20 },
  ])

  // ---------- Tickets ----------
  const mkTicket = async (subject: string, tp: string, status: string, priority: string, category: string, assignedTo: string | null, age: number, msgs: { author: string; content: string; isInternal?: boolean }[]) => {
    const t = await db.ticket.create({ data: { ref: ref('TK'), subject, thirdPartyId: tps[tp].id, status, priority, category, assignedTo, description: subject + ' — reported via customer portal.', createdAt: daysAgo(age), resolution: status === 'RESOLVED' || status === 'CLOSED' ? 'Fixed and confirmed by customer.' : undefined } })
    for (let i = 0; i < msgs.length; i++) {
      await db.ticketMessage.create({ data: { ticketId: t.id, ...msgs[i], createdAt: daysAgo(age - i) } })
    }
  }
  await mkTicket('Gateway loses connection every night', 'Hooli Cloud Services', 'IN_PROGRESS', 'HIGH', 'TECHNICAL', 'Bruno Chen', 3, [
    { author: 'Jared Dunn (customer)', content: 'The gateway in Building C drops at 2am daily.' },
    { author: 'Bruno Chen', content: 'Investigating — looks like DHCP lease renewal issue.', isInternal: true },
    { author: 'Bruno Chen', content: 'We identified a firmware bug, hotfix in progress.' },
  ])
  await mkTicket('Invoice copy for PO #4471', 'Acme Manufacturing', 'RESOLVED', 'LOW', 'BILLING', 'Chloe Dubois', 8, [
    { author: 'Sarah Connor (customer)', content: 'Could you resend the invoice for our records?' },
    { author: 'Chloe Dubois', content: 'Sent to sarah.connor@acme-mfg.com — closing this.' },
  ])
  await mkTicket('Quote request for 100 sensor units', 'Globex Corporation', 'NEW', 'MEDIUM', 'SALES', null, 1, [
    { author: 'Hank Scorpio (customer)', content: 'Interested in volume pricing for 100 units.' },
  ])
  await mkTicket('Dashboard shows stale data', 'Initech Solutions', 'ASSIGNED', 'MEDIUM', 'TECHNICAL', 'Diego Ramirez', 2, [
    { author: 'Peter Gibbons (customer)', content: 'Numbers on the dashboard are a day behind.' },
  ])
  await mkTicket('Onboarding session for new staff', 'Umbrella Health Group', 'CLOSED', 'LOW', 'OTHER', 'Diego Ramirez', 20, [
    { author: 'Umbrella Office (customer)', content: 'We need training for 5 new employees.' },
    { author: 'Diego Ramirez', content: 'Session completed on the 14th.' },
  ])

  // ---------- Knowledge base ----------
  await db.knowledgeArticle.createMany({ data: [
    { title: 'How to create a commercial proposal', category: 'Sales', status: 'PUBLISHED', content: '1. Open CRM & Sales → Proposals.\n2. Click "New Proposal" and pick the third party.\n3. Add line items from the product catalog.\n4. Validate the proposal to send it to the customer.\n\nTips: use the discount column for volume pricing; the proposal can be converted into a sale order once accepted.', views: 152 },
    { title: 'Stock movement types explained', category: 'Inventory', status: 'PUBLISHED', content: 'IN — increases stock (purchases, returns).\nOUT — decreases stock (sales, shipments).\nADJUST — inventory corrections after physical counts.\n\nProduct stock quantity is always the sum of its movements.', views: 98 },
    { title: 'Payment terms reference', category: 'Finance', status: 'PUBLISHED', content: 'ON_ORDER — payable immediately with the order.\nNET15 / NET30 / NET60 — net days after invoice date.\nDue dates are computed from the invoice date.', views: 76 },
    { title: 'Draft: year-end closing checklist', category: 'Finance', status: 'DRAFT', content: 'TODO: bank reconciliation, depreciation, VAT declaration, inventory count…', views: 3 },
  ]})

  // ---------- Leave & expenses ----------
  await db.leaveRequest.createMany({ data: [
    { employeeId: emps.Alice, type: 'PAID', startDate: daysAhead(12), endDate: daysAhead(19), days: 5, reason: 'Family vacation', status: 'APPROVED' },
    { employeeId: emps.Bruno, type: 'SICK', startDate: daysAgo(3), endDate: daysAgo(2), days: 2, reason: 'Flu', status: 'APPROVED' },
    { employeeId: emps.Diego, type: 'PAID', startDate: daysAhead(30), endDate: daysAhead(33), days: 4, reason: 'Personal', status: 'PENDING' },
    { employeeId: emps.Chloe, type: 'UNPAID', startDate: daysAgo(40), endDate: daysAgo(39), days: 2, status: 'REJECTED' },
  ]})

  const er1 = await db.expenseReport.create({ data: { ref: ref('ER'), employeeId: emps.Bruno, status: 'SUBMITTED', date: daysAgo(5), notes: 'Field trip — Chicago plants' } })
  await db.expenseLine.createMany({ data: [
    { reportId: er1.id, category: 'TRAVEL', date: daysAgo(9), amount: 320, note: 'Train tickets' },
    { reportId: er1.id, category: 'HOTEL', date: daysAgo(9), amount: 410, note: '2 nights' },
    { reportId: er1.id, category: 'MEAL', date: daysAgo(8), amount: 64.5, note: 'Client dinner' },
  ]})
  await db.expenseReport.update({ where: { id: er1.id }, data: { total: 794.5 } })
  const er2 = await db.expenseReport.create({ data: { ref: ref('ER'), employeeId: emps.Alice, status: 'PAID', date: daysAgo(25) } })
  await db.expenseLine.createMany({ data: [
    { reportId: er2.id, category: 'SUPPLIES', date: daysAgo(28), amount: 189.99, note: 'Printer + toner' },
    { reportId: er2.id, category: 'OTHER', date: daysAgo(27), amount: 75, note: 'Team building' },
  ]})
  await db.expenseReport.update({ where: { id: er2.id }, data: { total: 264.99 } })
  const er3 = await db.expenseReport.create({ data: { ref: ref('ER'), employeeId: emps.Diego, status: 'DRAFT', date: daysAgo(1) } })
  await db.expenseLine.createMany({ data: [
    { reportId: er3.id, category: 'MEAL', date: daysAgo(1), amount: 23.8, note: 'Lunch with prospect' },
  ]})
  await db.expenseReport.update({ where: { id: er3.id }, data: { total: 23.8 } })

  // ---------- Agenda ----------
  await db.agendaEvent.createMany({ data: [
    { title: 'Kick-off — Acme rollout', type: 'MEETING', start: daysAgo(20), end: daysAgo(20), location: 'On-site, Chicago', thirdPartyId: tps['Acme Manufacturing'].id, owner: 'Alice Martin' },
    { title: 'Call — Globex pilot follow-up', type: 'CALL', start: daysAhead(2), thirdPartyId: tps['Globex Corporation'].id, owner: 'Alice Martin', description: 'Discuss pilot pricing feedback.' },
    { title: 'Quarterly business review — Hooli', type: 'MEETING', start: daysAhead(5), thirdPartyId: tps['Hooli Cloud Services'].id, location: 'Video call', owner: 'Alice Martin' },
    { title: 'Send Q4 campaign reminder', type: 'REMINDER', start: daysAhead(1), owner: 'Alice Martin' },
    { title: 'Prepare Stark Industries demo', type: 'TASK', start: daysAhead(8), owner: 'Bruno Chen', description: 'Prepare rugged tablet demo kit.' },
    { title: 'Payroll cut-off', type: 'REMINDER', start: daysAhead(11), owner: 'Chloe Dubois' },
  ]})

  console.log('Seed complete ✔')
  console.log({ thirdParties: Object.keys(tps).length, products: Object.keys(products).length })
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())

// NOTE: after re-seeding, always run `bun scripts/sync-sequences.ts` to sync the
// Sequence table with the refs consumed above (prevents nextRef collisions).
