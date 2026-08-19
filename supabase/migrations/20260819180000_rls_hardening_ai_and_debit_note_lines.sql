-- Production security hardening.
-- These tables were found without RLS during the v1 release audit.
-- Policies follow the existing organization-membership model used by the rest of the schema.

ALTER TABLE public.ai_agent_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insight_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debit_note_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_preferences_member_all ON public.ai_agent_preferences;
CREATE POLICY ai_agent_preferences_member_all
ON public.ai_agent_preferences
FOR ALL TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)))
WITH CHECK (mm_private.is_org_member(mm_private.business_org(business_id)));

DROP POLICY IF EXISTS ai_insight_events_member_all ON public.ai_insight_events;
CREATE POLICY ai_insight_events_member_all
ON public.ai_insight_events
FOR ALL TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)))
WITH CHECK (mm_private.is_org_member(mm_private.business_org(business_id)));

DROP POLICY IF EXISTS debit_note_lines_member_all ON public.debit_note_lines;
CREATE POLICY debit_note_lines_member_all
ON public.debit_note_lines
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.debit_notes dn
    WHERE dn.id = debit_note_lines.debit_note_id
      AND mm_private.is_org_member(mm_private.business_org(dn.business_id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.debit_notes dn
    WHERE dn.id = debit_note_lines.debit_note_id
      AND mm_private.is_org_member(mm_private.business_org(dn.business_id))
  )
);
