alter table public.business_document_preferences
  add column if not exists show_bank_details boolean not null default false;
