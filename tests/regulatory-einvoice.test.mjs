import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const ubl=await readFile(new URL('lib/server/documents/ubl/serialize.ts',root),'utf8');
const cii=await readFile(new URL('lib/server/documents/factur-x/cii.ts',root),'utf8');
const pdf=await readFile(new URL('lib/server/documents/factur-x/pdf-a3.ts',root),'utf8');
const migration=await readFile(new URL('supabase/migrations/20261003130000_strategic_gap_einvoice_endpoints_v1.sql',root),'utf8');
const requirements=await readFile(new URL('supabase/migrations/20261003162000_regulatory_document_requirements_v1.sql',root),'utf8');
const ublRoute=await readFile(new URL('app/api/documents/invoices/[id]/ubl/route.ts',root),'utf8');
const fxRoute=await readFile(new URL('app/api/documents/invoices/[id]/factur-x/route.ts',root),'utf8');

test('PEPPOL UBL serializer contains mandatory Billing 3.0 structure',()=>{
  for(const token of ['PEPPOL_CUSTOMIZATION_ID','PEPPOL_PROFILE_ID','AccountingSupplierParty','AccountingCustomerParty','EndpointID','TaxTotal','LegalMonetaryTotal','InvoiceLine'])assert.ok(ubl.includes(token),token);
  assert.match(ubl,/urn:oasis:names:specification:ubl:schema:xsd:Invoice-2/);
  assert.match(ubl,/urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0/);
  assert.match(ubl,/urn:fdc:peppol.eu:2017:poacc:billing:01:1.0/);
});

test('PEPPOL EAS validation and fail-closed mandatory reference rules are explicit',()=>{
  assert.match(ubl,/const EAS = new Set/);
  assert.match(ubl,/EAS\.has/);
  assert.match(ubl,/buyer reference.*required/i);
  assert.match(ubl,/empty XML elements are not permitted/i);
});

test('Factur-X CII targets BASIC 1.09.2 / EN16931',()=>{
  assert.match(cii,/CrossIndustryInvoice:100/);
  assert.match(cii,/ReusableAggregateBusinessInformationEntity:100/);
  assert.match(cii,/urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic/);
  assert.match(cii,/FACTUR_X_VERSION='1\.09\.2'/);
  assert.match(cii,/FACTUR_X_PROFILE='BASIC'/);
});

test('PDF/A-3 container embeds the Factur-X XML as Alternative with metadata and output intent',()=>{
  for(const token of ['/AFRelationship /Alternative','/EmbeddedFiles','factur-x.xml','/DestOutputProfile','pdfaid:part>3','pdfaid:conformance>B','urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#'])
    assert.ok(pdf.includes(token),token);
  assert.match(pdf,/1\.09\.2/);
  assert.match(pdf,/BASIC/);
});

test('e-invoice endpoint fields are database-backed and export routes are entitled',()=>{
  assert.match(migration,/e_invoice_endpoint_id/);
  assert.match(migration,/e_invoice_endpoint_scheme/);
  assert.match(migration,/e_invoice_endpoint_pair_chk/);
  assert.match(requirements,/invoices_buyer_reference_chk/);
  assert.match(ublRoute,/authenticateDocumentAccess/);
  assert.match(fxRoute,/authenticateDocumentAccess/);
});