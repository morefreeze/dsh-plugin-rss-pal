import React, {useEffect,useMemo,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import {ArrowLeft,ThumbsUp,ThumbsDown,Star,Check,RefreshCw,MessageSquare,Download,Sparkles,ExternalLink,Tags} from 'lucide-react';
import {ReadingTracker,clientId} from './reading.js';
import SummaryModelPicker,{SummarySelection} from './SummaryModelPicker.js';
export interface Article {id:string;title:string;url:string;feedId?:string;publishedAt?:string|null;excerpt?:string;html?:string;contentText?:string;contentHash?:string;read:boolean;favorite:boolean;reaction:'like'|'dislike'|null;tags:string[];progress:number;openCount?:number;readSeconds?:number;summary?:{brief:string;detail:string;status:string;model?:string;generatedAt?:string;templateId?:string}|null}
export interface Template {id:string;name:string;prompt:string}
export interface Job {id:string;type?:string;kind?:string;status:string;progress?:number;error?:string;streamedText?:string;text?:string;articleId?:string;input?:{id?:string};request?:{id?:string}}
export interface ReaderProps {article:Article;api:any;templates:Template[];jobs:Job[];fontSize:number;lineHeight:number;active:boolean;onArticle:(article:Article)=>void;onJob:(options?:{open?:boolean})=>Promise<void>;onBack:()=>void;companion?:(request:{id:string;selection?:string})=>void|Promise<void>}
export function MarkdownContent({children}:{children:string}){return <Markdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeHighlight,rehypeKatex]} components={{a:props=><a {...props} target="_blank" rel="noopener noreferrer"/>}}>{children}</Markdown>;}
export function downloadText(value:unknown,name:string,type='text/plain'){const text=typeof value==='string'?value:JSON.stringify(value,null,2);const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export default function Reader({article,api,templates,jobs,fontSize,lineHeight,active,onArticle,onJob,onBack,companion}:ReaderProps){
 const latest=useRef({article,onArticle});latest.current={article,onArticle};const panel=useRef<HTMLDivElement>(null);const activeRef=useRef(active);activeRef.current=active;const tracker=useRef<ReadingTracker|null>(null);const [tags,setTags]=useState(article.tags.join(', '));const [selection,setSelection]=useState('');const [templateId,setTemplateId]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState('');
 const [summarySelection,setSummarySelection]=useState<SummarySelection|null>(null);const [modelPending,setModelPending]=useState(false);
 const safeHtml=useMemo(()=>DOMPurify.sanitize(article.html??'',{USE_PROFILES:{html:true,mathMl:true},FORBID_TAGS:['style','form','input','button','iframe','object','embed'],FORBID_ATTR:['style']}),[article.html]);
 useEffect(()=>{setTags(article.tags.join(', '));setSelection('');setError('');},[article.id,article.tags.join(',')]);
 useEffect(()=>{const element=panel.current;if(!element)return;const reading=new ReadingTracker({id:article.id,clientId,send:event=>{Promise.resolve(api.recordReading(event)).then((result:Article)=>{if(result?.id===event.id&&latest.current.article.id===event.id)latest.current.onArticle({...latest.current.article,...result});}).catch(()=>{});}});tracker.current=reading;
 const foreground=()=>activeRef.current&&document.visibilityState==='visible'&&document.hasFocus()&&element.getClientRects().length>0;
 reading.setForeground(foreground());reading.start(article.progress);element.scrollTop=Math.max(0,element.scrollHeight-element.clientHeight)*(article.progress||0);
 const visibility=()=>reading.setForeground(foreground());const activity=()=>{visibility();reading.touch();};const scroll=()=>{activity();const length=element.scrollHeight-element.clientHeight;if(length>0)reading.progress(element.scrollTop/length);};
 document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',visibility);window.addEventListener('blur',visibility);element.addEventListener('scroll',scroll);element.addEventListener('pointerdown',activity);element.addEventListener('pointermove',activity);element.addEventListener('keydown',activity);const interval=setInterval(()=>{visibility();reading.flush();},10000);
 return()=>{reading.flush(true);tracker.current=null;clearInterval(interval);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',visibility);window.removeEventListener('blur',visibility);element.removeEventListener('scroll',scroll);element.removeEventListener('pointerdown',activity);element.removeEventListener('pointermove',activity);element.removeEventListener('keydown',activity);};
 },[article.id,api]);
 useEffect(()=>{const element=panel.current;if(!active)tracker.current?.flush();tracker.current?.setForeground(active&&document.visibilityState==='visible'&&document.hasFocus()&&!!element?.getClientRects().length);},[active]);
 const run=async(name:string,fn:()=>Promise<void>)=>{setBusy(name);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy('');}};
 const state=(patch:Partial<Article>)=>run('state',async()=>{const result=await api.setState({id:article.id,...patch});onArticle({...article,...patch,...(result?.id?result:{})});});
 const companionAction=(text?:string)=>run('companion',async()=>{await companion?.({id:article.id,...(text?{selection:text}:{})});});
 const streamed=jobs.find(j=>(j.articleId===article.id||j.input?.id===article.id||j.request?.id===article.id)&&(j.type==='summary'||j.kind==='summary')&&['running','queued','pending'].includes(j.status));
 return <section className="rss-reader" aria-label="文章阅读区">
 <div className="rss-reader-toolbar"><button className="rss-back" onClick={onBack}><ArrowLeft size={16}/>返回文章列表</button><div className="rss-toolbar-actions">
 <button aria-label="点赞" title="点赞" aria-pressed={article.reaction==='like'} disabled={!!busy} onClick={()=>state({reaction:article.reaction==='like'?null:'like'})}><ThumbsUp size={16}/></button>
 <button aria-label="不喜欢" title="不喜欢" aria-pressed={article.reaction==='dislike'} disabled={!!busy} onClick={()=>state({reaction:article.reaction==='dislike'?null:'dislike'})}><ThumbsDown size={16}/></button>
 <button aria-label="收藏文章" title="收藏文章" aria-pressed={article.favorite} disabled={!!busy} onClick={()=>state({favorite:!article.favorite})}><Star size={16}/></button>
 <button aria-label={article.read?'标为未读':'标为已读'} title={article.read?'标为未读':'标为已读'} aria-pressed={article.read} disabled={!!busy} onClick={()=>state({read:!article.read})}><Check size={16}/></button>
 <button aria-label="重新抓取全文" title="重新抓取全文" disabled={!!busy} onClick={()=>run('refetch',async()=>{await api.refetch({id:article.id});await onJob();})}><RefreshCw size={16}/></button>
 <button aria-label="打开伴读" title={companion?'打开原生伴读':'原生伴读正在连接'} disabled={!companion||!!busy} onClick={()=>companionAction()}><MessageSquare size={16}/></button>
 <button aria-label="导出 Markdown" title="导出 Markdown" disabled={!!busy} onClick={()=>run('export',async()=>{const data=await api.exportArticle({id:article.id});downloadText(data?.markdown??data,`${article.title.replace(/[^\p{L}\p{N} -]/gu,'').slice(0,70)||'article'}.md`,'text/markdown');})}><Download size={16}/></button>
 </div></div>
 {error&&<div className="rss-error" role="alert">{error}<button onClick={()=>setError('')}>关闭</button></div>}
 <div className="rss-reading-scroll" ref={panel} tabIndex={0} onMouseUp={()=>{const selected=window.getSelection();setSelection(selected&&panel.current?.contains(selected.anchorNode)?selected.toString().trim().slice(0,16000):'');}}>
 <div className="rss-reading-paper" style={{'--reader-font-size':`${fontSize}px`,'--reader-line-height':lineHeight} as React.CSSProperties}>
 <div className="rss-article-meta"><a href={article.url} target="_blank" rel="noopener noreferrer">{(()=>{try{return new URL(article.url).hostname;}catch{return article.url;}})()}<ExternalLink size={12}/></a><span>{article.publishedAt?new Date(article.publishedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'网页摘录'}</span></div>
 <h1>{article.title}</h1>
 <div className="rss-tag-editor"><Tags size={14}/><label className="rss-sr-only" htmlFor="rss-article-tags">文章标签</label><input id="rss-article-tags" value={tags} placeholder="添加标签，用逗号分隔" onChange={e=>setTags(e.target.value)}/><button disabled={!!busy} onClick={()=>run('tags',async()=>{const list=[...new Set(tags.split(',').map(t=>t.trim()).filter(Boolean))];const result=await api.setTags({id:article.id,tags:list});onArticle({...article,tags:list,...(result?.id?result:{})});})}>保存标签</button></div>
 {selection&&companion&&<div className="rss-selection"><p>“{selection.length>160?`${selection.slice(0,160)}…`:selection}”</p><button onClick={()=>companionAction(selection)}><MessageSquare size={14}/>讨论选段</button></div>}
 <section className="rss-summary" aria-label="手动总结"><div className="rss-summary-heading"><h2><Sparkles size={15}/>阅读笔记</h2><div><label className="rss-sr-only" htmlFor="rss-summary-template">总结模板</label><select id="rss-summary-template" value={templateId} onChange={e=>setTemplateId(e.target.value)}><option value="">默认模板</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><SummaryModelPicker api={api} selection={summarySelection} onSelection={setSummarySelection} onPending={setModelPending} disabled={!!busy||!!streamed}/><button disabled={!!busy||!!streamed||modelPending} onClick={()=>run('summary',async()=>{const result=await api.generateSummary({id:article.id,...(templateId?{templateId}:{}),...(summarySelection?{selection:summarySelection}:{})});if(result?.cached&&result.summary){onArticle({...article,summary:result.summary});}else await onJob({open:false});})}>{streamed||busy==='summary'?'生成中…':'生成总结'}</button></div></div>
 {article.summary?<><div className="rss-summary-meta">{article.summary.status==='stale'?'正文已更新 · 这份总结来自旧版本':article.summary.model||'已保存的总结'}</div><MarkdownContent>{article.summary.brief}</MarkdownContent><details><summary>详细分析</summary><MarkdownContent>{article.summary.detail}</MarkdownContent></details></>:!streamed&&<p className="rss-muted">只有点击生成，才会调用模型总结。</p>}
 {streamed&&<div aria-live="polite"><MarkdownContent>{streamed.streamedText??streamed.text??'正在整理阅读笔记…'}</MarkdownContent></div>}</section>
 {safeHtml?<div className="rss-article-body" data-testid="article-body" dangerouslySetInnerHTML={{__html:safeHtml}}/>:<div className="rss-article-body" data-testid="article-body"><MarkdownContent>{article.contentText||article.excerpt||'暂无全文，请点击重新抓取全文。'}</MarkdownContent></div>}
 <footer className="rss-article-footer"><span>文章结束</span><button disabled={!!busy} onClick={()=>{tracker.current?.progress(1);tracker.current?.flush();void state({read:true});}}><Check size={14}/>完成阅读</button><a href={article.url} target="_blank" rel="noopener noreferrer">阅读原文<ExternalLink size={14}/></a></footer>
 </div></div></section>;
}
