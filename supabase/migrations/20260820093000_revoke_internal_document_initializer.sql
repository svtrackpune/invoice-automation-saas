-- Document preference initialization is invoked by trusted onboarding/trigger paths, not by the browser.
revoke execute on function public.initialize_document_preferences(uuid) from public,anon,authenticated;
