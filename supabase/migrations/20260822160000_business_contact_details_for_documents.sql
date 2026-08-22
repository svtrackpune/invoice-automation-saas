alter table public.businesses
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text;

comment on column public.businesses.phone is 'Primary business contact phone shown on customer-facing documents.';
comment on column public.businesses.email is 'Primary business contact email shown on customer-facing documents.';
comment on column public.businesses.website is 'Business website shown on customer-facing documents.';
