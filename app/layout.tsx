import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./document-templates.css";
import "./document-branding-final.css";
import ModalPersistenceGuard from "./ModalPersistenceGuard";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Moneymatters — Business finance, simplified",
  description: "Accounting, invoicing, banking, payroll and automation in one simple workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          /* Document physical print geometry. Keep invoices/estimates A4 and receipts on 2.5-inch thermal paper. */
          .paper:not(.receipt-paper) {
            width: 210mm !important;
            min-height: 297mm !important;
            box-sizing: border-box !important;
          }
          .receipt-paper {
            width: 2.5in !important;
            max-width: 2.5in !important;
            min-height: 0 !important;
            box-sizing: border-box !important;
          }
          .receipt-paper .receipt-head,
          .receipt-paper .receipt-title,
          .receipt-paper .receipt-customer,
          .receipt-paper .receipt-items,
          .receipt-paper .receipt-totals,
          .receipt-paper .payment-detail,
          .receipt-paper .receipt-thanks,
          .receipt-paper .receipt-footer {
            max-width: 100% !important;
            box-sizing: border-box !important;
          }
          .receipt-paper .receipt-head,
          .receipt-paper .receipt-title,
          .receipt-paper .receipt-customer,
          .receipt-paper .receipt-items,
          .receipt-paper .receipt-totals,
          .receipt-paper .payment-detail,
          .receipt-paper .receipt-thanks,
          .receipt-paper .receipt-footer {
            margin-left: 0 !important;
            margin-right: 0 !important;
          }
          .receipt-paper .receipt-head { padding-left: 8px !important; padding-right: 8px !important; }
          .receipt-paper .receipt-title { padding-left: 8px !important; padding-right: 8px !important; }
          .receipt-paper .receipt-customer { margin-left: 8px !important; margin-right: 8px !important; }
          .receipt-paper .receipt-items { width: calc(100% - 16px) !important; margin-left: 8px !important; }
          .receipt-paper .receipt-totals,
          .receipt-paper .payment-detail,
          .receipt-paper .receipt-thanks,
          .receipt-paper .receipt-footer { margin-left: 8px !important; margin-right: 8px !important; }

          @page receipt {
            size: 2.5in auto;
            margin: 0;
          }

          @media print {
            html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
            .paper:not(.receipt-paper) {
              page: a4-document;
              width: 210mm !important;
              min-height: 297mm !important;
              margin: 0 !important;
              box-shadow: none !important;
            }
            .receipt-paper {
              page: receipt;
              width: 2.5in !important;
              max-width: 2.5in !important;
              min-height: 0 !important;
              margin: 0 !important;
              box-shadow: none !important;
              overflow: visible !important;
            }
            .receipt-paper * { max-width: 100% !important; }
          }
          @page a4-document {
            size: A4;
            margin: 0;
          }
        ` }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ModalPersistenceGuard />
        {children}
      </body>
    </html>
  );
}
