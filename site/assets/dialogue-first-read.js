// Same source renderer, offsets and handlers as the original course. The host
// supplies an owner-fenced transport; no local history is removed or adopted.
export function openFirstReading({lessonId,root,action,isCurrent,onStatus,onUnlock,gate}){
 const controller=window.YwClassicalFirstRead,events=new AbortController();let session=null;
 const current=()=>!events.signal.aborted&&isCurrent();
 const transport={
  readState:()=>action('state',{}),
  mutate:(path,payload)=>{
   if(!current())throw Error('帳戶或篇目已切換，請重新讀回。');
   const operation={'/api/reading/first-read/mark':'mark','/api/reading/first-read/mark/delete':'delete','/api/reading/first-read/submit':'submit','/api/reading/first-read/resolve':'resolve'}[path];
   if(!operation)throw Error('初讀操作未開放');return action(operation,payload);
  },
 };
 const handlers={signal:events.signal,isCurrent:current,toast:message=>{if(current())onStatus(message);},onChange:()=>{if(current()&&session.submitted){render();onUnlock();}},onUnlock:()=>{if(current()){render();onUnlock();}},onUnlockFailure:()=>{if(current())onUnlock();}};
 function render(){
  if(!current())return;
  root.replaceChildren();root.hidden=false;
  if(!session.submitted&&gate()?.phase!=='initial_reading'){
   root.textContent='原有完成及初讀版本已保留；不同版本的標記不套用到本版正文。原件可在本課紀錄核對。';return;
  }
  if(!session.submitted){root.innerHTML=controller.renderGate(session);controller.bindGate(root,session,handlers);return;}
  const details=document.createElement('details'),summary=document.createElement('summary'),record=document.createElement('div');summary.textContent='原初讀與疑點訂正';record.innerHTML=controller.renderSubmittedReading(session)+controller.renderCorrections(session);details.append(summary,record);root.append(details);controller.bindCorrections(record,session,handlers);
  if(!session.annotatedReadCompleted){
   const button=document.createElement('button');button.textContent='我已讀完正文與註釋，進入字詞練習';
   button.onclick=async()=>{button.disabled=true;try{
    const receipt=await action('acknowledge',{textVersionId:session.asset.textVersionId,textDigest:session.asset.textDigest});if(receipt.ok!==true)throw Error('閱讀確認尚未讀回，請保留目前紀錄。');
    if(!current())return;session.annotatedReadCompleted=true;render();onUnlock();
   }catch(error){if(!current())return;onStatus(error.message);button.disabled=false;}};
   root.append(button);
  }
 }
 root.textContent='正在讀回無注疏正文及本帳戶的初讀紀錄…';root.hidden=false;
 const ready=(async()=>{
  try{session=await controller.load(lessonId,{transport,canReconcile:()=>false});if(!current())return;if(!session)throw Error('本課無注疏正文暫時不可用');render();}
  catch(error){if(current()){root.textContent=error.message;onStatus('初讀暫時未能確認；未解鎖註釋，也未改動紀錄。');}}
 })();
 for(const event of ['pointerup','keyup'])root.addEventListener(event,()=>{if(current()&&session&&!session.submitted)controller.captureSelection(root,session,handlers);},{signal:events.signal});
 return {ready,dispose:()=>{events.abort();root.replaceChildren();root.hidden=true;}};
}
