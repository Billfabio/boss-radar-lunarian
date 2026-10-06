export function independenceKeys(evidence,sources={}){
 const parents=new Map(),find=k=>{if(!parents.has(k))parents.set(k,k);if(parents.get(k)!==k)parents.set(k,find(parents.get(k)));return parents.get(k);},join=(a,b)=>{const x=find(a),y=find(b);if(x!==y)parents.set(x<y?y:x,x<y?x:y);};
 for(const e of evidence){const source='source:'+e.sourceId;find(source);if(e.confirmedBy)join(source,'actor:'+e.confirmedBy);if(sources[e.sourceId]?.dependencyGroup)join(source,'dependency:'+sources[e.sourceId].dependencyGroup);}
 return new Map(evidence.map(e=>[e,find('source:'+e.sourceId)]));
}
