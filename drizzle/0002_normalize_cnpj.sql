-- Store clients.cnpj digits-only (14 digits). Formatting becomes a display
-- concern (src/lib/cnpj.ts formatCnpj). Idempotent and non-destructive.
--
-- Guard: if stripping punctuation would make two existing rows collide, abort
-- with a clear message instead of half-applying — the operator resolves the
-- duplicates by hand.
DO $$
DECLARE
  dup record;
BEGIN
  FOR dup IN
    SELECT regexp_replace(cnpj, '[^0-9]', '', 'g') AS norm, count(*) AS n
      FROM clients
     GROUP BY 1
    HAVING count(*) > 1
  LOOP
    RAISE EXCEPTION
      'CNPJ normalisation would collide: "%" appears % times — resolve the duplicate client rows first',
      dup.norm, dup.n;
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE "clients"
   SET "cnpj" = regexp_replace("cnpj", '[^0-9]', '', 'g')
 WHERE "cnpj" <> regexp_replace("cnpj", '[^0-9]', '', 'g');
