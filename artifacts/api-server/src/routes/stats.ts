import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { productsTable, vendorProfilesTable, ordersTable, usersTable, ridesTable } from "@workspace/db/schema";
import { and, count, countDistinct, eq, gte, inArray, sum } from "drizzle-orm";
import { sendSuccess, sendInternalError } from "../lib/response.js";

const router: IRouter = Router();

/* ── GET /api/stats — real platform KPIs ─────────────────────────────────── */
router.get("/", async (_req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      [ordersResult],
      [revenueResult],
      [activeUsersResult],
      [activeRidersResult],
      [activeVendorsResult],
      [ridesResult],
    ] = await Promise.all([
      /* Total orders placed in the last 30 days */
      db.select({ c: count() }).from(ordersTable).where(gte(ordersTable.createdAt, thirtyDaysAgo)),
      /* Revenue from delivered/completed orders only */
      db.select({ total: sum(ordersTable.total) }).from(ordersTable).where(
        inArray(ordersTable.status, ["delivered", "completed"]),
      ),
      /* Distinct customers who placed at least one order in the last 30 days */
      db.select({ c: countDistinct(ordersTable.userId) }).from(ordersTable).where(gte(ordersTable.createdAt, thirtyDaysAgo)),
      /* Riders who completed at least one delivery in the last 30 days */
      db.select({ c: countDistinct(ordersTable.riderId) }).from(ordersTable).where(
        and(
          inArray(ordersTable.status, ["delivered", "completed"]),
          gte(ordersTable.createdAt, thirtyDaysAgo),
        ),
      ),
      /* Vendors with their store currently open */
      db.select({ c: count() }).from(vendorProfilesTable).where(eq(vendorProfilesTable.storeIsOpen, true)),
      /* Completed rides this calendar month */
      db.select({ c: count() }).from(ridesTable).where(
        and(
          inArray(ridesTable.status, ["completed"]),
          gte(ridesTable.createdAt, new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
        ),
      ),
    ]);

    sendSuccess(res, {
      totalOrders: Number(ordersResult?.c ?? 0),
      totalRevenue: parseFloat(String(revenueResult?.total ?? "0")) || 0,
      activeUsers: Number(activeUsersResult?.c ?? 0),
      activeRiders: Number(activeRidersResult?.c ?? 0),
      activeVendors: Number(activeVendorsResult?.c ?? 0),
      rideCount: Number(ridesResult?.c ?? 0),
    });
  } catch {
    sendInternalError(res, "Failed to fetch stats");
  }
});

/* ── GET /api/stats/public — legacy alias kept for backward compat ─────── */
router.get("/public", async (_req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      [products],
      [vendors],
      [ordersResult],
      [revenueResult],
      [ridersResult],
      [ridesResult],
    ] = await Promise.all([
      db.select({ c: count() }).from(productsTable).where(eq(productsTable.inStock, true)),
      db.select({ c: count() }).from(vendorProfilesTable).where(eq(vendorProfilesTable.storeIsOpen, true)),
      db.select({ c: count() }).from(ordersTable).where(gte(ordersTable.createdAt, thirtyDaysAgo)),
      db.select({ total: sum(ordersTable.total) }).from(ordersTable).where(gte(ordersTable.createdAt, thirtyDaysAgo)),
      db.select({ c: count() }).from(usersTable).where(eq(usersTable.role, "rider")),
      db.select({ c: count() }).from(ridesTable).where(gte(ridesTable.createdAt, thirtyDaysAgo)),
    ]);

    sendSuccess(res, {
      productCount: Number(products?.c ?? 0),
      restaurantCount: Number(vendors?.c ?? 0),
      ordersLast30Days: Number(ordersResult?.c ?? 0),
      revenueLast30Days: parseFloat(String(revenueResult?.total ?? "0")) || 0,
      riderCount: Number(ridersResult?.c ?? 0),
      ridesLast30Days: Number(ridesResult?.c ?? 0),
    });
  } catch {
    sendInternalError(res, "Failed to fetch stats");
  }
});

export default router;
