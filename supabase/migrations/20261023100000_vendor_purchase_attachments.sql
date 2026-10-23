BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vendor-purchase-attachments',
  'Vendor Purchase Attachments',
  false,
  20971520,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS vendor_purchase_attachments_select ON storage.objects;
CREATE POLICY vendor_purchase_attachments_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'vendor-purchase-attachments'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE (storage.foldername(name))[1] = b.id::text
      AND (
        mm_private.has_business_permission(b.id, 'purchases.view', auth.uid())
        OR mm_private.has_business_permission(b.id, 'purchases.manage', auth.uid())
      )
  )
);

DROP POLICY IF EXISTS vendor_purchase_attachments_insert ON storage.objects;
CREATE POLICY vendor_purchase_attachments_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vendor-purchase-attachments'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE (storage.foldername(name))[1] = b.id::text
      AND mm_private.has_business_permission(b.id, 'purchases.manage', auth.uid())
  )
);

DROP POLICY IF EXISTS vendor_purchase_attachments_update ON storage.objects;
CREATE POLICY vendor_purchase_attachments_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'vendor-purchase-attachments'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE (storage.foldername(name))[1] = b.id::text
      AND mm_private.has_business_permission(b.id, 'purchases.manage', auth.uid())
  )
)
WITH CHECK (
  bucket_id = 'vendor-purchase-attachments'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE (storage.foldername(name))[1] = b.id::text
      AND mm_private.has_business_permission(b.id, 'purchases.manage', auth.uid())
  )
);

DROP POLICY IF EXISTS vendor_purchase_attachments_delete ON storage.objects;
CREATE POLICY vendor_purchase_attachments_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'vendor-purchase-attachments'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE (storage.foldername(name))[1] = b.id::text
      AND mm_private.has_business_permission(b.id, 'purchases.manage', auth.uid())
  )
);

COMMIT;
