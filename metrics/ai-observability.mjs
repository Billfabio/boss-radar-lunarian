import {qualitySummary} from '../data-quality/engine.mjs';
import {calibrationReport} from '../learning/calibration.mjs';
import {detectDrift} from '../learning/drift.mjs';
export function aiObservability({events=[],forecasts=[],sources=[],world,predictions=[]}){
 const quality=qualitySummary(events,world),resolved=forecasts.filter(f=>f.world===world&&f.resolvedAt),errors=resolved.filter(f=>Number.isFinite(f.errorMinutes)).map(f=>f.errorMinutes);
 const calibration=calibrationReport(forecasts,world),bosses=[...new Set(events.filter(e=>e.world===world).map(e=>e.boss))],drifts=bosses.map(boss=>({boss,...detectDrift(events,boss,world)})).filter(x=>x.detected);
 const anomalies=events.filter(e=>e.world===world&&e.anomaly).length,conflicts=events.filter(e=>e.world===world&&e.qualityStatus==='CONFLITANTE').length;
 const sourceRows=sources.filter(s=>s.active);
 return {
  prediction_latency:null,
  prediction_error_minutes:errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10)/10:null,
  source_accuracy:Object.fromEntries(sourceRows.map(s=>[s.id,s.reliability])),
  model_accuracy:resolved.length?Math.round(1000*resolved.filter(f=>f.windowHit).length/resolved.length)/10:null,
  confidence_calibration_error:calibration.ece,
  data_quality_score:quality.averageScore,
  drift_score:drifts.length?Math.round(drifts.reduce((n,x)=>n+x.score,0)/drifts.length*10)/10:0,
  anomaly_rate:events.filter(e=>e.world===world).length?Math.round(1000*anomalies/events.filter(e=>e.world===world).length)/10:0,
  prediction_volume:forecasts.filter(f=>f.world===world).length,
  conflicts,
  driftedBosses:drifts,
  insufficientBosses:predictions.filter(p=>p.status==='insufficient').map(p=>p.boss)
 };
}
