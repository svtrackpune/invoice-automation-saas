ALTER TABLE public.document_payment_settings
  ADD COLUMN IF NOT EXISTS cashfree_environment TEXT NOT NULL DEFAULT 'production';

ALTER TABLE public.document_payment_settings
  DROP CONSTRAINT IF EXISTS document_payment_settings_cashfree_environment_check;

ALTER TABLE public.document_payment_settings
  ADD CONSTRAINT document_payment_settings_cashfree_environment_check
  CHECK (cashfree_environment IN ('sandbox','production'));

CREATE OR REPLACE FUNCTION public.get_payment_settings(p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
AS $function$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT mm_private.has_business_permission(p_business_id,'settings.manage',auth.uid()) THEN RAISE EXCEPTION 'permission denied' USING errcode='42501'; END IF;
 SELECT jsonb_build_object(
  'business_id',b.id,'upi_id',coalesce(s.upi_id,''),'merchant_name',coalesce(s.merchant_name,b.legal_name,b.name,''),
  'default_bank_account_id',s.default_bank_account_id,'enable_cash',coalesce(s.enable_cash,true),'enable_upi',coalesce(s.enable_upi,true),
  'enable_card',coalesce(s.enable_card,true),'enable_credit',coalesce(s.enable_credit,true),'prefill_bill_amount',coalesce(s.prefill_bill_amount,true),
  'payment_qr_enabled',coalesce(s.payment_qr_enabled,true),'payment_instructions',coalesce(s.payment_instructions,''),'qr_code_notes',coalesce(s.qr_code_notes,''),
  'payment_gateway_provider',s.payment_gateway_provider,'payment_link_enabled',coalesce(s.payment_link_enabled,false),
  'razorpay_enabled',coalesce(s.razorpay_enabled,false),'razorpay_key_id',coalesce(s.razorpay_key_id,''),
  'razorpay_credentials_configured',s.razorpay_secret_ref IS NOT NULL,'razorpay_webhook_configured',s.razorpay_webhook_secret_ref IS NOT NULL,
  'cashfree_enabled',coalesce(s.cashfree_enabled,false),'cashfree_app_id',coalesce(s.cashfree_app_id,''),
  'cashfree_environment',coalesce(s.cashfree_environment,'production'),'cashfree_credentials_configured',s.cashfree_secret_ref IS NOT NULL,
  'cashfree_webhook_configured',s.cashfree_webhook_secret_ref IS NOT NULL,
  'stripe_enabled',coalesce(s.stripe_enabled,false),'stripe_publishable_key',coalesce(s.stripe_publishable_key,''),
  'stripe_credentials_configured',s.stripe_secret_ref IS NOT NULL,'stripe_webhook_configured',s.stripe_webhook_secret_ref IS NOT NULL,
  'gateway_convenience_fee_pct',coalesce(s.gateway_convenience_fee_pct,0)
 ) INTO v
 FROM public.businesses b LEFT JOIN public.document_payment_settings s ON s.business_id=b.id WHERE b.id=p_business_id;
 IF v IS NULL THEN RAISE EXCEPTION 'business not found' USING errcode='P0002'; END IF;
 RETURN v;
END;$function$;

CREATE OR REPLACE FUNCTION public.save_payment_settings(p_business_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
AS $function$
DECLARE s public.document_payment_settings%rowtype; secret text; ref_id uuid;
 provider text:=nullif(lower(btrim(coalesce(p_payload->>'payment_gateway_provider',''))),'');
 bank_id uuid; fee numeric:=coalesce((p_payload->>'gateway_convenience_fee_pct')::numeric,0);
 cashfree_env text:=coalesce(nullif(lower(btrim(p_payload->>'cashfree_environment')),''),'production');
BEGIN
 IF auth.uid() IS NULL OR NOT mm_private.has_business_permission(p_business_id,'settings.manage',auth.uid()) THEN RAISE EXCEPTION 'permission denied' USING errcode='42501'; END IF;
 IF provider IS NOT NULL AND provider NOT IN('razorpay','cashfree','stripe') THEN RAISE EXCEPTION 'invalid payment gateway provider'; END IF;
 IF cashfree_env NOT IN('sandbox','production') THEN RAISE EXCEPTION 'invalid Cashfree environment'; END IF;
 IF fee<0 OR fee>100 THEN RAISE EXCEPTION 'gateway convenience fee must be between 0 and 100'; END IF;
 IF nullif(p_payload->>'default_bank_account_id','') IS NOT NULL THEN bank_id:=(p_payload->>'default_bank_account_id')::uuid; END IF;
 IF bank_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bank_accounts WHERE id=bank_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'invalid settlement bank account' USING errcode='23503'; END IF;
 SELECT * INTO s FROM public.document_payment_settings WHERE business_id=p_business_id FOR UPDATE;

 secret:=nullif(btrim(coalesce(p_payload->>'razorpay_key_secret','')),'');ref_id:=s.razorpay_secret_ref;
 IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-razorpay-'||p_business_id::text,'Razorpay API secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-razorpay-'||p_business_id::text,'Razorpay API secret');END IF;END IF;s.razorpay_secret_ref:=ref_id;
 secret:=nullif(btrim(coalesce(p_payload->>'razorpay_webhook_secret','')),'');ref_id:=s.razorpay_webhook_secret_ref;
 IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(ref_id,secret,'moneymatters-gateway-razorpay-webhook-'||p_business_id::text,'Razorpay webhook secret'); ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-razorpay-webhook-'||p_business_id::text,'Razorpay webhook secret'); END IF; END IF;s.razorpay_webhook_secret_ref:=ref_id;
 secret:=nullif(btrim(coalesce(p_payload->>'cashfree_secret_key','')),'');ref_id:=s.cashfree_secret_ref;
 IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-cashfree-'||p_business_id::text,'Cashfree API secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-cashfree-'||p_business_id::text,'Cashfree API secret');END IF;END IF;s.cashfree_secret_ref:=ref_id;
 secret:=nullif(btrim(coalesce(p_payload->>'cashfree_webhook_secret','')),'');ref_id:=s.cashfree_webhook_secret_ref;
 IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-cashfree-webhook-'||p_business_id::text,'Cashfree webhook secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-cashfree-webhook-'||p_business_id::text,'Cashfree webhook secret');END IF;END IF;s.cashfree_webhook_secret_ref:=ref_id;
 secret:=nullif(btrim(coalesce(p_payload->>'stripe_secret_key','')),'');ref_id:=s.stripe_secret_ref;
 IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-stripe-'||p_business_id::text,'Stripe API secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-stripe-'||p_business_id::text,'Stripe API secret');END IF;END IF;s.stripe_secret_ref:=ref_id;
 secret:=nullif(btrim(coalesce(p_payload->>'stripe_webhook_secret','')),'');ref_id:=s.stripe_webhook_secret_ref;
 IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-stripe-webhook-'||p_business_id::text,'Stripe webhook secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-stripe-webhook-'||p_business_id::text,'Stripe webhook secret');END IF;END IF;s.stripe_webhook_secret_ref:=ref_id;

 INSERT INTO public.document_payment_settings(
  business_id,upi_id,merchant_name,default_bank_account_id,enable_cash,enable_upi,enable_card,enable_credit,prefill_bill_amount,
  payment_qr_enabled,payment_instructions,qr_code_notes,payment_gateway_provider,payment_link_enabled,
  razorpay_enabled,razorpay_key_id,razorpay_secret_ref,razorpay_webhook_secret_ref,
  cashfree_enabled,cashfree_app_id,cashfree_environment,cashfree_secret_ref,cashfree_webhook_secret_ref,
  stripe_enabled,stripe_publishable_key,stripe_secret_ref,stripe_webhook_secret_ref,gateway_convenience_fee_pct,updated_at
 ) VALUES(
  p_business_id,nullif(btrim(coalesce(p_payload->>'upi_id','')),''),nullif(btrim(coalesce(p_payload->>'merchant_name','')),''),bank_id,
  coalesce((p_payload->>'enable_cash')::boolean,true),coalesce((p_payload->>'enable_upi')::boolean,true),
  coalesce((p_payload->>'enable_card')::boolean,true),coalesce((p_payload->>'enable_credit')::boolean,true),coalesce((p_payload->>'prefill_bill_amount')::boolean,true),
  coalesce((p_payload->>'payment_qr_enabled')::boolean,true),nullif(btrim(coalesce(p_payload->>'payment_instructions','')),''),
  nullif(btrim(coalesce(p_payload->>'qr_code_notes','')),''),provider,coalesce((p_payload->>'payment_link_enabled')::boolean,false),
  coalesce((p_payload->>'razorpay_enabled')::boolean,false),nullif(btrim(coalesce(p_payload->>'razorpay_key_id','')),''),s.razorpay_secret_ref,s.razorpay_webhook_secret_ref,
  coalesce((p_payload->>'cashfree_enabled')::boolean,false),nullif(btrim(coalesce(p_payload->>'cashfree_app_id','')),''),cashfree_env,s.cashfree_secret_ref,s.cashfree_webhook_secret_ref,
  coalesce((p_payload->>'stripe_enabled')::boolean,false),nullif(btrim(coalesce(p_payload->>'stripe_publishable_key','')),''),s.stripe_secret_ref,s.stripe_webhook_secret_ref,fee,now()
 )
 ON CONFLICT(business_id) DO UPDATE SET
  upi_id=excluded.upi_id,merchant_name=excluded.merchant_name,default_bank_account_id=excluded.default_bank_account_id,
  enable_cash=excluded.enable_cash,enable_upi=excluded.enable_upi,enable_card=excluded.enable_card,enable_credit=excluded.enable_credit,
  prefill_bill_amount=excluded.prefill_bill_amount,payment_qr_enabled=excluded.payment_qr_enabled,payment_instructions=excluded.payment_instructions,qr_code_notes=excluded.qr_code_notes,
  payment_gateway_provider=excluded.payment_gateway_provider,payment_link_enabled=excluded.payment_link_enabled,
  razorpay_enabled=excluded.razorpay_enabled,razorpay_key_id=excluded.razorpay_key_id,razorpay_secret_ref=excluded.razorpay_secret_ref,razorpay_webhook_secret_ref=excluded.razorpay_webhook_secret_ref,
  cashfree_enabled=excluded.cashfree_enabled,cashfree_app_id=excluded.cashfree_app_id,cashfree_environment=excluded.cashfree_environment,
  cashfree_secret_ref=excluded.cashfree_secret_ref,cashfree_webhook_secret_ref=excluded.cashfree_webhook_secret_ref,
  stripe_enabled=excluded.stripe_enabled,stripe_publishable_key=excluded.stripe_publishable_key,stripe_secret_ref=excluded.stripe_secret_ref,stripe_webhook_secret_ref=excluded.stripe_webhook_secret_ref,
  gateway_convenience_fee_pct=excluded.gateway_convenience_fee_pct,updated_at=now();
 RETURN public.get_payment_settings(p_business_id);
END;$function$;
