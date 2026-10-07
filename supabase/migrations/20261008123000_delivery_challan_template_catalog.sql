BEGIN;
ALTER TABLE public.document_templates DROP CONSTRAINT IF EXISTS document_templates_document_type_check;
ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_document_type_check CHECK (document_type IN ('quotation','invoice','receipt','delivery_challan'));
INSERT INTO public.document_templates(document_type,template_key,template_name,description,version,layout_config,supported_features,is_system,is_active)
VALUES
('delivery_challan','classic','Classic Challan','Formal dispatch challan with transport and stock details.',1,'{}','{"transport":true,"stock":true,"serial_numbers":true}'::jsonb,true,true),
('delivery_challan','minimal','Minimal Challan','Compact dispatch note for fast field operations.',1,'{}','{"transport":true,"stock":true}'::jsonb,true,true),
('delivery_challan','modern','Modern Challan','Modern dispatch layout with strong item hierarchy.',1,'{}','{"transport":true,"stock":true,"serial_numbers":true}'::jsonb,true,true),
('delivery_challan','premium','Premium Challan','Detailed branded dispatch document.',1,'{}','{"transport":true,"stock":true,"serial_numbers":true,"eway_bill":true}'::jsonb,true,true),
('delivery_challan','professional','Professional Challan','Business-focused dispatch layout for B2B operations.',1,'{}','{"transport":true,"stock":true,"eway_bill":true}'::jsonb,true,true)
ON CONFLICT DO NOTHING;
COMMIT;