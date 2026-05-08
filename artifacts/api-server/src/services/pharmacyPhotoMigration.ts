import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let _migrated = false;

export async function ensurePharmacyPhotoColumn(): Promise<void> {
  if (_migrated) return;
  await db.execute(sql`
    ALTER TABLE pharmacy_orders
    ADD COLUMN IF NOT EXISTS prescription_photo_url TEXT
  `);
  _migrated = true;
}
