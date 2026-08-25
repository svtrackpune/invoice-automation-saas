'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

// The existing renderer/template implementation is unchanged. The only fix in this commit
// is keeping the document-context bank available for the later invoice payment merge.
