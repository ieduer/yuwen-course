export async function readDialogueEvents(response,onEvent){
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',bytes=0,terminal=null,saved=null;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>100000)throw Error('回應過長，請讀回保存紀錄。');
   buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let end;
   while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const lines=block.split('\n');
    const event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim();const data=JSON.parse(lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n'));
    if(terminal||!['saved','delta','done','unconfirmed'].includes(event))throw Error('回應未能確認，請讀回保存紀錄。');
    if(event==='saved'){if(saved)throw Error('重複保存回執');saved=data;}
    else if(!saved||data.turnId!==saved.turnId)throw Error('回合不一致，請讀回保存紀錄。');
    if(event==='done'||event==='unconfirmed')terminal=event;
    onEvent?.(event,data);
   }
  }
  buffer+=decoder.decode();if(!saved||!terminal||buffer.trim())throw Object.assign(Error('連線已中斷；已確認保存的內容可讀回，AI 不會自動重跑。'),{saved:!!saved});
  return {...saved,pending:false,unconfirmed:terminal==='unconfirmed'};
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
