import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { cartSnapshotsTable, productsTable, productVariantsTable } from "@workspace/db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { customerAuth } from "../middleware/security.js";
import { sendSuccess, sendError } from "../lib/response.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MAX_ITEM_QUANTITY = 99;

/* ── GET /api/cart/snapshot — fetch the user's saved cart snapshot ── */
router.get("/snapshot", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const [row] = await db
      .select()
      .from(cartSnapshotsTable)
      .where(eq(cartSnapshotsTable.userId, userId))
      .limit(1);

    sendSuccess(res, { items: row?.items ?? [] });
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId }, "[cart] failed to fetch snapshot");
    sendError(res, "Failed to fetch cart snapshot", 500);
  }
});

/* ── PUT /api/cart/snapshot — upsert the user's cart snapshot ── */
router.put("/snapshot", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { items } = req.body;

  if (!Array.isArray(items)) {
    sendError(res, "items must be an array", 400);
    return;
  }

  /* ── Per-item validation ── */
  for (const item of items as Array<Record<string, unknown>>) {
    const qty = Number(item["quantity"]);
    if (!Number.isFinite(qty) || qty < 1) {
      sendError(res, `Item quantity must be at least 1`, 400);
      return;
    }
    if (qty > MAX_ITEM_QUANTITY) {
      sendError(res, `Item quantity cannot exceed ${MAX_ITEM_QUANTITY}`, 400);
      return;
    }
  }

  /* ── Validate product existence and stock for items with a productId ── */
  const productIds = (items as Array<Record<string, unknown>>)
    .map(it => it["productId"])
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const variantIds = (items as Array<Record<string, unknown>>)
    .map(it => it["variantId"])
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  try {
    if (productIds.length > 0) {
      const products = await db
        .select({ id: productsTable.id, inStock: productsTable.inStock })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));

      const productMap = new Map(products.map(p => [p.id, p]));

      for (const productId of productIds) {
        const product = productMap.get(productId);
        if (!product) {
          sendError(res, `Product ${productId} not found`, 400);
          return;
        }
        if (!product.inStock) {
          sendError(res, `Product ${productId} is out of stock`, 400);
          return;
        }
      }
    }

    if (variantIds.length > 0) {
      const variants = await db
        .select({ id: productVariantsTable.id, inStock: productVariantsTable.inStock })
        .from(productVariantsTable)
        .where(inArray(productVariantsTable.id, variantIds));

      const variantMap = new Map(variants.map(v => [v.id, v]));

      for (const variantId of variantIds) {
        const variant = variantMap.get(variantId);
        if (!variant) {
          sendError(res, `Product variant ${variantId} not found`, 400);
          return;
        }
        if (!variant.inStock) {
          sendError(res, `Product variant ${variantId} is out of stock`, 400);
          return;
        }
      }
    }

    await db
      .insert(cartSnapshotsTable)
      .values({ userId, items, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: cartSnapshotsTable.userId,
        set: {
          items,
          updatedAt: sql`NOW()`,
        },
      });

    sendSuccess(res, { saved: true });
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId }, "[cart] failed to save snapshot");
    sendError(res, "Failed to save cart snapshot", 500);
  }
});

/* ── DELETE /api/cart/snapshot — clear the user's cart snapshot ── */
router.delete("/snapshot", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    await db
      .delete(cartSnapshotsTable)
      .where(eq(cartSnapshotsTable.userId, userId));

    sendSuccess(res, { cleared: true });
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId }, "[cart] failed to clear snapshot");
    sendError(res, "Failed to clear cart snapshot", 500);
  }
});

export default router;
