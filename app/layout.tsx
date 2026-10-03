import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "./document-templates.css";
import "./document-branding-final.css";
import "./document-template-differences.css";
import "./document-print-final.css";
import ModalPersistenceGuard from "./ModalPersistenceGuard";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Moneymatters — Business finance, simplified",
  description: "Accounting, invoicing, banking, payroll and automation in one simple workspace.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const headersList = await headers();
  const nonce = headersList.get("x-nonce") ?? undefined;

  return (
    <html lang="en" nonce={nonce} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          /* Screen document canvas: A4 for invoices/estimates, thermal for receipts. */
          .paper:not(.receipt-paper) { width:210mm!important; min-height:297mm!important; box-sizing:border-box!important; }
          .receipt-paper { width:2.5in!important; max-width:2.5in!important; min-height:0!important; box-sizing:border-box!important; }
          .receipt-paper .receipt-head,.receipt-paper .receipt-title,.receipt-paper .receipt-customer,.receipt-paper .receipt-items,.receipt-paper .receipt-totals,.receipt-paper .payment-detail,.receipt-paper .receipt-thanks,.receipt-paper .receipt-footer { max-width:100%!important; box-sizing:border-box!important; margin-left:0!important; margin-right:0!important; }
          .receipt-paper .receipt-head,.receipt-paper .receipt-title { padding-left:8px!important; padding-right:8px!important; }
          .receipt-paper .receipt-customer { margin-left:8px!important; margin-right:8px!important; }
          .receipt-paper .receipt-items { width:calc(100% - 16px)!important; margin-left:8px!important; }
          .receipt-paper .receipt-totals,.receipt-paper .payment-detail,.receipt-paper .receipt-thanks,.receipt-paper .receipt-footer { margin-left:8px!important; margin-right:8px!important; }

          /* Explicit physical page contracts. Browsers use these when opening the print dialog/PDF flow. */
          @page a4-document { size: A4 portrait; margin: 0; }
          @page receipt { size: 2.5in auto; margin: 0; }

          @media print {
            html, body { margin:0!important; padding:0!important; background:#fff!important; }
            .paper:not(.receipt-paper) {
              page: a4-document;
              width:210mm!important;
              min-width:210mm!important;
              max-width:210mm!important;
              min-height:0!important;
              height:auto!important;
              margin:0!important;
              box-sizing:border-box!important;
              box-shadow:none!important;
              overflow:visible!important;
            }
            .receipt-paper {
              page:receipt;
              width:2.5in!important;
              max-width:2.5in!important;
              min-height:0!important;
              margin:0!important;
              box-shadow:none!important;
              overflow:visible!important;
            }
            .receipt-paper * { max-width:100%!important; box-sizing:border-box!important; }
          }
        ` }} />
      </head>
      <body nonce={nonce} className="min-h-full flex flex-col">
        <ModalPersistenceGuard />
        {children}
      </body>
    </html>
  );
}
