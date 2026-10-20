import PDFDocument from 'pdfkit';
import path from 'node:path';

const DEVANAGARI_FONT_PATH = path.join(
  process.cwd(),
  'public',
  'fonts',
  'NotoSansDevanagari[wdth,wght].ttf',
);

export const safePdfText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();

export function createUnicodePdfDocument(options: Record<string, unknown> = {}): any {
  const document = new (PDFDocument as any)({ ...options, bufferPages: true });
  document.registerFont('NotoSansDevanagari', DEVANAGARI_FONT_PATH);
  return document;
}

export function pdfFontName(value: string, bold = false): string {
  return /[^\x00-\x7F]/u.test(value)
    ? 'NotoSansDevanagari'
    : bold ? 'Helvetica-Bold' : 'Helvetica';
}

export function pdfColor(value: readonly number[] | string): string {
  if (Array.isArray(value) && value.length >= 3) {
    return '#' + value.slice(0, 3)
      .map((channel) => Math.round(Math.max(0, Math.min(1, Number(channel))) * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  const components = raw.split(/\s+/).map(Number);
  if (components.length === 3 && components.every((component) => Number.isFinite(component) && component >= 0 && component <= 1)) {
    return '#' + components
      .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return '#172033';
}

export function pdfTextWidth(document: any, value: string, size: number, bold = false): number {
  const text = safePdfText(value);
  document.font(pdfFontName(text, bold)).fontSize(size);
  try {
    return document.widthOfString(text);
  } catch {
    return Array.from(text).length * size * 0.55;
  }
}

export function pdfDocumentToBuffer(document: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    document.once('end', () => resolve(Buffer.concat(chunks)));
    document.once('error', reject);
    document.end();
  });
}
