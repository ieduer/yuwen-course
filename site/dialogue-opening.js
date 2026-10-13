export const OPENING_VERSION='yw-conversation-opening-v1';
export function dialogueOpening(curriculum){
 const work=`《${curriculum.title}》`;
 return {version:OPENING_VERSION,kind:'source-authored-teaching-introduction',content:curriculum.persona?.kind==='author-simulation'
  ?`你好，我想邀你從${work}的一句話走近我的文字。你想先讀一讀、聊聊初見的感受，還是從一處疑問開始？可以隨時換個方向，我會陪你把想法說清楚。`
  :`你好，我們一起讀${work}。你想先讀一讀、聊聊初見的感受，還是從一處疑問開始？可以隨時換個方向，我們回到文字慢慢討論。`};
}
