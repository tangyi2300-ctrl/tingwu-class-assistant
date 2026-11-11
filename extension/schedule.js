export const DEFAULTS = Object.freeze({enabled: false, morning: '09:55', noon: '12:10', afternoon: '13:55', evening: '18:10'});
export const LABELS = {morning: '上午课前', noon: '中午下课', afternoon: '下午课前', evening: '下午下课'};
export function validate(value) {
  const s = {...DEFAULTS, ...value};
  const times = ['morning', 'noon', 'afternoon', 'evening'].map(k => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s[k])) throw Error('请填写有效的时间');
    return s[k];
  });
  if (!(times[0] < times[1] && times[1] < times[2] && times[2] < times[3])) throw Error('请按上午开始、中午提醒、下午开始、傍晚提醒的顺序设置时间');
  if (times[0] >= '10:00' || times[2] >= '14:00') throw Error('课前时间须早于 10:00 和 14:00');
  if (typeof s.enabled !== 'boolean') throw Error('启用状态无效');
  return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, s[k]]));
}
export function clockParts(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(now).map(x => [x.type,x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return {date, minute: Number(p.hour)*60+Number(p.minute), weekday: new Date(`${date}T12:00:00+08:00`).getUTCDay()};
}
const minutes = t => Number(t.slice(0,2))*60 + Number(t.slice(3));
export function dueEvents(settings, completed = {}, now = new Date()) {
  if (!settings.enabled) return [];
  const p = clockParts(now);
  if ([0,6].includes(p.weekday)) return [];
  return Object.keys(LABELS).flatMap(kind => {
    const delta = p.minute - minutes(settings[kind]);
    const id = `${p.date}:${kind}`;
    // Wake-ups more than five minutes late never unexpectedly start a recording.
    return delta >= 0 && delta <= 5 && !completed[id] ? [{kind, id, date:p.date}] : [];
  });
}
export function nextEvent(settings, now = new Date()) {
  const p = clockParts(now);
  for(let day = 0; day < 8; day++) {
    const base = new Date(`${p.date}T00:00:00+08:00`).getTime() + day*86400000;
    if ([0,6].includes(new Date(base+12*3600000).getUTCDay())) continue;
    for(const kind of Object.keys(LABELS)) {
      const when = base + minutes(settings[kind])*60000;
      if(when > now.getTime()) return {kind, when};
    }
  }
}
