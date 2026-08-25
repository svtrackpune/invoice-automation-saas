-- Standardize internal bank transfers and posted invoice void/reversal handling.
CREATE OR REPLACE FUNCTION public.match_bank_transaction(p_reconciliation_id uuid, p_bank_transaction_id uuid, p_match_type text, p_matched_record_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','mm_private' AS $function$
declare rid uuid; bid uuid; tx public.bank_transactions%rowtype; rec public.bank_reconciliations%rowtype; target_account uuid; source_account uuid; target_bank uuid; je uuid; v_entry_no bigint; existing public.bank_reconciliation_items%rowtype;
begin
 select * into rec from public.bank_reconciliations where id=p_reconciliation_id for update; if rec.id is null then raise exception 'Reconciliation not found'; end if;
 bid:=rec.business_id; if rec.status='locked' then raise exception 'Reconciliation is locked'; end if;
 if not mm_private.has_business_permission(bid,'accounting.adjust') then raise exception 'Access denied'; end if;
 select * into tx from public.bank_transactions where id=p_bank_transaction_id and bank_account_id=rec.bank_account_id for update; if tx.id is null then raise exception 'Bank transaction does not belong to reconciliation account'; end if;
 select * into existing from public.bank_reconciliation_items where reconciliation_id=rec.id and bank_transaction_id=tx.id;
 if existing.id is not null and existing.matched and p_match_type<>'none' then if existing.match_type=p_match_type and existing.matched_record_id=p_matched_record_id then return existing.id; end if; raise exception 'Transaction is already matched; unmatch it before changing the category'; end if;
 if p_match_type in ('expense','journal','manual') and p_matched_record_id is null then raise exception 'A target account is required for this match type'; end if;
 if p_match_type in ('expense','journal','manual') and not exists(select 1 from public.accounts where id=p_matched_record_id and business_id=bid and is_active) then raise exception 'Matched account is invalid'; end if;
 if p_match_type='transfer' then target_bank:=p_matched_record_id; if target_bank is null or target_bank=rec.bank_account_id or not exists(select 1 from public.bank_accounts where id=target_bank and business_id=bid and is_active) then raise exception 'Target bank account is invalid'; end if; end if;
 if p_match_type not in ('payment','expense','transfer','journal','manual','none') then raise exception 'Unsupported match type'; end if;
 if p_match_type in ('expense','journal','manual','transfer') then
   if not mm_private.has_business_permission(bid,'accounting.post') then raise exception 'Accounting posting permission required'; end if;
   select linked_account_id into source_account from public.bank_accounts where id=rec.bank_account_id and business_id=bid and is_active; if source_account is null then raise exception 'Source bank account is not linked to a chart-of-accounts account'; end if;
   perform public.assert_accounting_period_open(bid,tx.transaction_date); perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||bid::text));
   select coalesce(max(entry_number),0)+1 into v_entry_no from public.journal_entries where business_id=bid;
   insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated)
   values(bid,v_entry_no,tx.transaction_date,case when p_match_type='transfer' then 'Internal bank transfer: '||coalesce(tx.description,tx.reference,'Transfer') else 'Bank transaction: '||coalesce(tx.description,tx.reference,'Transaction') end,case when p_match_type='transfer' then 'bank_transfer' else 'bank_transaction' end,tx.id,'posted',now(),auth.uid(),auth.uid(),(select currency_code from public.bank_accounts where id=rec.bank_account_id),tx.amount,tx.amount,true) returning id into je;
   if p_match_type='transfer' then
     select linked_account_id into target_account from public.bank_accounts where id=target_bank and business_id=bid and is_active; if target_account is null then raise exception 'Target bank account is not linked to a chart-of-accounts account'; end if;
     if lower(tx.direction::text) in ('outbound','debit','withdrawal') then insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) values(je,target_account,'Transfer into bank account',tx.amount,0,(select currency_code from public.bank_accounts where id=rec.bank_account_id)),(je,source_account,'Transfer from bank account',0,tx.amount,(select currency_code from public.bank_accounts where id=rec.bank_account_id)); else insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) values(je,source_account,'Transfer into bank account',tx.amount,0,(select currency_code from public.bank_accounts where id=rec.bank_account_id)),(je,target_account,'Transfer from bank account',0,tx.amount,(select currency_code from public.bank_accounts where id=rec.bank_account_id)); end if;
   else
     target_account:=p_matched_record_id; if lower(tx.direction::text) in ('outbound','debit','withdrawal') then insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) values(je,target_account,coalesce(tx.description,'Bank expense'),tx.amount,0,(select currency_code from public.bank_accounts where id=rec.bank_account_id)),(je,source_account,coalesce(tx.description,'Bank payment'),0,tx.amount,(select currency_code from public.bank_accounts where id=rec.bank_account_id)); else insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) values(je,source_account,coalesce(tx.description,'Bank receipt'),tx.amount,0,(select currency_code from public.bank_accounts where id=rec.bank_account_id)),(je,target_account,coalesce(tx.description,'Bank income'),0,tx.amount,(select currency_code from public.bank_accounts where id=rec.bank_account_id)); end if;
   end if; perform public.validate_journal_entry_balance(je);
 end if;
 insert into public.bank_reconciliation_items(reconciliation_id,bank_transaction_id,matched,match_type,matched_record_id,adjustment_journal_id,notes) values(rec.id,tx.id,p_match_type<>'none',p_match_type,p_matched_record_id,je,p_notes) on conflict(reconciliation_id,bank_transaction_id) do update set matched=excluded.matched,match_type=excluded.match_type,matched_record_id=excluded.matched_record_id,adjustment_journal_id=excluded.adjustment_journal_id,notes=excluded.notes returning id into rid;
 update public.bank_transactions set status=case when p_match_type='none' then 'unreviewed'::bank_txn_status else 'reconciled'::bank_txn_status end,reviewed_at=now(),reviewed_by=auth.uid() where id=tx.id; return rid;
end; $function$;

CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','mm_private' AS $function$
declare inv public.invoices%rowtype; original public.journal_entries%rowtype; rev uuid; v_entry_no bigint; line record; mov record;
begin
 select * into inv from public.invoices where id=p_invoice_id for update; if inv.id is null then raise exception 'Invoice not found'; end if;
 if not mm_private.has_business_permission(inv.business_id,'accounting.post') then raise exception 'Access denied'; end if;
 if inv.status='void' then return inv.journal_entry_id; end if;
 if inv.status='draft' then update public.invoices set status='void'::invoice_status,updated_at=now() where id=inv.id; return null; end if;
 if inv.journal_entry_id is null then raise exception 'Posted invoice has no journal entry'; end if;
 select * into original from public.journal_entries where id=inv.journal_entry_id for update; if original.id is null then raise exception 'Original journal entry not found'; end if;
 if exists(select 1 from public.journal_entries where reversal_of_id=original.id) then raise exception 'Invoice has already been reversed'; end if;
 perform public.assert_accounting_period_open(inv.business_id,current_date); perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||inv.business_id::text));
 select coalesce(max(entry_number),0)+1 into v_entry_no from public.journal_entries where business_id=inv.business_id;
 insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated,reversal_of_id,metadata)
 values(inv.business_id,v_entry_no,current_date,'Void invoice '||inv.invoice_number,'invoice_void',inv.id,'posted',now(),auth.uid(),auth.uid(),inv.currency_code,original.total_credit,original.total_debit,true,original.id,jsonb_build_object('reason',p_reason,'original_journal_entry_id',original.id)) returning id into rev;
 for line in select account_id,description,debit,credit,currency_code,entity_type,entity_id,metadata from public.journal_lines where journal_entry_id=original.id loop insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,metadata) values(rev,line.account_id,'Reversal: '||coalesce(line.description,''),line.credit,line.debit,line.currency_code,line.entity_type,line.entity_id,line.metadata); end loop;
 perform public.validate_journal_entry_balance(rev);
 for mov in select location_id,product_service_id,quantity,unit_cost,batch_number,serial_number from public.inventory_movements where reference_type='invoice' and reference_id=inv.id and movement_type='sale' loop
   update public.inventory_balances set quantity_on_hand=quantity_on_hand+mov.quantity,updated_at=now() where business_id=inv.business_id and location_id=mov.location_id and product_service_id=mov.product_service_id;
   if not found then insert into public.inventory_balances(business_id,location_id,product_service_id,quantity_on_hand,average_cost,updated_at) values(inv.business_id,mov.location_id,mov.product_service_id,mov.quantity,mov.unit_cost,now()); end if;
   insert into public.inventory_movements(business_id,location_id,product_service_id,movement_type,quantity,unit_cost,reference_type,reference_id,batch_number,serial_number,notes,created_by) values(inv.business_id,mov.location_id,mov.product_service_id,'sale_reversal',mov.quantity,mov.unit_cost,'invoice_void',inv.id,mov.batch_number,mov.serial_number,coalesce(p_reason,'Invoice void reversal'),auth.uid());
 end loop;
 update public.invoices set status='void'::invoice_status,updated_at=now(),notes=case when p_reason is null or trim(p_reason)='' then notes else coalesce(notes||E'\n','')||'Void reason: '||p_reason end where id=inv.id; return rev;
end; $function$;