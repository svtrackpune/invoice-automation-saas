'use client';

import Customer360Workspace from './Customer360Workspace';

type Params={params:Promise<{id:string}>};
export default async function Customer360Page({params}:Params){const {id}=await params;return <Customer360Workspace id={id}/>}
