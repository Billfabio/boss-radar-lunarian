import {verifyOperationalEvents,appendOperationalEvent,ensureOperational} from './operational-state.mjs';
import {verifyLedger} from '../event-sourcing/ledger.mjs';

export function validateStartupState(state,{worlds=[],authRequired=false,sitePassword=''}={}){
 const issues=[],add=(severity,code,message,detail={})=>issues.push({severity,code,message,detail});
 ensureOperational(state);
 if(!state.settings||typeof state.settings!=='object')add('critical','SETTINGS_MISSING','Configuração principal ausente.');
 else if(worlds.length&&!worlds.includes(state.settings.world))add('critical','WORLD_INVALID','Mundo configurado não existe na lista permitida.',{world:state.settings.world});
 if(authRequired&&String(sitePassword||'').length<12)add('critical','SITE_PASSWORD_INVALID','SITE_PASSWORD ausente ou menor que 12 caracteres em ambiente autenticado.');
 const op=verifyOperationalEvents(state);if(!op.valid)add('critical','OPERATIONAL_EVENT_STORE_BROKEN','Event store operacional falhou na verificação de hash.',op);
 const ledger=verifyLedger(state.intelligence?.ledger||[]);if(!ledger.valid)add('critical','INTELLIGENCE_LEDGER_BROKEN','Ledger da inteligência falhou na verificação de hash.',ledger);
 if(!Array.isArray(state.pipelineDeadLetters||[]))add('critical','DLQ_INVALID','Dead Letter Queue possui formato inválido.');
 const outbox=state.operational?.outbox;if(!Array.isArray(outbox))add('critical','OUTBOX_INVALID','Outbox persistente possui formato inválido.');
 else for(const item of outbox){if(!item?.id||!item.kind||!['PENDING','DELIVERED','DEAD_LETTER'].includes(item.status))add('critical','OUTBOX_ITEM_INVALID','Item inválido na outbox persistente.',{id:item?.id||null,kind:item?.kind||null,status:item?.status||null});}
 const result={ok:!issues.some(x=>x.severity==='critical'),criticalIssues:issues.filter(x=>x.severity==='critical').length,totalIssues:issues.length,issues};
 state.operational.startupValidation={at:Date.now(),...result};return result;
}
export function validatePendingOutboxHandlers(state,handlers={}){
 const pending=(state.operational?.outbox||[]).filter(x=>x.status==='PENDING'),missing=[...new Set(pending.map(x=>x.kind).filter(kind=>typeof handlers[kind]!=='function'))];
 const result={ok:missing.length===0,pending:pending.length,missingHandlers:missing};if(missing.length)appendOperationalEvent(state,'STARTUP_OUTBOX_HANDLER_MISSING',{missingHandlers:missing,pending:pending.length},{correlationId:'startup:outbox'});
 return result;
}
export function recordStartupRecovery(state,{outboxBefore=0,outboxAfter=0,dlqBefore=0,dlqAfter=0}={}){
 const payload={outboxBefore,outboxAfter,replayed:Math.max(0,outboxBefore-outboxAfter),dlqBefore,dlqAfter,at:Date.now()};appendOperationalEvent(state,'STARTUP_RECOVERY_COMPLETED',payload,{correlationId:'startup:recovery',idempotencyKey:'startup-recovery:'+ensureOperational(state).startedAt});state.operational.startupRecovery=payload;return payload;
}
