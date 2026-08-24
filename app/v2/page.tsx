'use client';

import { useEffect } from 'react';

/**
 * Legacy compatibility route.
 *
 * The canonical Moneymatters workspace is /next-workspace.  Keeping a
 * redirect here preserves old bookmarks/links without maintaining a second
 * dashboard implementation against the same business data.
 */
export default function LegacyV2Redirect() {
  useEffect(() => {
    location.replace('/next-workspace');
  }, []);

  return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Opening Moneymatters…</div>;
}
