-- Migration: Pharmacy prescription photo URL column (Task #2)
-- Adds prescription_photo_url to pharmacy_orders to persist resolved
-- prescription image references across server restarts.

ALTER TABLE pharmacy_orders
  ADD COLUMN IF NOT EXISTS prescription_photo_url TEXT;
