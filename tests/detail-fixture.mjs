import {buildRecordingDetail} from '../desktop/recording-detail.mjs';
export function detailFixture(record,{withNotes=true}={}){
 const card=(key,values)=>({key,status:0,contents:[{contentValues:values}]});
 return buildRecordingDetail(record,{
  lab:{labCardsMap:{summary:[card('fullSummary',[{value:'这堂课从镜头语言出发，讲解如何用景别、构图与剪辑节奏表达人物情绪，再结合声音设计完成一段叙事清楚的短片。练习重点是先想清楚观众需要看到什么，再选择画面和声音。'}]),card('agendaSummary',[
   {title:'镜头语言：让画面表达情绪',value:'景别决定观众与人物的距离，远景交代环境，近景强调表情与细节。构图要先确定主体，再用视线和留白引导观众的注意力。'},
   {title:'叙事节奏：安排信息与停顿',value:'剪辑节奏服务于故事，而不是单纯追求切换速度。重要动作前留出铺垫，情绪变化后保留反应镜头。'},
   {title:'声音设计：建立层次与空间',value:'人声、背景音乐和环境音分别承担信息、情绪和空间感。混音时先保证人声清楚，再调整配乐与音效的比例。'},
   {title:'课堂练习：完成一段情绪短片',value:'先画六格分镜，明确每个镜头传递的信息。用同一组素材尝试两种不同的剪辑节奏，比较情绪变化。'}
  ])]}},
  transcript:{result:JSON.stringify({pg:[{pi:'p1',sc:[{bt:0,et:40000,tc:'今天先看镜头语言。景别、构图和剪辑节奏都会改变观众感受到的情绪。'}]},{pi:'p2',sc:[{bt:700000,et:730000,tc:'讲声音设计时，先保证人声清楚，然后处理背景音乐和环境音。'}]}]})},
  notes:{content:JSON.stringify(['root',{},...(withNotes?['构图先确定主体，再考虑留白。近景突出人物的表情和细节。','剪辑节奏不要一直快切，情绪变化后留出反应镜头。','周五记得带读卡器。']:[]).map(text=>['p',{},['span',{'data-type':'text'},['span',{'data-type':'leaf'},text]]])])}
 });
}
