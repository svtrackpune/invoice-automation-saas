-- Keep production template keys and names aligned with the renderer's canonical catalog.
update public.document_templates
set template_key = case template_name
  when 'Classic Business' then 'classic'
  when 'Minimal' then 'minimal'
  when 'Modern' then 'modern'
  when 'Premium' then 'premium'
  when 'Professional' then 'professional'
  else template_key
end
where is_active = true
  and template_name in ('Classic Business','Minimal','Modern','Premium','Professional');

-- Normalize the legacy receipt catalog to the same five production designs.
update public.document_templates
set template_name='Professional', template_key='professional'
where document_type='receipt' and is_active=true and template_key='bold';

update public.document_templates
set template_name='Premium', template_key='premium'
where document_type='receipt' and is_active=true and template_key='compact';

update public.document_templates
set template_name='Classic Business', template_key='classic'
where document_type='receipt' and is_active=true and template_key='classic';
