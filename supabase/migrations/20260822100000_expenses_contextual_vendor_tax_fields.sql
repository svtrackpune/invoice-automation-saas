alter table public.expense_categories add column if not exists requires_vendor boolean not null default false;
alter table public.expenses add column if not exists tax_rate numeric(8,4) not null default 0;
alter table public.expenses add column if not exists tax_inclusive boolean not null default true;
alter table public.expenses add column if not exists tax_components jsonb not null default '{}'::jsonb;
alter table public.recurring_expense_templates add column if not exists tax_rate numeric(8,4) not null default 0;
alter table public.recurring_expense_templates add column if not exists tax_inclusive boolean not null default true;
alter table public.recurring_expense_templates add column if not exists tax_components jsonb not null default '{}'::jsonb;
update public.expense_categories set requires_vendor = case when name in ('Salaries & Wages','Employee Welfare','Bank & Payment Fees','General Operating Expense') then false else true end;