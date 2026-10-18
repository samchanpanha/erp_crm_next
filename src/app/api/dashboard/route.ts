import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await requireAuth()
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const tenant = user.tenantId
    const [
      thirdPartyCount, productCount, openProposalCount, openOrderCount,
      unpaidInvoices, paidThisYear, lowStockProducts, openTickets,
      pendingLeaves, activeProjects, bankAccounts, upcomingEvents,
      monthlySales, recentInvoices, recentTickets,
    ] = await Promise.all([
      db.thirdParty.count({ where: { tenantId: tenant } }),
      db.product.count({ where: { tenantId: tenant } }),
      db.proposal.count({ where: { tenantId: tenant, status: { in: ['DRAFT', 'VALIDATED'] } } }),
      db.saleOrder.count({ where: { tenantId: tenant, status: { in: ['DRAFT', 'VALIDATED', 'DELIVERED'] } } }),
      db.invoice.findMany({
        where: { tenantId: tenant, status: { in: ['UNPAID', 'PARTIAL'] } },
        select: { total: true, paidAmount: true, dueDate: true, ref: true, thirdParty: { select: { name: true } } },
      }),
      db.payment.aggregate({ where: { tenantId: tenant }, _sum: { amount: true } }),
      db.product.findMany({
        where: { tenantId: tenant, manageStock: true, status: 'ACTIVE' },
        select: { ref: true, label: true, stockQty: true, minStock: true, unit: true },
      }),
      db.ticket.count({ where: { tenantId: tenant, status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] } } }),
      db.leaveRequest.count({ where: { tenantId: tenant, status: 'PENDING' } }),
      db.project.count({ where: { tenantId: tenant, status: 'OPEN' } }),
      db.bankAccount.findMany({ where: { tenantId: tenant }, select: { id: true, name: true, currentBalance: true, type: true } }),
      db.agendaEvent.findMany({
        where: { tenantId: tenant, start: { gte: new Date() } },
        orderBy: { start: 'asc' },
        take: 5,
        select: { id: true, title: true, type: true, start: true, thirdParty: { select: { name: true } } },
      }),
      // payments received (customer invoices only)
      db.payment.findMany({
        where: { tenantId: tenant, invoiceId: { not: null } },
        select: { amount: true, date: true },
      }),
      db.invoice.findMany({
        where: { tenantId: tenant },
        orderBy: { date: 'desc' },
        take: 6,
        select: {
          id: true, ref: true, status: true, date: true, total: true, paidAmount: true,
          thirdParty: { select: { name: true } },
        },
      }),
      db.ticket.findMany({
        where: { tenantId: tenant },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true, ref: true, subject: true, status: true, priority: true, createdAt: true,
          thirdParty: { select: { name: true } },
        },
      }),
    ])

    // last 6 months revenue vs purchases series
    const now = new Date()
    const series: { month: string; revenue: number; expenses: number }[] = []
    const purchases = await db.supplierInvoice.findMany({ where: { tenantId: tenant }, select: { total: true, date: true } })
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const revenue = monthlySales
        .filter((p) => p.date >= d && p.date < next)
        .reduce((s, p) => s + p.amount, 0)
      const exp = purchases
        .filter((p) => p.date >= d && p.date < next)
        .reduce((s, p) => s + p.total, 0)
      series.push({
        month: d.toLocaleDateString('en-US', { month: 'short' }),
        revenue: Math.round(revenue * 100) / 100,
        expenses: Math.round(exp * 100) / 100,
      })
    }

    const unpaidTotal = unpaidInvoices.reduce((s, i) => s + (i.total - i.paidAmount), 0)
    const overdue = unpaidInvoices.filter((i) => i.dueDate && i.dueDate < new Date())

    const invoiceStatusCounts = await db.invoice.groupBy({
      by: ['status'],
      where: { tenantId: tenant },
      _count: { _all: true },
    })

    const opportunitiesByStage = await db.opportunity.groupBy({
      by: ['stage'],
      where: { tenantId: tenant },
      _count: { _all: true },
      _sum: { amount: true },
    })

    return NextResponse.json({
      data: {
        kpis: {
          thirdPartyCount,
          productCount,
          openProposalCount,
          openOrderCount,
          unpaidTotal: Math.round(unpaidTotal * 100) / 100,
          unpaidCount: unpaidInvoices.length,
          overdueCount: overdue.length,
          paidTotal: paidThisYear._sum.amount ?? 0,
          lowStockCount: lowStockProducts.filter((p) => p.stockQty <= p.minStock).length,
          openTickets,
          pendingLeaves,
          activeProjects,
          bankBalance: bankAccounts.reduce((s, a) => s + a.currentBalance, 0),
        },
        lowStock: lowStockProducts
          .filter((p) => p.stockQty <= p.minStock)
          .sort((a, b) => a.stockQty - b.stockQty)
          .slice(0, 6),
        unpaid: unpaidInvoices.slice(0, 6).map((i) => ({
          ref: i.ref,
          thirdParty: i.thirdParty.name,
          remaining: Math.round((i.total - i.paidAmount) * 100) / 100,
          dueDate: i.dueDate,
        })),
        series,
        invoiceStatusCounts: invoiceStatusCounts.map((g) => ({ status: g.status, count: g._count._all })),
        opportunitiesByStage: opportunitiesByStage.map((g) => ({ stage: g.stage, count: g._count._all, amount: g._sum.amount ?? 0 })),
        recentInvoices,
        recentTickets,
        upcomingEvents,
      },
    })
  } catch (err) {
    console.error('GET /api/dashboard failed', err)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
