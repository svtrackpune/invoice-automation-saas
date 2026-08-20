-- Moneymatters v1 go-live security and permission hardening.
-- Closes anonymous RPC mutation paths, hardens journal posting/reversal,
-- scopes accounting history mutations to accounting permissions, and removes
-- public-role policies from authenticated business data.

-- Permission helpers must bypass table RLS or policies recurse through organization_members.
create or replace function mm_private.has_permission(p_organization_id uuid,p_permission text,p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, mm_private as $$
  select exists(
    select 1 from public.organization_members om
    left join public.member_permissions mp on mp.organization_id=om.organization_id and mp.user_id=om.user_id and mp.permission_key=p_permission
    left join public.role_permissions rp on rp.role=om.role and rp.permission_key=p_permission
    where om.organization_id=p_organization_id and om.user_id=p_user_id and om.is_active
      and coalesce(mp.allowed,rp.allowed,false)
  );
$$;

create or replace function mm_private.has_business_permission(p_business_id uuid,p_permission text,p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, mm_private as $$
  select exists(select 1 from public.businesses b where b.id=p_business_id and mm_private.has_permission(b.organization_id,p_permission,p_user_id));
$$;

revoke execute on function mm_private.has_permission(uuid,text,uuid) from public, anon;
revoke execute on function mm_private.has_business_permission(uuid,text,uuid) from public, anon;
grant execute on function mm_private.has_permission(uuid,text,uuid) to authenticated;
grant execute on function mm_private.has_business_permission(uuid,text,uuid) to authenticated;

-- Anonymous clients must never execute financial/business mutation RPCs.
revoke execute on function public.create_journal_entry(uuid,date,text,text,uuid,char,jsonb,uuid) from public, anon;
grant execute on function public.create_journal_entry(uuid,date,text,text,uuid,char,jsonb,uuid) to authenticated;
revoke execute on function public.post_journal_entry(uuid) from public, anon;
grant execute on function public.post_journal_entry(uuid) to authenticated;
revoke execute on function public.reverse_journal_entry(uuid,date,text,uuid) from public, anon;
grant execute on function public.reverse_journal_entry(uuid,date,text,uuid) to authenticated;
revoke execute on function public.seed_default_chart_of_accounts(uuid) from public, anon;
grant execute on function public.seed_default_chart_of_accounts(uuid) to authenticated;
revoke execute on function public.next_document_number(uuid,text) from public, anon;
grant execute on function public.next_document_number(uuid,text) to authenticated;

-- Trigger-only functions must not be client-callable.
revoke execute on function public.initialize_document_preferences() from public, anon;
revoke execute on function public.initialize_business_defaults() from public, anon;
revoke execute on function public.initialize_operational_defaults() from public, anon;
revoke execute on function public.set_updated_at() from public, anon;
revoke execute on function public.guard_journal_period() from public, anon;
revoke execute on function public.validate_journal_entry_balance(uuid) from public, anon;
revoke execute on function public.validate_payment_allocation() from public, anon;
revoke execute on function public.sync_document_payment_totals() from public, anon;
revoke execute on function public.apply_inventory_movement_to_balance() from public, anon;
revoke execute on function public.guard_quotation_status_transition() from public, anon;

-- Posting/reversal must enforce permissions even when called directly.
create or replace function public.post_journal_entry(p_entry_id uuid)
returns uuid language plpgsql security definer set search_path = public, mm_private as $$
declare v_business_id uuid;
begin
  select business_id into v_business_id from public.journal_entries where id=p_entry_id;
  if v_business_id is null then raise exception 'Journal entry not found'; end if;
  if not mm_private.has_business_permission(v_business_id,'accounting.post') then raise exception 'Access denied'; end if;
  perform mm_private.validate_journal_entry(p_entry_id);
  return p_entry_id;
end;
$$;

create or replace function public.reverse_journal_entry(p_entry_id uuid,p_reversal_date date,p_reason text,p_created_by uuid default auth.uid())
returns uuid language plpgsql security definer set search_path = public, mm_private as $$
declare v_old public.journal_entries%rowtype; v_new uuid; v_num bigint; v_period text;
begin
  select * into v_old from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if not mm_private.has_business_permission(v_old.business_id,'accounting.adjust') then raise exception 'Access denied'; end if;
  if v_old.status<>'posted' then raise exception 'Only posted entries can be reversed'; end if;
  perform public.assert_accounting_period_open(v_old.business_id,p_reversal_date);
  select status into v_period from public.accounting_periods where business_id=v_old.business_id and p_reversal_date between period_start and period_end order by period_start desc limit 1;
  if v_period in ('closed','locked') then raise exception 'Reversal period is %',v_period; end if;
  perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||v_old.business_id::text));
  select coalesce(max(entry_number),0)+1 into v_num from public.journal_entries where business_id=v_old.business_id;
  insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,currency_code,reversal_of_id,created_by,is_system_generated)
  values(v_old.business_id,v_num,p_reversal_date,coalesce(p_reason,'Reversal of '||v_old.entry_number),'reversal',v_old.id,'draft',v_old.currency_code,v_old.id,p_created_by,true) returning id into v_new;
  insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,exchange_rate,entity_type,entity_id,metadata)
  select v_new,account_id,description,credit,debit,currency_code,exchange_rate,entity_type,entity_id,metadata from public.journal_lines where journal_entry_id=p_entry_id;
  perform public.post_journal_entry(v_new);
  return v_new;
end;
$$;

-- Journal history is readable by members, but mutations require accounting permissions.
drop policy if exists journal_entries_member_all on public.journal_entries;
drop policy if exists journal_entries_member_select on public.journal_entries;
drop policy if exists journal_entries_accounting_insert on public.journal_entries;
drop policy if exists journal_entries_accounting_update on public.journal_entries;
drop policy if exists journal_entries_accounting_delete on public.journal_entries;
create policy journal_entries_member_select on public.journal_entries for select to authenticated using (mm_private.is_org_member(mm_private.business_org(business_id)));
create policy journal_entries_accounting_insert on public.journal_entries for insert to authenticated with check (mm_private.has_business_permission(business_id,'accounting.post'));
create policy journal_entries_accounting_update on public.journal_entries for update to authenticated using (mm_private.has_business_permission(business_id,'accounting.adjust')) with check (mm_private.has_business_permission(business_id,'accounting.adjust'));
create policy journal_entries_accounting_delete on public.journal_entries for delete to authenticated using (mm_private.has_business_permission(business_id,'accounting.adjust'));

drop policy if exists journal_lines_member_all on public.journal_lines;
drop policy if exists journal_lines_member_select on public.journal_lines;
drop policy if exists journal_lines_accounting_insert on public.journal_lines;
drop policy if exists journal_lines_accounting_update on public.journal_lines;
drop policy if exists journal_lines_accounting_delete on public.journal_lines;
create policy journal_lines_member_select on public.journal_lines for select to authenticated using (exists(select 1 from public.journal_entries je where je.id=journal_lines.journal_entry_id and mm_private.is_org_member(mm_private.business_org(je.business_id))));
create policy journal_lines_accounting_insert on public.journal_lines for insert to authenticated with check (exists(select 1 from public.journal_entries je where je.id=journal_lines.journal_entry_id and mm_private.has_business_permission(je.business_id,'accounting.post')));
create policy journal_lines_accounting_update on public.journal_lines for update to authenticated using (exists(select 1 from public.journal_entries je where je.id=journal_lines.journal_entry_id and mm_private.has_business_permission(je.business_id,'accounting.adjust'))) with check (exists(select 1 from public.journal_entries je where je.id=journal_lines.journal_entry_id and mm_private.has_business_permission(je.business_id,'accounting.adjust')));
create policy journal_lines_accounting_delete on public.journal_lines for delete to authenticated using (exists(select 1 from public.journal_entries je where je.id=journal_lines.journal_entry_id and mm_private.has_business_permission(je.business_id,'accounting.adjust')));

-- Business identity and settings are not writable by every organization member.
drop policy if exists businesses_member_all on public.businesses;
drop policy if exists businesses_member_select on public.businesses;
drop policy if exists businesses_settings_update on public.businesses;
create policy businesses_member_select on public.businesses for select to authenticated using (mm_private.is_org_member(organization_id));
create policy businesses_settings_update on public.businesses for update to authenticated using (mm_private.has_business_permission(id,'settings.manage')) with check (mm_private.has_business_permission(id,'settings.manage'));

drop policy if exists business_settings_member_all on public.business_settings;
drop policy if exists business_settings_member_select on public.business_settings;
drop policy if exists business_settings_manage on public.business_settings;
drop policy if exists business_settings_manage_update on public.business_settings;
drop policy if exists business_settings_manage_delete on public.business_settings;
create policy business_settings_member_select on public.business_settings for select to authenticated using (exists(select 1 from public.businesses b where b.id=business_settings.business_id and mm_private.is_org_member(b.organization_id)));
create policy business_settings_manage on public.business_settings for insert to authenticated with check (mm_private.has_business_permission(business_id,'settings.manage'));
create policy business_settings_manage_update on public.business_settings for update to authenticated using (mm_private.has_business_permission(business_id,'settings.manage')) with check (mm_private.has_business_permission(business_id,'settings.manage'));
create policy business_settings_manage_delete on public.business_settings for delete to authenticated using (mm_private.has_business_permission(business_id,'settings.manage'));

-- Remove every public-role policy from public business data; recreate the affected policies below.
DO $$
declare r record;
begin
  for r in select tablename,policyname from pg_policies where schemaname='public' and 'public'=any(roles) loop
    execute format('drop policy if exists %I on public.%I',r.policyname,r.tablename);
  end loop;
end $$;

create policy ai_agent_preferences_member on public.ai_agent_preferences for all to authenticated using (mm_private.has_business_permission(business_id,'settings.manage')) with check (mm_private.has_business_permission(business_id,'settings.manage'));
create policy ai_insight_events_member on public.ai_insight_events for select to authenticated using (mm_private.has_business_permission(business_id,'ai.use'));
create policy business_document_preferences_member_all on public.business_document_preferences for all to authenticated using (mm_private.has_business_permission(business_id,'settings.manage')) with check (mm_private.has_business_permission(business_id,'settings.manage'));
create policy business_preferences_member_all on public.business_preferences for all to authenticated using (mm_private.has_business_permission(business_id,'settings.manage')) with check (mm_private.has_business_permission(business_id,'settings.manage'));
create policy business_tax_profiles_member_all on public.business_tax_profiles for all to authenticated using (mm_private.has_business_permission(business_id,'settings.manage')) with check (mm_private.has_business_permission(business_id,'settings.manage'));
create policy debit_note_lines_member on public.debit_note_lines for all to authenticated using (exists(select 1 from public.debit_notes d where d.id=debit_note_lines.debit_note_id and mm_private.has_business_permission(d.business_id,'accounting.view'))) with check (exists(select 1 from public.debit_notes d where d.id=debit_note_lines.debit_note_id and mm_private.has_business_permission(d.business_id,'accounting.adjust')));
create policy tax_adjustments_member on public.tax_adjustments for all to authenticated using (mm_private.has_business_permission(business_id,'tax.manage')) with check (mm_private.has_business_permission(business_id,'tax.manage'));
create policy tax_filing_profiles_member on public.tax_filing_profiles for all to authenticated using (mm_private.has_business_permission(business_id,'tax.manage')) with check (mm_private.has_business_permission(business_id,'tax.manage'));
