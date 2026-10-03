'use client';
import { useEffect } from 'react';
export default function PosServiceWorker(){useEffect(()=>{if(!('serviceWorker'in navigator))return;void navigator.serviceWorker.register('/pos-sw.js',{scope:'/next-workspace/cash-bill'}).catch(()=>{});},[]);return null;}