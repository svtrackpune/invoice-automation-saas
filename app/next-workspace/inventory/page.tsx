'use client';
import {useEffect} from 'react';
export default function InventoryRedirect(){useEffect(()=>{window.location.replace('/next-workspace/items')},[]);return <div className="grid min-h-[60vh] place-items-center text-sm text-slate-500">Opening Products & Services…</div>}
