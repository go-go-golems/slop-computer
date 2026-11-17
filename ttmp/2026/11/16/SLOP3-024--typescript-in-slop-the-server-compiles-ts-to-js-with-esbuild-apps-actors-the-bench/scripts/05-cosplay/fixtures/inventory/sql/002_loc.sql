ALTER TABLE tbl_inv ADD COLUMN loc TEXT;
UPDATE tbl_inv SET loc = 'A1' WHERE ID < 4;
-- TODO set the rest
