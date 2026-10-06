import assert from 'node:assert/strict';
import {runHistoricalBacktest} from '../backtest/history.mjs';
const H=3600000,base=Date.parse('2026-01-01T12:00:00-03:00'),events=[];let at=base;
for(let i=0;i<180;i++){
 const regime=i<105?72:58,noise=[-3,2,0,4,-2,1,-1,3][i%8];
 events.push({id:'gate-'+i,boss:'Regression Gate Boss',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:92,confidence:.92,evidence:[{precision:'minute'}]});
 at+=(regime+noise)*H;
}
const r=runHistoricalBacktest(events,'Lunarian',{minTrain:12}),by=r.temporalValidation.byModel||{},ensemble=by.adaptive_ensemble;
assert.ok(ensemble?.test?.preciseSamples>=25,'Amostra de teste insuficiente no regression gate');
const baselines=['historical_mean','last_interval','empirical_median','recent_mean_10']
 .map(name=>({name,validation:by[name]?.validation,test:by[name]?.test}))
 .filter(x=>Number.isFinite(x.validation?.maeMinutes)&&Number.isFinite(x.test?.maeMinutes)&&x.validation.preciseSamples>=15)
 .sort((a,b)=>a.validation.maeMinutes-b.validation.maeMinutes);
assert.ok(baselines.length,'Nenhum baseline elegível na validação');
const selected=baselines[0],testMae=ensemble.test.maeMinutes,baselineTestMae=selected.test.maeMinutes;
assert.ok(Number.isFinite(testMae)&&Number.isFinite(baselineTestMae),'MAE de teste indisponível');
assert.ok(testMae<=baselineTestMae*1.12+1,`Ensemble regrediu no holdout: ${testMae} min vs baseline ${selected.name} ${baselineTestMae} min`);
const testCal=r.calibrationBySplit?.test;
if((testCal?.samples||0)>=20){assert.ok((testCal.ece??100)<=25,`Calibração de teste degradada: ECE ${testCal.ece}`);assert.ok((testCal.brier??1)<=.3,`Brier score degradado: ${testCal.brier}`);}
console.log(JSON.stringify({kind:'test-only-temporal-regression',baselineSelectedOnValidation:selected.name,validationMAE:selected.validation.maeMinutes,ensembleTestMAE:testMae,baselineTestMAE,temporalTest:ensemble.test,testCalibration:testCal},null,2));
