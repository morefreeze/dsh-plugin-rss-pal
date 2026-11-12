import React,{useEffect,useRef} from 'react';
import {X,MessageSquare} from 'lucide-react';
const repo='https://github.com/morefreeze/dsh-plugin-rss-pal';
export default function Feedback({onClose}:{onClose:()=>void}){
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;panel.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[onClose]);
 return <div className="rss-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={panel} tabIndex={-1} className="rss-dialog" role="dialog" aria-modal="true" aria-labelledby="rss-feedback-title" onKeyDown={e=>{if(e.key!=='Tab')return;const links=panel.current?.querySelectorAll<HTMLElement>('a,button');if(!links?.length)return;const first=links[0],last=links[links.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}>
 <header><h2 id="rss-feedback-title"><MessageSquare size={18}/>反馈与建议</h2><button aria-label="关闭反馈" onClick={onClose}><X size={18}/></button></header>
 <p>遇到问题或有新点子？在 GitHub 留下来，方便跟进处理。</p>
 <div className="rss-feedback-links"><a href={`${repo}/issues/new?template=bug-report.yml`} target="_blank" rel="noopener noreferrer">报告问题</a><a href={`${repo}/issues/new?template=feature-request.yml`} target="_blank" rel="noopener noreferrer">功能建议</a><a href={`${repo}/issues`} target="_blank" rel="noopener noreferrer">查看已有反馈</a><a href={`${repo}/blob/main/docs/reports/downloads.md`} target="_blank" rel="noopener noreferrer">下载统计报表</a></div>
 <p className="rss-muted">不会自动上传订阅、文章、聊天或日志。请手动提供版本与复现步骤，并移除个人信息。下载报表统计公开下载次数，不代表使用人数；插件保持无遥测。</p>
 </section></div>;
}
