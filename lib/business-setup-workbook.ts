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
  instructions.addRow(['Sheet / Section', 'Column / Topic', 'Required?', 'Definition, allowed values & safety rules']);
  const guide = [
    ['Purpose', 'Use this workbook to set up or port master data for the active business. It does not import invoices, bills, receipts, payments or historical transactions.'],
    ['Two-stage safety', 'Upload → Validate & Preview → correct every error → Commit setup. Preview stores only a temporary staging record; live business data changes only after commit.'],
    ['Sample rows', 'Replace every SAMPLE / REPLACE row with real data or delete that example row. Never commit sample names or sample account details.'],
    ['Business Profile', 'Exactly one populated data row. Business Name is required; blank optional fields leave existing business values unchanged.'],
    ['Bank & Accounts', 'Record Type is cash, bank, upi or account. Account Type is asset, liability, equity, income or expense. Normal Balance is debit or credit. Only one record may be primary.'],
    ['Customers', 'Name is required. Customer Opening Balance is the amount customers owe the business; use zero when not applicable.'],
    ['Vendors', 'Name is required. Vendor Opening Balance is the amount the business owes vendors; use zero when not applicable.'],
    ['Opening balances', 'Any non-zero account/customer/vendor opening balance requires an Opening Balance Date. Balances are posted together through one balanced opening journal. Import is blocked if balances were already posted for this business.'],
    ['Categories', 'Category is the root; Subcategory is optional and always belongs to the named parent category.'],
    ['Products & Services', 'Item Type must be product or service. Goods need Unit, HSN and opening stock. Services use SAC in HSN/SAC, default unit hrs and never receive stock.'],
    ['Tax Rate (%)', 'Enter a percentage from 0 to 100. A missing configured rate is created as a sales-tax rate at commit. Confirm your GST treatment before issuing statutory tax documents.'],
    ['Duplicate matching', 'Customers/vendors match by GSTIN when supplied, otherwise by name. Catalog items match by SKU when supplied, otherwise by exact name and type. Existing opening stock is never reset on re-import.'],
    ['Limits', 'Maximum 5,000 data rows per worksheet; workbook must be no larger than 15 MB. Invalid workbook content cannot be committed.'],
    ['Security', 'The workbook is imported only into the active business displayed in the wizard, after server-side permission and tenant checks. Keep this workbook private because it may contain customer, vendor and bank details.'],
  ];
  for (const [topic, instruction] of guide) instructions.addRow(['GENERAL', topic, '—', instruction]);

  const fieldDefinitions: Array<[string, string, string, string]> = [
    ['Business Profile','Business Name','Required','Trade name used by the workspace. Replace the sample placeholder.'],
    ['Business Profile','Legal Name','Optional','Registered legal name; blank preserves the existing value.'],
    ['Business Profile','Business Type','Optional','One of: sole_proprietorship, partnership, llp, private_limited, public_limited, trust, society, individual, other.'],
    ['Business Profile','Phone / Email / Website','Optional','Business contact details; email should be a valid address.'],
    ['Business Profile','GSTIN','Optional','15-character Indian GSTIN; format is validated.'],
    ['Business Profile','PAN','Optional','10-character PAN; format is validated.'],
    ['Business Profile','Address Line 1 / 2, City, State, PIN Code','Optional','Business address components. Blank values preserve existing address components.'],
    ['Business Profile','Country Code','Optional','Two-letter ISO country code, normally IN.'],
    ['Business Profile','Currency Code','Optional','Three-letter currency code, e.g. INR. Changing currency affects the business default.'],
    ['Business Profile','Time Zone','Optional','IANA time zone, e.g. Asia/Kolkata.'],
    ['Business Profile','Opening Balance Date','Required when balances are non-zero','Date in YYYY-MM-DD format. Required before customer, vendor or account opening balances can be posted.'],
    ['Bank & Accounts','Record Type','Required','One of: cash, bank, upi, account. Cash/bank/UPI create payment-capable account records.'],
    ['Bank & Accounts','Account Name','Required','Readable account / cash book / bank display name.'],
    ['Bank & Accounts','Account Code','Optional','Chart-of-accounts code. Existing code matches are reused; do not reuse a code for another account.'],
    ['Bank & Accounts','Account Type','Required for account rows','One of: asset, liability, equity, income, expense. Cash/bank/UPI must be debit-balance assets.'],
    ['Bank & Accounts','Normal Balance','Required for account rows','debit or credit, according to the chart of accounts.'],
    ['Bank & Accounts','Institution Name, Account Number, Account Holder, IFSC, Branch','Optional','Bank details. Account Number is stored in the business record; keep the workbook private.'],
    ['Bank & Accounts','Currency','Optional','Three-letter currency code; defaults to the business currency.'],
    ['Bank & Accounts','UPI ID','Required for UPI collection','UPI VPA used to enable UPI payment and QR settings.'],
    ['Bank & Accounts','Is Primary','Optional','true or false. Mark at most one row as primary.'],
    ['Bank & Accounts','Opening Balance','Optional','Non-negative number. Non-zero balances post through the opening balance journal and cannot be imported a second time.'],
    ['Bank & Accounts','Description','Optional','Internal account description.'],
    ['Customers','Name','Required','Customer display name. Duplicate names within this workbook are rejected.'],
    ['Customers','Legal Name, Phone, Email, GSTIN, Tax Type','Optional','Contact and tax profile. GSTIN format is validated when provided.'],
    ['Customers','Billing Address / Shipping Address','Optional','Address text for customer documents.'],
    ['Customers','Credit Limit','Optional','Non-negative number in the business currency.'],
    ['Customers','Payment Terms (Days)','Optional','Whole number, zero or greater.'],
    ['Customers','Opening Balance','Optional','Non-negative receivable amount. Requires an opening date and accounting permission.'],
    ['Customers','Notes','Optional','Internal notes.'],
    ['Vendors','Name','Required','Supplier display name. Duplicate names within this workbook are rejected.'],
    ['Vendors','Legal Name, Contact Person, Phone, Email, GSTIN, Tax Type','Optional','Supplier contact and tax profile. GSTIN format is validated when provided.'],
    ['Vendors','Address','Optional','Supplier address text.'],
    ['Vendors','Payment Terms (Days)','Optional','Whole number, zero or greater.'],
    ['Vendors','Opening Balance','Optional','Non-negative payable amount. Requires an opening date and accounting permission.'],
    ['Vendors','Notes','Optional','Internal notes.'],
    ['Categories','Category','Required','Parent/root product or service category.'],
    ['Categories','Subcategory','Optional','Child category linked under the Category in the same row.'],
    ['Categories','Description','Optional','Category or subcategory description.'],
    ['Categories','Default HSN/SAC','Optional','Default classification code inherited by catalog items where applicable.'],
    ['Categories','Tax Rate (%)','Optional','0–100. Non-zero rates are resolved or created as a sales-tax rate at commit.'],
    ['Products & Services','Item Type','Required','product or service. Products are inventory-trackable; services never create stock.'],
    ['Products & Services','SKU / Item Code','Optional but recommended','Unique business-scoped code; import matches this field first for existing catalog items.'],
    ['Products & Services','Name','Required','Product/service name. Used with Item Type if SKU is blank.'],
    ['Products & Services','HSN/SAC','Required','HSN for goods or SAC for services.'],
    ['Products & Services','Unit','Required for products','Unit such as pcs, kg, box. Services default to hrs when blank.'],
    ['Products & Services','Sale Price / Purchase Price','Optional','Non-negative numeric amounts in the business currency.'],
    ['Products & Services','Tax Rate (%)','Optional','0–100; resolves to an active sales-tax rate or creates one at commit.'],
    ['Products & Services','Opening Stock','Optional for goods; zero for services','Non-negative quantity. Applied only to newly created goods; re-import never adds stock to an existing item.'],
    ['Products & Services','Opening Stock Cost','Optional','Total cost for the opening quantity. If omitted, purchase price × quantity is used.'],
    ['Products & Services','Reorder Level','Optional','Non-negative stock threshold for reorder attention.'],
    ['Products & Services','Barcode / Description','Optional','Barcode identifier and item details.'],
    ['Products & Services','Sell Enabled / Purchase Enabled / Active','Optional','true or false. Blank values use safe defaults where defined.'],
  ];
  for (const row of fieldDefinitions) instructions.addRow(row);
  setSheetStyle(instructions, 'FF0F766E');
  instructions.columns = [{ width: 25 }, { width: 34 }, { width: 28 }, { width: 105 }];
  for (let row = 2; row <= instructions.rowCount; row += 1) {
    instructions.getRow(row).alignment = { wrapText: true, vertical: 'top' };
    instructions.getRow(row).height = 34;
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
  const sheetCounts: Array<[string, number]> = [
    [SHEET_NAMES.bank, bank_accounts.length], [SHEET_NAMES.customers, customers.length],
    [SHEET_NAMES.vendors, vendors.length], [SHEET_NAMES.categories, categories.length],
    [SHEET_NAMES.products, products_services.length],
  ];
  const oversized = sheetCounts.find(([, count]) => count > 5000);
  if (oversized) throw new Error('Worksheet "' + oversized[0] + '" contains ' + oversized[1] + ' data rows; maximum is 5,000 per worksheet.');
  return { profile, bank_accounts, customers, vendors, categories, products_services };
}
