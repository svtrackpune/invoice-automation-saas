export type BusinessSetupRow = Record<string, string> & { _sheet_row?: number };
export type BusinessSetupPayload = {
  profile: BusinessSetupRow;
  bank_accounts: BusinessSetupRow[];
  customers: BusinessSetupRow[];
  vendors: BusinessSetupRow[];
  categories: BusinessSetupRow[];
  products_services: BusinessSetupRow[];
};
export type BusinessSetupWorkbookData = BusinessSetupPayload;

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PROFILE_COLUMNS = [
  ['business_name','Business Name'],['legal_name','Legal Name'],['business_type','Business Type'],
  ['phone','Phone'],['email','Email'],['website','Website'],['gstin','GSTIN'],['pan','PAN'],
  ['address_line_1','Address Line 1'],['address_line_2','Address Line 2'],['city','City'],
  ['state','State'],['postal_code','PIN Code'],['country_code','Country Code'],
  ['currency_code','Currency Code'],['timezone','Time Zone'],['opening_balance_date','Opening Balance Date'],
] as const;
const BANK_COLUMNS = [
  ['record_type','Record Type'],['account_name','Account Name'],['account_code','Account Code'],
  ['account_type','Account Type'],['normal_balance','Normal Balance'],['institution_name','Institution Name'],
  ['account_number','Account Number'],['account_holder_name','Account Holder'],['ifsc_code','IFSC'],
  ['branch_name','Branch'],['currency_code','Currency'],['upi_id','UPI ID'],['is_primary','Is Primary'],
  ['opening_balance','Opening Balance'],['description','Description'],
] as const;
const CUSTOMER_COLUMNS = [
  ['name','Name'],['legal_name','Legal Name'],['phone','Phone'],['email','Email'],['gstin','GSTIN'],
  ['tax_type','Tax Type'],['billing_address','Billing Address'],['shipping_address','Shipping Address'],
  ['credit_limit','Credit Limit'],['payment_terms_days','Payment Terms (Days)'],
  ['opening_balance','Opening Balance'],['notes','Notes'],
] as const;
const VENDOR_COLUMNS = [
  ['name','Name'],['legal_name','Legal Name'],['contact_person_name','Contact Person'],['phone','Phone'],
  ['email','Email'],['gstin','GSTIN'],['tax_type','Tax Type'],['address','Address'],
  ['payment_terms_days','Payment Terms (Days)'],['opening_balance','Opening Balance'],['notes','Notes'],
] as const;
const CATEGORY_COLUMNS = [
  ['category','Category'],['subcategory','Subcategory'],['description','Description'],
  ['default_hsn_sac','Default HSN/SAC'],['tax_rate','Tax Rate (%)'],
] as const;
const PRODUCT_COLUMNS = [
  ['category','Category'],['subcategory','Subcategory'],['item_type','Item Type (product/service)'],
  ['sku','SKU / Item Code'],['name','Name'],['hsn_sac','HSN/SAC'],['unit','Unit'],
  ['sales_price','Sale Price'],['purchase_price','Purchase Price'],['tax_rate','Tax Rate (%)'],
  ['opening_stock','Opening Stock'],['opening_stock_cost','Opening Stock Cost'],
  ['reorder_level','Reorder Level'],['barcode','Barcode'],['description','Description'],
  ['sell_enabled','Sell Enabled'],['purchase_enabled','Purchase Enabled'],['is_active','Active'],
] as const;

const SHEET_NAMES = {
  instructions: '0. Instructions & Legend',
  profile: '1. Business Profile',
  bank: '2. Bank & Accounts',
  customers: '3. Customers',
  vendors: '4. Vendors',
  categories: '5. Categories',
  products: '6. Products & Services',
} as const;

function downloadWorkbook(buffer: unknown, filename: string) {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : buffer instanceof Uint8Array
      ? buffer
      : new Uint8Array(buffer as ArrayBuffer);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setSheetStyle(sheet: any, color = 'FF4F46E5') {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 32;
  sheet.views = [{ state: '', ySplit: 1 }];
  if (sheet.rowCount > 0 && sheet.columnCount > 0) {
    sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address };
  }
  for (let index = 1; index <= sheet.columnCount; index += 1) {
    const label = String(sheet.getRow(1).getCell(index).value || '');
    sheet.getColumn(index).width = Math.min(36, Math.max(14, label.length + 3));
  }
}

function addRowsSheet(workbook: any, name: string, columns: readonly (readonly [string, string])[], rows: Record<string, unknown>[]) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(columns.map((column) => column[1]));
  for (const row of rows) sheet.addRow(columns.map((column) => normalizeValue(row[column[0]])));
  setSheetStyle(sheet);
  return sheet;
}

function normalizeValue(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  return JSON.stringify(value);
}

function samplePayload(): BusinessSetupPayload {
  return {
    profile: {
      business_name: 'REPLACE WITH YOUR BUSINESS NAME',
      legal_name: '', business_type: '', phone: '', email: '', website: '',
      gstin: '', pan: '', address_line_1: '', address_line_2: '', city: '',
      state: '', postal_code: '', country_code: '', currency_code: '',
      timezone: '', opening_balance_date: '',
    },
    bank_accounts: [
      { record_type: 'cash', account_name: 'SAMPLE CASH BOOK - REPLACE OR DELETE', account_code: '1000', account_type: 'asset', normal_balance: 'debit', currency_code: 'INR', is_primary: 'true', opening_balance: '0', description: 'Example only' },
      { record_type: 'bank', account_name: 'SAMPLE BANK ACCOUNT - REPLACE OR DELETE', account_code: '1010-0001', account_type: 'asset', normal_balance: 'debit', institution_name: 'Example Bank', account_number: '', account_holder_name: '', ifsc_code: '', branch_name: '', currency_code: 'INR', upi_id: '', is_primary: 'false', opening_balance: '0', description: 'Example only' },
    ],
    customers: [
      { name: 'SAMPLE CUSTOMER - REPLACE OR DELETE', legal_name: '', phone: '', email: '', gstin: '', tax_type: '', billing_address: '', shipping_address: '', credit_limit: '0', payment_terms_days: '0', opening_balance: '0', notes: 'Example only' },
    ],
    vendors: [
      { name: 'SAMPLE VENDOR - REPLACE OR DELETE', legal_name: '', contact_person_name: '', phone: '', email: '', gstin: '', tax_type: '', address: '', payment_terms_days: '0', opening_balance: '0', notes: 'Example only' },
    ],
    categories: [
      { category: 'SAMPLE CATEGORY - REPLACE OR DELETE', subcategory: 'SAMPLE SUBCATEGORY', description: 'Example only', default_hsn_sac: '', tax_rate: '0' },
    ],
    products_services: [
      { category: 'SAMPLE CATEGORY - REPLACE OR DELETE', subcategory: 'SAMPLE SUBCATEGORY', item_type: 'product', sku: 'SAMPLE-001', name: 'SAMPLE PRODUCT - REPLACE OR DELETE', hsn_sac: '0000', unit: 'pcs', sales_price: '100', purchase_price: '60', tax_rate: '0', opening_stock: '0', opening_stock_cost: '0', reorder_level: '0', barcode: '', description: 'Example only', sell_enabled: 'true', purchase_enabled: 'true', is_active: 'true' },
      { category: 'SAMPLE CATEGORY - REPLACE OR DELETE', subcategory: 'SAMPLE SUBCATEGORY', item_type: 'service', sku: 'SAMPLE-SRV-001', name: 'SAMPLE SERVICE - REPLACE OR DELETE', hsn_sac: '0000', unit: 'hrs', sales_price: '500', purchase_price: '0', tax_rate: '0', opening_stock: '0', opening_stock_cost: '0', reorder_level: '0', barcode: '', description: 'Example only', sell_enabled: 'true', purchase_enabled: 'false', is_active: 'true' },
    ],
  };
}

async function makeWorkbook(data: BusinessSetupWorkbookData) {
  const { default: ExcelJS } = await import('@andreeewill/exceljs/dist/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Moneymatters';
  workbook.lastModifiedBy = 'Moneymatters';
  workbook.created = new Date();
  workbook.modified = new Date();

  const instructions = workbook.addWorksheet(SHEET_NAMES.instructions);
  instructions.addRow(['Topic', 'Instructions']);
  const guide = [
    ['Purpose', 'Use this workbook to set up or port master data for the active business. It does not import invoices, bills, payments, or historical transactions.'],
    ['Two-stage safety', 'Upload → Validate & Preview → correct every error → Commit setup. No business data changes during preview.'],
    ['Mandatory fields', 'Replace all rows marked SAMPLE or REPLACE. Do not leave the sample rows in the file.'],
    ['Business Profile', 'One row only. Business Name is required. Blank optional fields leave existing values unchanged.'],
    ['Bank & Accounts', 'Record Type is cash, bank, upi, or account. Account Type is asset, liability, equity, income, or expense. Normal Balance is debit or credit.'],
    ['Customers', 'Name is required. Opening Balance is the amount the customer owes the business; use zero when not applicable.'],
    ['Vendors', 'Name is required. Opening Balance is the amount the business owes the vendor; use zero when not applicable.'],
    ['Opening balances', 'If any opening balance is non-zero, provide one Opening Balance Date in Business Profile. Balances are posted as one balanced opening journal using the system Opening Balance Equity account.'],
    ['Categories', 'Category is the parent category. Subcategory is optional and is linked to that category.'],
    ['Products & Services', 'Item Type must be product or service. Goods need Unit, HSN and opening stock. Services use SAC in HSN/SAC, default unit hrs, and no stock.'],
    ['Tax Rate (%)', 'Use a configured GST rate where possible. If a rate is not present, the import will create a generic sales tax rate with that percentage. Confirm your GST treatment before issuing tax documents.'],
    ['Duplicate matching', 'Customers/vendors are matched by GSTIN when supplied, otherwise by exact name. Products are matched by SKU when supplied, otherwise by exact name and type.'],
    ['Stock safety', 'Opening stock is set only for newly created goods. Re-importing matched items never resets or adds stock again.'],
    ['Data safety', 'Maximum 5,000 data rows per workbook. Invalid workbook data cannot be committed. Fix errors and validate again.'],
    ['Security', 'The file is imported only into the currently selected business after server-side permission and tenant checks.'],
  ];
  for (const row of guide) instructions.addRow(row);
  setSheetStyle(instructions, 'FF0F766E');
  instructions.columns = [{ width: 28 }, { width: 105 }];
  instructions.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  for (let row = 2; row <= instructions.rowCount; row += 1) instructions.getRow(row).height = 36;

  const profileSheet = addRowsSheet(workbook, SHEET_NAMES.profile, PROFILE_COLUMNS, [data.profile])
  profileSheet.getCell('C2').dataValidation = { type: 'list', allowBlank: true, formulae: ['"sole_proprietorship,partnership,llp,private_limited,public_limited,trust,society,individual,other"'] };
  const bank = addRowsSheet(workbook, SHEET_NAMES.bank, BANK_COLUMNS, data.bank_accounts);
  bank.getColumn(14).numFmt = '#,##0.00';
  addRowsSheet(workbook, SHEET_NAMES.customers, CUSTOMER_COLUMNS, data.customers);
  addRowsSheet(workbook, SHEET_NAMES.vendors, VENDOR_COLUMNS, data.vendors);
  const categories = addRowsSheet(workbook, SHEET_NAMES.categories, CATEGORY_COLUMNS, data.categories);
  categories.getColumn(5).numFmt = '0.##';
  const products = addRowsSheet(workbook, SHEET_NAMES.products, PRODUCT_COLUMNS, data.products_services);
  for (const index of [8, 9, 12, 13]) products.getColumn(index).numFmt = '#,##0.00';
  products.getColumn(10).numFmt = '0.##';
  products.getColumn(11).numFmt = '#,##0.###';
  for (const sheet of [bank, categories, products]) {
    sheet.eachRow((row: any, rowNumber: number) => {
      if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true };
    });
  }
  return workbook;
}

export async function downloadBusinessSetupTemplate() {
  const workbook = await makeWorkbook(samplePayload());
  const buffer = await workbook.xlsx.writeBuffer();
  downloadWorkbook(buffer, 'Moneymatters-Sample-Business-Setup-Template.xlsx');
}

export async function downloadBusinessSetupWorkbook(companyName: string, data: BusinessSetupWorkbookData) {
  const workbook = await makeWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  const slug = companyName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'Business';
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadWorkbook(buffer, slug + '-Business-Setup-' + stamp + '.xlsx');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) return record.richText.map(part => cellText((part as Record<string, unknown>).text)).join('').trim();
    if (typeof record.text === 'string') return record.text.trim();
    if ('result' in record) return cellText(record.result);
  }
  return String(value).trim();
}
function keyText(value: unknown) { return cellText(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function parseRows(sheet: any, aliases: Record<string, string>, sheetKey: string): BusinessSetupRow[] {
  if (!sheet) throw new Error('Workbook is missing worksheet: ' + sheetKey);
  if (sheet.rowCount < 1) throw new Error('Worksheet ' + sheetKey + ' is empty.');
  const headers = new Map<string, number>();
  const header = sheet.getRow(1);
  for (let i = 1; i <= Math.max(header.cellCount, sheet.columnCount); i += 1) {
    const alias = aliases[keyText(header.getCell(i).value)];
    if (alias && !headers.has(alias)) headers.set(alias, i);
  }
  const required = Object.values(aliases).filter((value, i, all) => all.indexOf(value) === i);
  const missing = required.filter(key => !headers.has(key));
  if (missing.length) throw new Error('Worksheet ' + sheetKey + ' is missing required columns: ' + missing.join(', ') + '. Download a fresh template and keep the header row intact.');
  const rows: BusinessSetupRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = Array.from(headers.values()).map(column => cellText(row.getCell(column).value));
    if (values.every(value => value === '')) continue;
    const result: BusinessSetupRow = { _sheet_row: rowNumber };
    for (const [key, column] of headers) result[key] = cellText(row.getCell(column).value);
    rows.push(result);
  }
  return rows;
}

const PROFILE_ALIASES: Record<string,string> = {
  businessname:'business_name',tradename:'business_name',legalname:'legal_name',businesstype:'business_type',
  phone:'phone',email:'email',website:'website',gstin:'gstin',pan:'pan',addressline1:'address_line_1',
  addressline2:'address_line_2',city:'city',state:'state',pincode:'postal_code',postalcode:'postal_code',
  countrycode:'country_code',currencycode:'currency_code',timezone:'timezone',openingbalancdate:'opening_balance_date',
  openingbalancedate:'opening_balance_date',
};
const BANK_ALIASES: Record<string,string> = {
  recordtype:'record_type',accountname:'account_name',accountcode:'account_code',accounttype:'account_type',
  normalbalance:'normal_balance',institutionname:'institution_name',accountnumber:'account_number',
  accountholder:'account_holder_name',accountholdername:'account_holder_name',ifsc:'ifsc_code',ifsccode:'ifsc_code',
  branch:'branch_name',branchname:'branch_name',currency:'currency_code',currencycode:'currency_code',
  upiid:'upi_id',isprimary:'is_primary',openingbalance:'opening_balance',description:'description',
};
const CUSTOMER_ALIASES: Record<string,string> = {
  name:'name',displayname:'name',legalname:'legal_name',phone:'phone',email:'email',gstin:'gstin',
  taxid:'gstin',taxtype:'tax_type',billingaddress:'billing_address',shippingaddress:'shipping_address',
  creditlimit:'credit_limit',paymenttermsdays:'payment_terms_days',openingbalance:'opening_balance',notes:'notes',
};
const VENDOR_ALIASES: Record<string,string> = {
  name:'name',displayname:'name',legalname:'legal_name',contactperson:'contact_person_name',
  contactpersonname:'contact_person_name',phone:'phone',email:'email',gstin:'gstin',taxid:'gstin',
  taxtype:'tax_type',address:'address',paymenttermsdays:'payment_terms_days',openingbalance:'opening_balance',notes:'notes',
};
const CATEGORY_ALIASES: Record<string,string> = {
  category:'category',subcategory:'subcategory',description:'description',defaulthsnsac:'default_hsn_sac',
  hsnsac:'default_hsn_sac',taxrate:'tax_rate',taxratepercent:'tax_rate',
};
const PRODUCT_ALIASES: Record<string,string> = {
  category:'category',subcategory:'subcategory',itemtypeproductservice:'item_type',itemtype:'item_type',type:'item_type',
  itemcodesku:'sku',itemcode:'sku',skuitemcode:'sku',sku:'sku',name:'name',itemname:'name',hsnsac:'hsn_sac',unit:'unit',
  saleprice:'sales_price',salesprice:'sales_price',purchaseprice:'purchase_price',taxrate:'tax_rate',
  taxratepercent:'tax_rate',openingstock:'opening_stock',openingstockcost:'opening_stock_cost',
  reorderlevel:'reorder_level',barcode:'barcode',description:'description',sellenabled:'sell_enabled',
  purchaseenabled:'purchase_enabled',active:'is_active',isactive:'is_active',
};

export async function parseBusinessSetupWorkbook(file: File): Promise<BusinessSetupPayload> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Upload an .xlsx workbook downloaded from Download Sample Business Setup Template.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Workbook exceeds 15 MB. Split large master lists before importing.');
  const { default: ExcelJS } = await import('@andreeewill/exceljs/dist/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const expected = Object.values(SHEET_NAMES);
  for (const name of expected) if (!workbook.getWorksheet(name)) throw new Error('Workbook is missing required worksheet "' + name + '". Download a fresh template.');
  const profileRows = parseRows(workbook.getWorksheet(SHEET_NAMES.profile), Object.fromEntries(PROFILE_COLUMNS.map(([key,label]) => [keyText(label), key])), SHEET_NAMES.profile);
  if (profileRows.length !== 1) throw new Error('Business Profile must contain exactly one populated row.');
  const profile = profileRows[0];
  const bank_accounts = parseRows(workbook.getWorksheet(SHEET_NAMES.bank), BANK_ALIASES, SHEET_NAMES.bank);
  const customers = parseRows(workbook.getWorksheet(SHEET_NAMES.customers), CUSTOMER_ALIASES, SHEET_NAMES.customers);
  const vendors = parseRows(workbook.getWorksheet(SHEET_NAMES.vendors), VENDOR_ALIASES, SHEET_NAMES.vendors);
  const categories = parseRows(workbook.getWorksheet(SHEET_NAMES.categories), CATEGORY_ALIASES, SHEET_NAMES.categories);
  const products_services = parseRows(workbook.getWorksheet(SHEET_NAMES.products), PRODUCT_ALIASES, SHEET_NAMES.products);
  const count = bank_accounts.length + customers.length + vendors.length + categories.length + products_services.length;
  if (count > 5000) throw new Error('Workbook contains ' + count + ' data rows; maximum is 5,000.');
  return { profile, bank_accounts, customers, vendors, categories, products_services };
}
