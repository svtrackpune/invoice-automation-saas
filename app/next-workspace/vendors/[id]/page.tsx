'use client';

import Vendor360Controlled from '../Vendor360Controlled';

type Params={params:Promise<{id:string}>};

export default function Vendor360Page({params}:Params){return <Vendor360Controlled params={params}/>;}
