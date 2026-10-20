// Private transport records are separate from accepted assessment evidence.
export function replyPrefix(text) {
 const match=/^\s*\{\s*"reply"\s*:\s*"/.exec(text);
 if(!match)return '';
 let result='';
 for(let i=match[0].length;i<text.length;i++){
  const c=text[i];if(c==='"')return result;
  if(c==='\\'){
   const escaped=text[++i];if(escaped===undefined)break;
   if(escaped==='u'){
    const hex=text.slice(i+1,i+5);if(hex.length<4)break;
    if(!/^[0-9a-f]{4}$/i.test(hex))throw Error('invalid_reply_escape');
    result+=String.fromCharCode(parseInt(hex,16));i+=4;
   }else{const value={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'}[escaped];if(value===undefined)throw Error('invalid_reply_escape');result+=value;}
  }else{if(c<' ')throw Error('invalid_reply_character');result+=c;}
 }
 // Do not render a lone UTF-16 high surrogate while its pair is in flight.
 return /[\uD800-\uDBFF]$/.test(result)?result.slice(0,-1):result;
}

const RETRYABLE_OUTCOMES=['TIMEOUT','FETCH_ERROR','UNAVAILABLE','500','502','503','504'];
export function validatedProviderAccounting(value,{maxProviderAttempts=1,success=false,model='gemini-3.6-flash',primaryModel=null}={}){
 // yw-claude-primary-gemini-fallback-v1: attempt 1 runs on the primary (Claude) model; every later attempt is the free Gemini
 // fallback on `model`. A failed primary attempt may have produced buffered output (never shown to the learner) before failing.
 const claudeFirst=value?.policy==='yw-claude-primary-gemini-fallback-v1';
 if(!value||value.version!==1||!(value.policy==='yw-same-model-sequential-v1'||(claudeFirst&&typeof primaryModel==='string'&&primaryModel))||value.mode!=='sequential-distinct-key'||value.fallback!==false||value.hedge!==false||value.backgroundCalls!==0||!Number.isSafeInteger(value.maxProviderAttempts)||value.maxProviderAttempts<1||value.maxProviderAttempts>maxProviderAttempts||!Number.isSafeInteger(value.providerAttemptCount)||value.providerAttemptCount<0||value.providerAttemptCount>value.maxProviderAttempts||!Array.isArray(value.attempts)||value.attempts.length!==value.providerAttemptCount)throw Error('gateway_accounting_mismatch');
 const attempts=value.attempts.map((a,i)=>{
  const expectedModel=claudeFirst&&i===0?primaryModel:model;
  if(a.ordinal!==i+1||a.model!==expectedModel||typeof a.brokerCompleted!=='boolean'||typeof a.outputStarted!=='boolean'||typeof a.outcome!=='string'||!/^[A-Z0-9_]{1,50}$/.test(a.outcome)||!(a.usage===null||a.usage&&typeof a.usage==='object'&&!Array.isArray(a.usage)))throw Error('gateway_accounting_mismatch');
  if(i<value.attempts.length-1){
   if(claudeFirst&&i===0){if(!a.brokerCompleted||a.outcome==='OK')throw Error('gateway_retry_mismatch');}
   else if(!a.brokerCompleted||a.outputStarted||!RETRYABLE_OUTCOMES.includes(a.outcome))throw Error('gateway_retry_mismatch');
  }
  return {ordinal:a.ordinal,model:a.model,outcome:a.outcome,brokerCompleted:a.brokerCompleted,outputStarted:a.outputStarted,usage:a.usage};
 });
 if(success&&(!attempts.length||attempts.at(-1).outcome!=='OK'||!attempts.at(-1).brokerCompleted||!attempts.at(-1).outputStarted))throw Error('gateway_accounting_mismatch');
 if(!success&&attempts.some(a=>a.outcome==='OK'))throw Error('gateway_accounting_mismatch');
 return {version:1,policy:value.policy,mode:value.mode,fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:value.maxProviderAttempts,providerAttemptCount:value.providerAttemptCount,attempts};
}

export async function consumeGatewayStream(response,onReply,{maxReplyChars=1800,maxProviderAttempts=1,model='gemini-3.6-flash',primaryModel=null,signal}={}){
 if(!response.headers.get('content-type')?.includes('text/event-stream')||!response.body)throw Error('gateway_stream_required');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let buffer='',raw='',reply='',result=null,bytes=0,sequence=0;
 const abort=()=>{reader.cancel('deadline').catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{
  while(true){
   if(signal?.aborted)throw Error('gateway_stream_timeout');
   const {value,done}=await reader.read();if(done)break;
   bytes+=value.byteLength;if(bytes>262144)throw Error('gateway_stream_too_large');
   buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let index;
   while((index=buffer.indexOf('\n\n'))>=0){
    const frame=buffer.slice(0,index);buffer=buffer.slice(index+2);
    const lines=frame.split('\n'),event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim();
    const id=Number(lines.find(l=>l.startsWith('id:'))?.slice(3).trim());
    if(!Number.isSafeInteger(id)||id!==++sequence)throw Error('gateway_stream_sequence');
    const data=JSON.parse(lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n'));
    if(result)throw Error('gateway_stream_after_done');
    if(event==='error'){
     const error=Error('gateway_stream_unconfirmed');
     if(data.providerAccounting)error.gatewayFailure={requestId:data.requestId||null,providerAccounting:validatedProviderAccounting(data.providerAccounting,{maxProviderAttempts,model,primaryModel}),partialOutput:reply.length>0,retryable:false};
     throw error;
    }
    if(event==='delta'){
     if(typeof data.text!=='string')throw Error('invalid_gateway_delta');raw+=data.text;if(raw.length>24000)throw Error('gateway_reply_too_large');
     const next=replyPrefix(raw);if(next.length>maxReplyChars||!next.startsWith(reply))throw Error('invalid_reply_prefix');
     if(next!==reply){reply=next;await onReply?.(reply);}
    }else if(event==='done'){
     if(typeof data.answer!=='string'||data.answer!==raw||!Number.isSafeInteger(data.providerAttemptCount)||data.providerAttemptCount<1||data.providerAttemptCount>maxProviderAttempts)throw Error('gateway_stream_mismatch');
     const accounting=data.providerAccounting?validatedProviderAccounting(data.providerAccounting,{maxProviderAttempts,success:true,model,primaryModel}):null;
     const servedModel=accounting?accounting.attempts.at(-1).model:(primaryModel&&data.model===primaryModel?primaryModel:model);
     if(data.model!==servedModel||!(data.model===model||(primaryModel&&data.model===primaryModel))||(data.providerAttemptCount>1&&!accounting))throw Error('gateway_stream_mismatch');
     if(accounting&&(accounting.providerAttemptCount!==data.providerAttemptCount||JSON.stringify(accounting.attempts.at(-1).usage)!==JSON.stringify(data.usage)))throw Error('gateway_accounting_mismatch');
     result={value:JSON.parse(data.answer),model:data.model,modelVersion:data.modelVersion,usage:data.usage,providerAttemptCount:data.providerAttemptCount,providerAccounting:accounting,firstTokenMs:data.firstTokenMs,totalDurationMs:data.totalDurationMs};
    }else throw Error('unknown_gateway_event');
   }
  }
  buffer+=decoder.decode();if(signal?.aborted||buffer.trim()||!result)throw Error('gateway_stream_truncated');
  return result;
 }catch(error){error.partialReply=reply;throw error;}finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function studentStream(){
 let controller,closed=false;const encoder=new TextEncoder();
 const body=new ReadableStream({start(c){controller=c;},cancel(){closed=true;}});
 return {response:new Response(body,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}}),
  send(event,data){if(!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));},
  close(){if(!closed){closed=true;controller.close();}}};
}
