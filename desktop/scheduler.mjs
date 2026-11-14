import {dueEvents,clockParts} from '../extension/schedule.js';
export const START_KINDS=['morning','afternoon'];
const classTimes={morning:['10:00','12:00'],afternoon:['14:00','18:00']};
const at=(date,time)=>new Date(`${date}T${time}:00+08:00`).getTime();
export function startDeadline(event){return at(event.date,classTimes[event.kind][1]);}
export function sessions(settings,now=new Date()){
 const p=clockParts(now);if(!settings.enabled || [0,6].includes(p.weekday))return [];
 return START_KINDS.map(kind=>({kind,id:`${p.date}:${kind}`,date:p.date,plannedAt:at(p.date,settings[kind]),classAt:at(p.date,classTimes[kind][0]),deadline:at(p.date,classTimes[kind][1])}));
}
export function runnableEvents(settings,completed={},attempts={},now=new Date()){
 const starts=sessions(settings,now).filter(e=>now.getTime()>=e.plannedAt && now.getTime()<e.deadline && !completed[e.id] && (!attempts[e.id] || now.getTime()-attempts[e.id]>=30000));
 return [...starts,...dueEvents(settings,completed,now).filter(e=>!START_KINDS.includes(e.kind))];
}
export function preflightEvents(settings,completed={},now=new Date(),attempts={}){
 return sessions(settings,now).flatMap(e=>{
  const id=`${e.date}:preflight:${e.kind}`;
  return now.getTime()>=e.plannedAt-300000 && now.getTime()<e.plannedAt && !completed[id] && (!attempts[id] || now.getTime()-attempts[id]>=30000)?[{...e,id}]:[];
 });
}
export function recordingHasPriority(settings,completed={},now=new Date()){
 return sessions(settings,now).some(e=>now.getTime()>=e.plannedAt-300000 && now.getTime()<e.deadline && !completed[e.id]);
}
export function dailyRuns(settings,state,now=new Date()){
 return sessions(settings,now).map(e=>({...e,status:state.completed?.[e.id]?'confirmed':now.getTime()>=e.deadline?'missed':now.getTime()<e.plannedAt?'scheduled':'pending',...state.sessionRuns?.[e.id]}));
}

export function keepDisplayAwake(settings,now=new Date()){return sessions(settings,now).some(e=>now.getTime()>=e.plannedAt-300000 && now.getTime()<e.deadline);}
