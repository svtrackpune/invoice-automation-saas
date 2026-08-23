'use client';
import Customer360Controlled from '../Customer360Controlled';
type Params={params:Promise<{id:string}>};
export default function Customer360Page({params}:Params){return <Customer360Controlled params={params}/>;}
