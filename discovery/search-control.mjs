import {adjustFDR} from './statistics.mjs';
export function controlSearch(d,world,datasetHash,results,at){
 d.searchBudgets||=[];let budget=d.searchBudgets.find(b=>b.world===world&&b.datasetHash===datasetHash);
 if(!budget){const index=d.searchBudgets.filter(b=>b.world===world).length+1;budget={world,datasetHash,index,alpha:.05/(index*(index+1)),at};d.searchBudgets.push(budget);}
 // A summable search budget limits repeated looks at overlapping historical datasets.
 // BY includes all single, global, hierarchical and multivariate hypotheses in one family.
 adjustFDR(results,'validation','BY');adjustFDR(results,'test','BY');
 for(const e of results){e.searchAlpha=budget.alpha;if(e.status==='SHADOW_MODE'&&(e.validation.q>budget.alpha||e.test.q>budget.alpha)){e.status='REJEITADO';e.reason='Controle conjunto e orçamento de buscas repetidas';}const stored=d.experiments.find(x=>x.id===e.id);if(stored)Object.assign(stored,e);}
 return budget;
}
