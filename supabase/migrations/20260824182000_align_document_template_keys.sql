-- Keep production template keys aligned with the renderer's canonical keys.
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
