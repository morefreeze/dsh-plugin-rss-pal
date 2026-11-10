import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { join } from 'node:path';
import { Application } from './application.js';
import { makeGenerator, companionContext } from './ai.js';
import { listSummaryModels, resolveSummaryModel, summaryModel, type SummarySelection } from './models.js';

export const METHODS=['snapshot','listFeeds','previewFeed','addFeed','updateFeed','removeFeed','refresh','listArticles','getArticle','capture','refetch','markRead','setState','setTags','recordReading','listTemplates','saveTemplate','removeTemplate','generateSummary','listJobs','cancelJob','retryJob','exportOpml','importOpml','exportArticle','backup','restore','getSettings','saveSettings','listSummaryModels','resolveSummaryModel','getSummarySelection','saveSummarySelection','prepareCompanion'] as const;
export class RssPalService extends TypertRemoteService {
 static inject=['tools','llm','agentDefaultModel','timer'];
 ctx:any;app:Application; contexts=new Map<string,string>();
 constructor(ctx:any,config:any={}){
  super(ctx,'rssPal');this.ctx=ctx;
  this.app=new Application({dataDir:config.dataDir||join(resolveDshHome(),'storages','rss-pal-dsh'),generate:makeGenerator(ctx,{system:createSystemMessage,user:text=>createUserMessage({content:[{type:'text',text}],source:{kind:'user'}})})});
  ctx.inject(['systemPrompt'],(scope:any)=>{scope.systemPrompt.context({name:'rss-pal:reading',order:9500,interpolate:false,text:({agent}:any)=>this.contexts.get(agent?.session?.id)||''});});
  this.registerTools();ctx.effect(()=>()=>{this.contexts.clear();void this.app.dispose();},'rss-pal: dispose');ctx.logger.info('RSS Pal service mounted');
 }
 async listSummaryModels(){return listSummaryModels(this.ctx);}
 async resolveSummaryModel(request:{selection?:SummarySelection}){
  const selection=await resolveSummaryModel(this.ctx,request);
  const provider=this.ctx.llm.listProviders().find((p:any)=>p.id===selection.provider);
  const models=await this.ctx.llm.listModels(selection.provider);
  const model=models.find((m:any)=>m.id===selection.model);
  return {selection,model:summaryModel(model,await this.ctx.llm.resolveModelInfo(selection.provider,selection.model)),provider:{id:provider.id,name:provider.name}};
 }
 async generateSummary(request:{id:string;templateId?:string;selection?:SummarySelection}){
  const selection=await resolveSummaryModel(this.ctx,request);
  return this.app.generateSummary({...request,selection});
 }
 async saveSummarySelection(request:{selection:SummarySelection|null}){
  if(!request || request.selection===undefined)throw Error('Expected summary selection or null');
  const selection=request.selection===null?null:await resolveSummaryModel(this.ctx,{selection:request.selection});
  return this.app.saveSummarySelection({selection});
 }
 async prepareCompanion(request:any){
  const article=await this.app.getArticle({id:request.id});
  const text=companionContext(article,request.selection||'');
  if(request.sessionId){if(typeof request.sessionId!=='string'||request.sessionId.length>160)throw new Error('无效会话');this.contexts.set(request.sessionId,text);if(this.contexts.size>200)this.contexts.delete(this.contexts.keys().next().value!);}
  return {title:article.title,context:text};
 }
 registerTools(){
  const definitions=[
   ['rsspal_list_feeds','列出本地RSS订阅及状态','listFeeds',{}],
   ['rsspal_list_articles','列出RSS文章，可按未读/收藏/点赞筛选','listArticles',{feedId:{type:'string'},filter:{type:'string'},query:{type:'string'},limit:{type:'number'}}],
   ['rsspal_read_article','读取文章正文，不生成总结、不记录人类阅读时长','getArticle',{id:{type:'string',required:true}}],
   ['rsspal_search','全文搜索本地RSS文章','listArticles',{query:{type:'string',required:true},limit:{type:'number'}}],
   ['rsspal_subscribe','预览后按用户要求新增RSS/Atom订阅','addFeed',{url:{type:'string',required:true},title:{type:'string'},group:{type:'string'}}],
   ['rsspal_refresh','刷新一个或全部订阅，不自动调用模型','refresh',{feedId:{type:'string'}}],
   ['rsspal_capture','按用户要求收录单篇网页链接','capture',{url:{type:'string',required:true}}],
   ['rsspal_summarize','仅用户明确要求总结时调用，使用宿主模型生成并返回任务号','generateSummary',{id:{type:'string',required:true},templateId:{type:'string'}}],
   ['rsspal_jobs','读取任务进度、生成总结和失败原因','listJobs',{}],
   ['rsspal_set_state','按用户要求设置已读/收藏/点赞/不喜欢，reaction=like|dislike|null','setState',{id:{type:'string',required:true},read:{type:'boolean'},favorite:{type:'boolean'},reaction:{type:'string'}}],
   ['rsspal_export_markdown','导出文章Markdown内容','exportArticle',{id:{type:'string',required:true}}],
  ] as const;
  for(const [name,description,method,parameters] of definitions)ctxTool(this.ctx,{name,description,parameters,execute:async(args:any)=>{const input={...(args||{})};if(method==='setState'&&input.reaction==='null')input.reaction=null;return JSON.stringify(await (method==='generateSummary'?this.generateSummary(input):(this.app as any)[method](input)));}});
 }
}
function ctxTool(ctx:any,definition:any){ctx.tools.register(defineTool({...definition,output:{schema:{type:'string'},render:(_args:any,value:string)=>[{type:'text',text:value}]}}));}
for(const name of METHODS){
 if(!['prepareCompanion','generateSummary','listSummaryModels','resolveSummaryModel','saveSummarySelection'].includes(name))Object.defineProperty(RssPalService.prototype,name,{value:async function(this:RssPalService,request:any){return await (this.app as any)[name](request);},configurable:true});
 (Remote(name) as any)((RssPalService.prototype as any)[name],{name,private:false,static:false,addInitializer(fn:any){fn.call(Object.create(RssPalService.prototype));}});
}
export default RssPalService;
