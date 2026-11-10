import React,{useMemo,useState} from 'react';
import { Rss } from 'lucide-react';
import App from './App.js';
import styles from './styles.css';
import katex from '../generated/katex.css';
import { nativeBridge,Companion,NativeConversation } from './native-chat.js';
const PLUGIN='rss-pal-dsh';export const PANEL_ID='rss-pal-dsh';
const names=['snapshot','listFeeds','previewFeed','addFeed','updateFeed','removeFeed','refresh','listArticles','getArticle','capture','refetch','markRead','setState','setTags','recordReading','listTemplates','saveTemplate','removeTemplate','generateSummary','listJobs','cancelJob','retryJob','exportOpml','importOpml','exportArticle','backup','restore','getSettings','saveSettings','prepareCompanion','listSummaryModels','resolveSummaryModel','getSummarySelection','saveSummarySelection'];
const noParams=new Set(['snapshot','listFeeds','listTemplates','listJobs','exportOpml','backup','getSettings','listSummaryModels','getSummarySelection']);
const codec=()=>({mode:'strict',typeSymbol:PLUGIN+'#json',create:()=>({parse:(v:any)=>v,safeParse:(v:any)=>({success:true,data:v})})});
const descriptors=names.map(name=>({id:PLUGIN+'#rssPal/'+name,service:'rssPal',namespace:'rssPal',method:name,invocation:{kind:'direct'},parameters:noParams.has(name)?[]:[{name:'request',wire:'request',source:'json',codec:codec()}],result:{mode:'src-json'},cancellation:{parameter:'signal'}}));
export const inject=['slots','layout','remote'];
function Panel({api,bridge,SessionProvider,renderSlot}:any){
 const [request,setRequest]=useState<any>(null);const companion=useMemo(()=>((input:any)=>{setRequest(input);}),[]);
 return <div className="rss-pal-shell" style={{display:'flex',height:'100%',minHeight:0,width:'100%',overflow:'hidden',position:'relative',containerType:'inline-size',containerName:'rss-shell'}}><div style={{flex:1,minWidth:0,height:'100%',containerType:'inline-size'}}><App api={api} companion={companion}/></div>{request&&<Companion request={request} api={api} bridge={bridge} SessionProvider={SessionProvider} renderSlot={renderSlot} onClose={()=>setRequest(null)}/>}</div>;
}
export async function apply(ctx:any){
 {let style=document.getElementById('rss-pal-dsh-styles') as HTMLStyleElement|null;if(!style){style=document.createElement('style');style.id='rss-pal-dsh-styles';document.head.appendChild(style);}style.textContent=styles+'\n'+katex+'\n@container rss-shell (max-width:700px){.rpd-companion{position:absolute!important;inset:0;width:100%!important;min-width:0!important;z-index:60;background:#18191f!important;color:#eef1ee!important;}}';}
 await ctx.remote.$mount({package:PLUGIN,descriptors});
 ctx.inject(['remote.rssPal'],(child:any)=>{
  const api=Object.fromEntries(names.map(name=>[name,async(request?:any)=>{const response=await child.remote.rssPal[name](...(noParams.has(name)?[]:[request||{}]));if(response.ok)return response.value;throw response.error;}])) as any;
  const bridge=nativeBridge(child);
  child.slots.inject('main',()=>child.slots.register({name:'main',key:PANEL_ID,children:{'rss-pal.chat':{kind:'single',scope:'session'}},inject:()=>({api,bridge})},Panel));
  child.slots.inject('rss-pal.chat',()=>child.slots.register({name:'rss-pal.chat'},NativeConversation));
  child.slots.inject('sidebar.panellist',()=>child.slots.register({name:'sidebar.panellist',id:PANEL_ID,order:16,label:'RSS Pal'},()=> <Rss size={20}/>));
 });
}
