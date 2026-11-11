import {dueEvents,clockParts} from '../extension/schedule.js';
export function startDeadline(event,settings){
 const time=event.kind==='morning'?'10:00':'14:00';
 return new Date(`${event.date}T${time}:00+08:00`).getTime()-15000;
}
export function runnableEvents(settings,completed={},attempts={},now=new Date()){
 return dueEvents(settings,completed,now).filter(e=>{
  if(!['morning','afternoon'].includes(e.kind))return true;
  if(now.getTime()>=startDeadline(e,settings))return false;
  return !attempts[e.id] || now.getTime()-attempts[e.id]>=60000;
 });
}
export function preflightEvents(settings,completed={},now=new Date()){
 if(!settings.enabled)return [];
 const p=clockParts(now);if([0,6].includes(p.weekday))return [];
 return ['morning','afternoon'].flatMap(kind=>{
  const [h,m]=settings[kind].split(':').map(Number),start=h*60+m;
  const id=`${p.date}:preflight:${kind}`;
  return p.minute>=start-5 && p.minute<start && !completed[id] ? [{id,kind,date:p.date}] : [];
 });
}
