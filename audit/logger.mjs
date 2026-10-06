export function audit(list,type,data={},at=Date.now()){list.unshift({id:`audit-${at}-${Math.random().toString(36).slice(2,8)}`,type,at,...data});if(list.length>3000)list.length=3000;}
export function publicAudit(list,limit=150){return (list||[]).slice(0,Math.max(1,Math.min(500,limit)));}
