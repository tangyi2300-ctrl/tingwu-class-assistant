// One shared read for the homepage and naming monitor. Failed refreshes keep
// the last complete list, and opening the homepage never renames a recording.
export function createRecordingLibrary({read,get,set,save,now=Date.now}){
 let pending=null;
 return {
  get busy(){return pending!==null;},
  refresh(){
   if(pending)return pending;
   pending=(async()=>{
    try{
     const records=await read();
     if(!Array.isArray(records))throw Error('听悟录音列表格式无效');
     set({records,updatedAt:now(),error:null});await save();return records;
    }catch(error){
     set({...get(),error:error.message});await save();throw error;
    }finally{pending=null;}
   })();
   return pending;
  }
 };
}
