export type BusinessSetupRow = { [key: string]: string | number | undefined; _sheet_row?: number };
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
  ['gstin','GSTIN'],['pan','PAN'],['phone','Phone'],['email','Email'],
  ['address_line_1','Address Line 1'],['city','City'],['state','State'],['postal_code','PIN Code'],
  ['country_code','Country Code'],['currency_code','Currency Code'],['timezone','Time Zone'],
  ['opening_balance_date','Opening Balance Date'],
] as const;
const BANK_COLUMNS = [
  ['record_type','Record Type'],['account_name','Account Name'],['account_code','Account Code'],
  ['institution_name','Bank / Institution'],['account_number','Account Number'],
  ['account_holder_name','Account Holder'],['ifsc_code','IFSC'],['upi_id','UPI ID'],
  ['is_primary','Primary?'],['opening_balance','Opening Balance'],
  ['account_type','Account Type'],['normal_balance','Normal Balance'],['currency_code','Currency'],
] as const;
const CUSTOMER_COLUMNS = [
  ['name','Name'],['phone','Phone'],['email','Email'],['gstin','GSTIN'],
  ['billing_address','Billing Address'],['opening_balance','Opening Balance'],
  ['payment_terms_days','Payment Terms (Days)'],
] as const;
const VENDOR_COLUMNS = [
  ['name','Name'],['contact_person_name','Contact Person'],['phone','Phone'],['email','Email'],
  ['gstin','GSTIN'],['address','Address'],['opening_balance','Opening Balance'],
  ['payment_terms_days','Payment Terms (Days)'],
] as const;
const CATEGORY_COLUMNS = [
  ['category','Category'],['subcategory','Subcategory'],['description','Description'],
] as const;
const PRODUCT_COLUMNS = [
  ['category','Category'],['subcategory','Subcategory'],['item_type','Type (product/service)'],
  ['sku','SKU / Item Code'],['name','Name'],['hsn_sac','HSN / SAC'],['unit','Unit'],
  ['sales_price','Sale Price'],['purchase_price','Purchase Price'],['tax_rate','Tax Rate (%)'],
  ['opening_stock','Opening Stock'],['opening_stock_cost','Opening Stock Cost'],['description','Description'],
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
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
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
  instructions.addRow(['Section', 'Required columns', 'Optional columns', 'What to enter']);
  const guide = [
    ['START HERE', '—', '—', 'Use one row per record. Replace sample rows or delete them. Do not change worksheet names. You may leave a master sheet empty if you have no records for it.'],
    ['VALIDATE FIRST', '—', '—', 'Upload this workbook and click Validate & Preview. Fix every reported error before Commit. Preview does not modify live business data.'],
    ['BUSINESS PROFILE', 'Business Name', 'Legal Name, Business Type, GSTIN, PAN, Phone, Email, Address, City, State, PIN Code, Country, Currency, Time Zone, Opening Balance Date', 'Exactly one row. Blank optional fields preserve existing profile values. GSTIN and PAN formats are checked.'],
    ['BANK & ACCOUNTS', 'Record Type, Account Name', 'Account Code, Bank / Institution, Account Number, Account Holder, IFSC, UPI ID, Primary?, Opening Balance, Account Type, Normal Balance, Currency', 'Record Type: cash, bank, upi or account. For account rows, Account Type is asset/liability/equity/income/expense and Normal Balance is debit/credit. Mark only one row Primary.'],
    ['CUSTOMERS', 'Name', 'Phone, Email, GSTIN, Billing Address, Opening Balance, Payment Terms (Days)', 'One row per customer. GSTIN is used to match existing customers when supplied; otherwise the name is used.'],
    ['VENDORS', 'Name', 'Contact Person, Phone, Email, GSTIN, Address, Opening Balance, Payment Terms (Days)', 'One row per supplier. GSTIN is used to match existing vendors when supplied; otherwise the name is used.'],
    ['CATEGORIES', 'Category', 'Subcategory, Description', 'One row per parent/subcategory pair. Leave Subcategory blank for a parent-only category.'],
    ['PRODUCTS & SERVICES', 'Category, Type, Name, HSN / SAC', 'Subcategory, SKU, Unit, Sale Price, Purchase Price, Tax Rate (%), Opening Stock, Opening Stock Cost, Description', 'Type is product or service. Unit is required for products; services default to hrs. Services must have zero Opening Stock. Existing products match by SKU, otherwise name and type.'],
    ['OPENING BALANCES', '—', 'Opening Balance Date in Business Profile; balances in Bank, Customers or Vendors', 'Opening balances must be non-negative, dated, and posted by a user with accounting permission. The system creates one balanced opening journal. If already posted, use an adjustment workflow instead of importing again.'],
    ['OPENING STOCK', '—', 'Opening Stock and Opening Stock Cost on new products', 'Stock is initialized only when a new product is created. Re-import never adds or resets stock for an existing product.'],
    ['TAX', '—', 'Tax Rate (%)', 'Use a percentage from 0 to 100. Missing rates are created as sales-tax rates at commit. Confirm your GST treatment before issuing tax documents.'],
    ['DUPLICATES', '—', '—', 'Duplicate names/SKUs within a worksheet are rejected. Preview checks records already in the active business.'],
    ['LIMITS & PRIVACY', '—', '—', 'Maximum 5,000 rows per data worksheet and 15 MB per workbook. Keep the file private; it can contain customer, supplier and bank data. Secret credentials are never required.'],
  ];
  for (const row of guide) instructions.addRow(row);
  setSheetStyle(instructions, 'FF0F766E');
  instructions.columns = [{ width: 23 }, { width: 32 }, { width: 58 }, { width: 90 }];
  for (let row = 2; row <= instructions.rowCount; row += 1) {
    instructions.getRow(row).alignment = { wrapText: true, vertical: 'top' };
    instructions.getRow(row).height = 48;
  }

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

function parseRows(
  sheet: any,
  aliases: Record<string, string>,
  sheetKey: string,
  requiredFields: string[],
): BusinessSetupRow[] {
  if (!sheet) throw new Error('Workbook is missing worksheet: ' + sheetKey);
  if (sheet.rowCount < 1) throw new Error('Worksheet ' + sheetKey + ' is empty.');
  const headers = new Map<string, number>();
  const header = sheet.getRow(1);
  for (let i = 1; i <= Math.max(header.cellCount, sheet.columnCount); i += 1) {
    const alias = aliases[keyText(header.getCell(i).value)];
    if (alias && !headers.has(alias)) headers.set(alias, i);
  }
  const missing = requiredFields.filter((key) => !headers.has(key));
  if (missing.length) {
    throw new Error('Worksheet ' + sheetKey + ' is missing required columns: ' + missing.join(', ') + '. Download the sample template or include these mandatory columns.');
  }
  const rows: BusinessSetupRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = Array.from(headers.values()).map((column) => cellText(row.getCell(column).value));
    if (values.every((value) => value === '')) continue;
    const result: BusinessSetupRow = { _sheet_row: rowNumber };
    for (const [key, column] of headers) result[key] = cellText(row.getCell(column).value);
    rows.push(result);
  }
  return rows;
}

const PROFILE_ALIASES: Record<string,string> = {
  businessname:'business_name',companyname:'business_name',tradename:'business_name',tradingname:'business_name',legalname:'legal_name',businesstype:'business_type',
  phone:'phone',email:'email',website:'website',gstin:'gstin',pan:'pan',addressline1:'address_line_1',
  addressline2:'address_line_2',address:'address_line_1',street:'address_line_1',city:'city',state:'state',province:'state',pincode:'postal_code',postalcode:'postal_code',zip:'postal_code',zipcode:'postal_code',
  countrycode:'country_code',currencycode:'currency_code',timezone:'timezone',openingbalancdate:'opening_balance_date',
  openingbalancedate:'opening_balance_date',
};
const BANK_ALIASES: Record<string,string> = {
  recordtype:'record_type',accountname:'account_name',accountcode:'account_code',accounttype:'account_type',
  normalbalance:'normal_balance',institutionname:'institution_name',accountnumber:'account_number',
  accountholder:'account_holder_name',accountholdername:'account_holder_name',ifsc:'ifsc_code',ifsccode:'ifsc_code',bankinstitution:'institution_name',institution:'institution_name',primary:'is_primary',bankinstitution:'institution_name',institution:'institution_name',primary:'is_primary',
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
  category:'category',subcategory:'subcategory',typeproductservice:'item_type',itemtypeproductservice:'item_type',itemtype:'item_type',type:'item_type',
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
  const profileRows = parseRows(workbook.getWorksheet(SHEET_NAMES.profile), PROFILE_ALIASES, SHEET_NAMES.profile, ['business_name']);
  if (profileRows.length !== 1) throw new Error('Business Profile must contain exactly one populated row.');
  const profile = profileRows[0];
  const bank_accounts = parseRows(workbook.getWorksheet(SHEET_NAMES.bank), BANK_ALIASES, SHEET_NAMES.bank, ['record_type','account_name']);
  const customers = parseRows(workbook.getWorksheet(SHEET_NAMES.customers), CUSTOMER_ALIASES, SHEET_NAMES.customers, ['name']);
  const vendors = parseRows(workbook.getWorksheet(SHEET_NAMES.vendors), VENDOR_ALIASES, SHEET_NAMES.vendors, ['name']);
  const categories = parseRows(workbook.getWorksheet(SHEET_NAMES.categories), CATEGORY_ALIASES, SHEET_NAMES.categories, ['category']);
  const products_services = parseRows(workbook.getWorksheet(SHEET_NAMES.products), PRODUCT_ALIASES, SHEET_NAMES.products, ['category','item_type','name','hsn_sac']);
  const sheetCounts: Array<[string, number]> = [
    [SHEET_NAMES.bank, bank_accounts.length], [SHEET_NAMES.customers, customers.length],
    [SHEET_NAMES.vendors, vendors.length], [SHEET_NAMES.categories, categories.length],
    [SHEET_NAMES.products, products_services.length],
  ];
  const oversized = sheetCounts.find(([, count]) => count > 5000);
  if (oversized) throw new Error('Worksheet "' + oversized[0] + '" contains ' + oversized[1] + ' data rows; maximum is 5,000 per worksheet.');
  return { profile, bank_accounts, customers, vendors, categories, products_services };
}
