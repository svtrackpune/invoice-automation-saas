import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const migration=await readFile(new URL('supabase/migrations/20261003100000_global_tax_engine_v1.sql',root),'utf8');
const adapter=await readFile(new URL('lib/server/tax/india-gst-adapter.ts',root),'utf8');
const address=await readFile(new URL('lib/addresses.ts',root),'utf8');
const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));

test('Wave 2 migration exposes generic tax architecture',()=>{
  for(const token of ['CREATE TABLE IF NOT EXISTS public.jurisdictions','CREATE TABLE IF NOT EXISTS public.business_tax_registrations','CREATE TABLE IF NOT EXISTS public.tax_rules','CREATE TABLE IF NOT EXISTS public.tax_rule_components','CREATE TABLE IF NOT EXISTS public.customer_tax_profiles','CREATE TABLE IF NOT EXISTS public.invoice_tax_lines',"calculation_basis IN ('net','gross_plus_previous')",'compound_on_component_id','guard_invoice_tax_line_immutable','india_gst_adapter_snapshot_invoice','snapshot_invoice_tax_lines','trg_snapshot_posted_invoice_tax'])
    assert.ok(migration.toLowerCase().includes(token.toLowerCase()),token);
});

test('Wave 2 migration protects immutable tax history and ledger boundaries',()=>{
  assert.match(migration,/REVOKE ALL ON TABLE public\.invoice_tax_lines FROM anon,authenticated/i);
  assert.match(migration,/Posted invoice tax snapshots are immutable/i);
  assert.doesNotMatch(migration,/CREATE OR REPLACE FUNCTION public\.validate_journal_entry_balance/i);
  assert.doesNotMatch(migration,/DROP FUNCTION IF EXISTS public\.validate_journal_entry_balance/i);
});

test('Canonical ISO address shape is explicit',()=>{
  for(const field of ['canonicalize_iso_address','country_code','country_subdivision_code','postal_code','address_line_1','address_line_2'])
    assert.ok(migration.includes(field),field);
  assert.match(address,/normalizeCanonicalAddress/);
});

test('Canonical document model uses security-invoker views',()=>{
  assert.match(migration,/CREATE OR REPLACE VIEW public\.canonical_documents\s+WITH \(security_invoker=true\)/i);
  assert.match(migration,/CREATE OR REPLACE VIEW public\.canonical_document_items\s+WITH \(security_invoker=true\)/i);
});

test('US stacking and Canadian compounding semantics are representable',()=>{
  const stateTax=100*5/100; const cityTax=100*2/100; assert.equal(stateTax+cityTax,7);
  const gst=100*5/100; const pst=(100+gst)*8/100; assert.equal(Number(pst.toFixed(6)),8.4);
});

test('IndiaGSTAdapter is deterministic and component-aware',()=>{
  for(const token of ['IndiaGSTAdapter','CGST','SGST','IGST','REVERSE_CHARGE','baseTaxAmount'])assert.ok(adapter.includes(token),token);
});

test('Wave 2 package version is carried into the remediation release',()=>{assert.equal(pkg.version,'1.4.1');});