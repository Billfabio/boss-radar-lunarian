const DAY=86400000;
export function predictionReadiness({sampleSize=0,preciseSamples=0,dataQuality=0,predictionScore=0,anomalyRate=0,agreement=0,uncertaintyMs=Infinity,intervalMedianMs=null}={}){
 const reasons=[];
 if(sampleSize<6)reasons.push('menos de 6 aparições confirmadas e aprovadas');
 if(dataQuality<.6)reasons.push('qualidade dos dados abaixo de 60/100');
 if(predictionScore<55)reasons.push('Boss Prediction Score abaixo de 55/100');
 if(anomalyRate>=.4&&sampleSize<20)reasons.push('taxa de anomalias alta para o tamanho da amostra');
 if(agreement<.2&&sampleSize<12)reasons.push('modelos com baixa concordância');
 if(Number.isFinite(intervalMedianMs)&&intervalMedianMs>0&&uncertaintyMs>intervalMedianMs*.8&&sampleSize<15)reasons.push('incerteza quase tão ampla quanto o próprio intervalo típico');
 if(uncertaintyMs>21*DAY)reasons.push('janela de incerteza superior a 21 dias');
 const canPredictWindow=!reasons.length;
 const exactReasons=[];
 if(!canPredictWindow)exactReasons.push(...reasons);
 if(preciseSamples<8)exactReasons.push('menos de 8 aparições com horário preciso');
 if(sampleSize&&preciseSamples/sampleSize<.5)exactReasons.push('menos de metade do histórico possui horário preciso');
 if(uncertaintyMs>12*3600000)exactReasons.push('incerteza superior a 12 horas');
 if(predictionScore<70)exactReasons.push('Boss Prediction Score abaixo de 70/100');
 return {canPredictWindow,canPredictExact:canPredictWindow&&!exactReasons.length,reasons,exactReasons};
}
