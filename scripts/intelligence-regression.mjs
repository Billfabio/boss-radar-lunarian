import assert from 'node:assert/strict';
import {runHistoricalBacktest} from '../backtest/history.mjs';
const H=3600000,base=Date.parse('2026-01-01T12:00:00-03:00'),events=[];let at=base;
for(let i=0;i<140;i++){
 const regime=i<85?72:58,noise=[-3,2,0,4,-2,1,-1,3][i%8];
 events.push({id:'gate-'+i,boss:'Regression Gate Boss',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:92,confidence:.92,evidence:[{precision:'minute'}]});
 at+=(regime+noise)*H;
}
const r=runHistoricalBacktest(events,'Lunarian',{minTrain:12}),models=new Map(r.overallModels.map(x=>[x.model,x])),ensemble=models.get('adaptive_ensemble'),historical=models.get('historical_mean');
assert.ok(ensemble?.preciseSamples>=80,'Amostra insuficiente no regression gate');
assert.ok(Number.isFinite(ensemble.maeMinutes)&&Number.isFinite(historical?.maeMinutes),'MAE indisponível no regression gate');
assert.ok(ensemble.maeMinutes<=historical.maeMinutes*1.15+1,`Ensemble regrediu: ${ensemble.maeMinutes} min vs baseline ${historical.maeMinutes} min`);
assert.ok((r.calibration.ece??0)<=25,`Calibração degradada: ECE ${r.calibration.ece}`);
assert.ok(r.temporalValidation.test.predictions>=20,'Holdout temporal insuficiente');
console.log(JSON.stringify({kind:'test-only-temporal-regression',ensembleMAE:ensemble.maeMinutes,historicalMeanMAE:historical.maeMinutes,test:r.temporalValidation.test,calibrationECE:r.calibration.ece},null,2));
