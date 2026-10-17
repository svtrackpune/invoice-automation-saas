export type CatalogImportRow = {
  _sheet_row: number;
  category: string;
  subcategory: string;
  type: string;
  item_name: string;
  sku: string;
  hsn_sac: string;
  unit: string;
  sale_price: string;
  purchase_price: string;
  tax_rate: string;
  opening_stock: string;
  description: string;
};

export type CatalogExportRow = {
  category: string;
  subcategory: string;
  item_type: string;
  sku: string;
  name: string;
  hsn_sac: string;
  unit: string;
  sales_price: number;
  purchase_price: number;
  tax_rate: number;
  stock: number | string;
  status: string;
};

export const CATALOG_IMPORT_HEADERS = [
  'Category', 'Subcategory', 'Type (product/service)', 'Item Name',
  'Item Code / SKU', 'HSN / SAC', 'Unit', 'Sale Price', 'Purchase Price',
  'Tax Rate (%)', 'Opening Stock', 'Description',
] as const;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function downloadWorkbook(buffer: unknown, filename: string) {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : buffer instanceof Uint8Array
      ? buffer
      : new Uint8Array(buffer as ArrayBuffer);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: XLSX_MIME });
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

function styleHeader(sheet: { getRow: (row: number) => { font: unknown; height: number; fill: unknown; alignment: unknown }; views: unknown[] }) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  row.height = 28;
  row.alignment = { vertical: 'middle', wrapText: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function downloadCatalogSampleTemplate() {
  const { default: ExcelJS } = await import('@andreeewill/exceljs/dist/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Moneymatters';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Catalog Template');
  sheet.addRow([...CATALOG_IMPORT_HEADERS]);
  sheet.addRows([
    ['Men\'s Apparel', 'Jeans', 'product', 'Slim Denim Blue', 'JNS-001', '6203', 'pcs', 899, 550, 18, 50, '100% Cotton stretch denim'],
    ['IT Services', 'Consulting', 'service', 'Cloud Deployment', 'SRV-001', '9983', 'hrs', 1500, 0, 18, 0, 'Plesk & Cloud setup'],
  ]);
  styleHeader(sheet);
  sheet.autoFilter = { from: 'A1', to: 'L3' };
  sheet.columns = [
    { width: 22 }, { width: 20 }, { width: 22 }, { width: 28 },
    { width: 20 }, { width: 15 }, { width: 12 }, { width: 14 },
    { width: 16 }, { width: 15 }, { width: 16 }, { width: 38 },
  ];
  sheet.getColumn(8).numFmt = '#,##0.00';
  sheet.getColumn(9).numFmt = '#,##0.00';
  sheet.getColumn(10).numFmt = '0.##';
  sheet.getColumn(11).numFmt = '#,##0.###';
  sheet.getRow(2).height = 30;
  sheet.getRow(3).height = 30;
  const buffer = await workbook.xlsx.writeBuffer();
  downloadWorkbook(buffer, 'Catalog-Migration-Template.xlsx');
}

function textCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => textCell((part as Record<string, unknown>).text)).join('').trim();
    }
    if (typeof record.text === 'string') return record.text.trim();
    if ('result' in record) return textCell(record.result);
  }
  return String(value).trim();
}

function normalizedHeader(value: unknown): string {
  return textCell(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_KEYS: Record<string, keyof Omit<CatalogImportRow, '_sheet_row'>> = {
  category: 'category', subcategory: 'subcategory', typeproductservice: 'type',
  type: 'type', itemtype: 'type', itemname: 'item_name', name: 'item_name',
  itemcodesku: 'sku', itemcode: 'sku', sku: 'sku', hsnsac: 'hsn_sac',
  hsn: 'hsn_sac', sac: 'hsn_sac', unit: 'unit', saleprice: 'sale_price',
  salesprice: 'sale_price', purchaseprice: 'purchase_price', taxrate: 'tax_rate',
  taxratepercent: 'tax_rate', openingstock: 'opening_stock', description: 'description',
};

export async function parseCatalogImportWorkbook(file: File): Promise<CatalogImportRow[]> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Upload an .xlsx Excel workbook downloaded from the catalog migration template.');
  if (file.size > 10 * 1024 * 1024) throw new Error('The workbook is larger than 10 MB. Split the catalog into smaller files.');
  const { default: ExcelJS } = await import('@andreeewill/exceljs/dist/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('The workbook must contain a header row and at least one catalog row.');

  const headerRow = sheet.getRow(1);
  const columnByKey = new Map<string, number>();
  for (let column = 1; column <= Math.max(headerRow.cellCount, sheet.columnCount); column += 1) {
    const key = HEADER_KEYS[normalizedHeader(headerRow.getCell(column).value)];
    if (key && !columnByKey.has(key)) columnByKey.set(key, column);
  }
  const requiredKeys: Array<keyof Omit<CatalogImportRow, '_sheet_row'>> = [
    'category', 'subcategory', 'type', 'item_name', 'sku', 'hsn_sac',
    'unit', 'sale_price', 'purchase_price', 'tax_rate', 'opening_stock', 'description',
  ];
  if (requiredKeys.some((key) => !columnByKey.has(key))) {
    throw new Error('Template columns are missing or renamed. Download the current template and retain all headers.');
  }

  const rows: CatalogImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = requiredKeys.map((key) => textCell(row.getCell(columnByKey.get(key) as number).value));
    if (values.every((value) => value === '')) continue;
    const pick = (key: keyof Omit<CatalogImportRow, '_sheet_row'>) => textCell(row.getCell(columnByKey.get(key) as number).value);
    let itemType = pick('type').toLowerCase();
    if (itemType === 'goods' || itemType === 'good' || itemType === 'products') itemType = 'product';
    if (itemType === 'services') itemType = 'service';
    rows.push({
      _sheet_row: rowNumber, category: pick('category'), subcategory: pick('subcategory'),
      type: itemType, item_name: pick('item_name'), sku: pick('sku'), hsn_sac: pick('hsn_sac'),
      unit: pick('unit'), sale_price: pick('sale_price'), purchase_price: pick('purchase_price'),
      tax_rate: pick('tax_rate'), opening_stock: pick('opening_stock'), description: pick('description'),
    });
  }
  if (!rows.length) throw new Error('No non-empty catalog rows were found in the workbook.');
  if (rows.length > 5000) throw new Error('The workbook contains more than 5000 rows. Split it before importing.');
  return rows;
}

export async function downloadCatalogMasterWorkbook(companyName: string, rows: CatalogExportRow[]) {
  const { default: ExcelJS } = await import('@andreeewill/exceljs/dist/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Moneymatters';
  workbook.created = new Date();
  workbook.modified = new Date();
  const sheet = workbook.addWorksheet('Catalog Master');
  sheet.addRow(['Category', 'Subcategory', 'Item Type', 'SKU', 'Name', 'HSN/SAC', 'Unit', 'Price', 'Cost', 'Tax %', 'Stock', 'Status']);
  for (const row of rows) sheet.addRow([row.category, row.subcategory, row.item_type, row.sku, row.name, row.hsn_sac, row.unit, row.sales_price, row.purchase_price, row.tax_rate, row.stock, row.status]);
  styleHeader(sheet);
  sheet.autoFilter = { from: 'A1', to: 'L' + Math.max(1, rows.length + 1) };
  sheet.columns = [{ width: 22 }, { width: 22 }, { width: 16 }, { width: 18 }, { width: 30 }, { width: 14 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 12 }, { width: 14 }, { width: 12 }];
  sheet.getColumn(8).numFmt = '#,##0.00';
  sheet.getColumn(9).numFmt = '#,##0.00';
  sheet.getColumn(10).numFmt = '0.##';
  sheet.getColumn(11).numFmt = '#,##0.###';
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = companyName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'Company';
  const buffer = await workbook.xlsx.writeBuffer();
  downloadWorkbook(buffer, slug + '-Catalog-Master-' + day + '.xlsx');
}
