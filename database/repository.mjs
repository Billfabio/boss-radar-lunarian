export class IntelligenceRepository {
 async init(){throw new Error('Not implemented');}
 async appendEvidence(_evidence){throw new Error('Not implemented');}
 async upsertEvent(_event){throw new Error('Not implemented');}
 async upsertForecast(_forecast){throw new Error('Not implemented');}
 async resolveForecast(_forecast){throw new Error('Not implemented');}
 async upsertSource(_source){throw new Error('Not implemented');}
 async upsertMethodPerformance(_model){throw new Error('Not implemented');}
 async appendCorrection(_correction){throw new Error('Not implemented');}
 async appendAudit(_entry){throw new Error('Not implemented');}
 async listEvents(_query={}){throw new Error('Not implemented');}
 async listForecasts(_query={}){throw new Error('Not implemented');}
 async loadLearningState(_world){throw new Error('Not implemented');}
}
export function assertRepository(repo){
 const required=['appendEvidence','upsertEvent','upsertForecast','resolveForecast','upsertSource','upsertMethodPerformance','appendCorrection','appendAudit','listEvents','listForecasts','loadLearningState'];
 for(const name of required)if(typeof repo?.[name]!=='function')throw new Error('Repositório de inteligência inválido: '+name);
 return repo;
}
