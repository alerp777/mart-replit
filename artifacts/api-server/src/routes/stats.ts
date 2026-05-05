import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { productsTable, vendorProfilesTable } from "@workspace/db/schema";
import { count, eq } from "drizzle-orm";
import { sendSuccess, sendInternalError } from "../lib/response.js";

const router: IRouter = Router();

router.get("/public", async (_req, res) => {
  try {
    const [[products], [vendors]] = await Promise.all([
      db.select({ c: count() }).from(productsTable).where(eq(productsTable.inStock, true)),
      db.select({ c: count() }).from(vendorProfilesTable).where(eq(vendorProfilesTable.storeIsOpen, true)),
    ]);
    sendSuccess(res, {
      productCount: products?.c ?? 0,
      restaurantCount: vendors?.c ?? 0,
    });
  } catch {
    sendInternalError(res, "Failed to fetch stats");
  }
});

export default router;
