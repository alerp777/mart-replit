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

  const typedItems = items as Array<Record<string, unknown>>;

  /* ── Per-item validation — collect ALL errors then return 422 ── */
  const productIds = typedItems
    .map(it => it["productId"])
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const variantIds = typedItems
    .map(it => it["variantId"])
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  try {
    const validationErrors: Array<{ index: number; productId?: string; variantId?: string; quantity?: number; error: string; max?: number }> = [];

    for (const [idx, item] of typedItems.entries()) {
      const pid = item["productId"];
      /* Every line item must reference a valid product */
      if (typeof pid !== "string" || pid.trim().length === 0) {
        validationErrors.push({ index: idx, error: "missing_product_id" });
        continue;
      }
      const qty = Number(item["quantity"]);
      if (!Number.isFinite(qty) || qty < 1) {
        validationErrors.push({ index: idx, productId: pid, error: "invalid_quantity" });
      } else if (qty > MAX_ITEM_QUANTITY) {
        validationErrors.push({ index: idx, productId: pid, quantity: qty, error: "quantity_exceeded", max: MAX_ITEM_QUANTITY });
      }
    }

    if (productIds.length > 0) {
      const products = await db
        .select({ id: productsTable.id, inStock: productsTable.inStock, stock: productsTable.stock })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));

      const productMap = new Map(products.map(p => [p.id, p]));

      for (const [idx, item] of typedItems.entries()) {
        const productId = item["productId"];
        if (typeof productId !== "string" || !productId) continue;
        const product = productMap.get(productId);
        if (!product) {
          validationErrors.push({ index: idx, productId, error: "not_found" });
        } else if (!product.inStock || (product.stock !== null && product.stock <= 0)) {
          validationErrors.push({ index: idx, productId, error: "out_of_stock" });
        }
      }
    }

    if (variantIds.length > 0) {
      const variants = await db
        .select({ id: productVariantsTable.id, inStock: productVariantsTable.inStock, stock: productVariantsTable.stock })
        .from(productVariantsTable)
        .where(inArray(productVariantsTable.id, variantIds));

      const variantMap = new Map(variants.map(v => [v.id, v]));

      for (const [idx, item] of typedItems.entries()) {
        const variantId = item["variantId"];
        if (typeof variantId !== "string" || !variantId) continue;
        const variant = variantMap.get(variantId);
        if (!variant) {
          validationErrors.push({ index: idx, variantId, error: "not_found" });
        } else if (!variant.inStock || (variant.stock !== null && variant.stock <= 0)) {
          validationErrors.push({ index: idx, variantId, error: "out_of_stock" });
        }
      }
    }

    if (validationErrors.length > 0) {
      res.status(422).json({ error: "Cart validation failed", errors: validationErrors });
      return;
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
