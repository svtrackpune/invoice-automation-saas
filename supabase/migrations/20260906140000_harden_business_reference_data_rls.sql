-- Harden onboarding reference data: categories are read-only reference data.
-- Business creation is authenticated, so anonymous access is not required.

ALTER TABLE public.business_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_subcategories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read business categories" ON public.business_categories;
CREATE POLICY "authenticated users can read business categories"
  ON public.business_categories
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated users can read business subcategories" ON public.business_subcategories;
CREATE POLICY "authenticated users can read business subcategories"
  ON public.business_subcategories
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.business_categories FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.business_subcategories FROM anon, authenticated;
