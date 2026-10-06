export class TaskQueue{
 constructor({concurrency=1,maxPending=50}={}){this.concurrency=concurrency;this.maxPending=maxPending;this.pending=[];this.running=0;this.completed=0;this.failed=0;this.lastStartedAt=0;this.lastCompletedAt=0;this.lastError='';}
 enqueue(name,fn){if(this.pending.length>=this.maxPending)throw new Error('Fila de processamento cheia');return new Promise((resolve,reject)=>{this.pending.push({name,fn,resolve,reject,enqueuedAt:Date.now()});this.#drain();});}
 #drain(){while(this.running<this.concurrency&&this.pending.length){const job=this.pending.shift();this.running++;this.lastStartedAt=Date.now();Promise.resolve().then(job.fn).then(v=>{this.completed++;this.lastCompletedAt=Date.now();job.resolve(v);}).catch(e=>{this.failed++;this.lastError=String(e?.message||e).slice(0,300);this.lastCompletedAt=Date.now();job.reject(e);}).finally(()=>{this.running--;this.#drain();});}}
 stats(){return {running:this.running,pending:this.pending.length,completed:this.completed,failed:this.failed,lastStartedAt:this.lastStartedAt,lastCompletedAt:this.lastCompletedAt,lastError:this.lastError,pendingJobs:this.pending.map(x=>({name:x.name,enqueuedAt:x.enqueuedAt}))};}
}
