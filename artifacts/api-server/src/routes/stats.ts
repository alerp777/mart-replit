import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { productsTable, vendorProfilesTable, ordersTable, usersTable, ridesTable } from "@workspace/db/schema";
import { count, eq, gte, sum } from "drizzle-orm";
import { sendSuccess, sendInternalError } from "../lib/response.js";

const router: IRouter = Router();

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
