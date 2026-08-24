'use client';
import UnifiedDocumentSettings from './UnifiedDocumentSettings';
import DocumentBankAccountsPanel from './DocumentBankAccountsPanel';

export default function BrandPage(){
  return <main className="document-settings-shell"><div className="document-settings-inner">
    <UnifiedDocumentSettings />
    <DocumentBankAccountsPanel />
  </div></main>;
}
