import React,{useEffect,useState} from 'react';
export function nativeBridge(ctx:any){
 let scope:any;ctx.inject(['sessions','uiSession','uiWorkspace'],(child:any)=>{scope=child;return ()=>{scope=undefined;};});
 return {async open(sessionId?:string){
  if(!scope)throw new Error('DSH原生会话服务尚未就绪');
  const items=scope.uiWorkspace.workspaces.list.getSnapshot().items;
  const workspace=(items.find((w:any)=>w.title==='default-workspace')||items[0])?.workspaceId;
  if(!workspace)throw new Error('DSH工作区尚未就绪');
  const id=sessionId||await scope.sessions.create({workspaceId:workspace});
  const reference=scope.sessions.retain(id,{source:'rss-pal-dsh'});
  return {sessionId:id,reference,release:()=>reference.release()};
 }};
}
export function NativeConversation({sessionId,useSession,useConversation,useSessions,renderFactorySlot}:any){
 const session=useSession((s:any)=>s),conversation=useConversation((s:any)=>s),blank=useSessions((s:any)=>s.byId[sessionId]?.blank);
 const active=conversation.activeTargets.size>0||(!session.blank&&!session.awaitingFirstTurn)||session.running;
 const settling=!active&&session.openState==='loading'&&blank!==true,hero=!active&&(session.openState==='open'||blank===true);
 return renderFactorySlot('conversation.content',{variant:'embedded',phase:settling?'settling':hero?'hero':'active',hero},{slots:{views:({renderSlot}:any)=>renderSlot('conversation.session',{view:'chat'})}});
}
export function Companion({request,api,bridge,SessionProvider,renderSlot,onClose}:any){
 const [chat,setChat]=useState<any>(null),[error,setError]=useState(''),[title,setTitle]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{let live=true,held:any;setReady(false);setError('');void(async()=>{
  const saved=localStorage.getItem('rsspal.chat.'+request.id);try{held=await bridge.open(saved||undefined);}catch{held=await bridge.open();}
  if(!live){held.release();return;}
  const material=await api.prepareCompanion({...request,sessionId:held.sessionId});
  if(!live){held.release();return;}localStorage.setItem('rsspal.chat.'+request.id,held.sessionId);setTitle(material.title);setChat(held);setReady(true);
 })().catch((cause:any)=>{held?.release();if(live)setError(cause.message||String(cause));});return()=>{live=false;held?.release();};},[request.id,request.selection,api,bridge]);
 return <aside className="rpd-companion" aria-label="AI伴读" style={{width:'40%',minWidth:340,borderLeft:'1px solid var(--rpd-border,#ddd)',display:'flex',flexDirection:'column',minHeight:0}}><header style={{padding:16,display:'flex',gap:8,justifyContent:'space-between'}}><strong>AI伴读</strong><button onClick={onClose}>关闭伴读</button></header><div style={{padding:'0 16px 12px'}}>{title}{request.selection&&<blockquote>{request.selection}</blockquote>}<small>文章作为参考，直接在下方提问。</small></div>{error?<p role="alert">{error}</p>:!ready?<p>正在连接原生对话…</p>:<div style={{flex:1,minHeight:0,overflow:'auto'}}><SessionProvider session={chat.reference}>{renderSlot('rss-pal.chat',{})}</SessionProvider></div>}</aside>;
}
