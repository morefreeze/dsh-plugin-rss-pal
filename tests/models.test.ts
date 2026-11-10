import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../src/host/models.js').catch(() => ({} as any));
export function modelContext() {
 const reasoning={efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}],defaultEffort:'low'};
 return {get:()=>({currentSelection:()=>({provider:'p',model:'m',reasoningEffort:'high'})}),llm:{listProviders:()=>[{id:'p',name:'Provider'},{id:'broken',name:'Broken'}],listModels:async(p:string)=>{if(p==='broken')throw Error('offline');return [{id:'m',name:'Model'},{id:'plain',name:'Plain'}];},resolveModelInfo:async(p:string,m:string)=>({provider:p,id:m,name:m,...(m==='m'?{reasoning}: {})})}};
}
test('catalog mirrors live host providers and model descriptors, isolating provider failures',async()=>{
 const api=await load();assert.equal(typeof api.listSummaryModels,'function');
 const catalog=await api.listSummaryModels(modelContext());
 assert.deepEqual(catalog.defaultSelection,{provider:'p',model:'m',reasoning:'high'});
 assert.equal(catalog.providers.length,1);assert.equal(catalog.providers[0].models[0].id,'m');
 assert.equal(catalog.providers[0].models[1].reasoning,undefined);
});
test('catalog needs no exact-model network lookups and works before host model selection',async()=>{
 const api=await load();const ctx=modelContext();let resolved=0;(ctx as any).get=()=>undefined;
 ctx.llm.resolveModelInfo=async()=>{resolved++;throw Error('temporary resolver outage');};
 const result=await api.listSummaryModels(ctx);assert.equal(result.defaultSelection,null);assert.equal(result.providers[0].models.length,2);assert.equal(resolved,0);
});
test('catalog excludes explicit non-text models and preserves provider discovery errors',async()=>{
 const api=await load();const ctx=modelContext();(ctx.llm as any).listModels=async(p:string)=>{if(p==='broken')throw Error('offline');return [{id:'image',name:'Image',inputModalities:['image']},{id:'m',name:'M',inputModalities:['text']},{id:'unknown',name:'Unknown'}];};
 const result=await api.listSummaryModels(ctx);assert.deepEqual(result.providers[0].models.map((m:any)=>m.id),['m','unknown']);assert.deepEqual(result.errors,[{id:'broken',name:'Broken',message:'offline'}]);
});
test('exact model rejects explicit negative text capability while unknown metadata remains eligible',async()=>{
 const api=await load();const ctx=modelContext();(ctx.llm as any).resolveModelInfo=async(p:string,m:string)=>({provider:p,id:m,name:m,inputModalities:['image']});
 await assert.rejects(()=>api.resolveSummaryModel(ctx,{selection:{provider:'p',model:'plain'}}),/text/i);
 (ctx.llm as any).resolveModelInfo=async(p:string,m:string)=>({provider:p,id:m,name:m});assert.deepEqual(await api.resolveSummaryModel(ctx,{selection:{provider:'p',model:'plain'}}),{provider:'p',model:'plain'});
});
test('selection validates catalog and supported effort, materializes adapter default and freezes detached snapshot',async()=>{
 const api=await load();assert.equal(typeof api.resolveSummaryModel,'function');const ctx=modelContext();
 const requested={provider:'p',model:'m',reasoning:'high'};
 const selected=await api.resolveSummaryModel(ctx,{selection:requested});requested.reasoning='low';
 assert.deepEqual(selected,{provider:'p',model:'m',reasoning:'high'});assert.ok(Object.isFrozen(selected));
 assert.deepEqual(await api.resolveSummaryModel(ctx,{selection:{provider:'p',model:'m'}}),{provider:'p',model:'m',reasoning:'low'});
 for(const selection of [{provider:'x',model:'m'},{provider:'p',model:'missing'},{provider:'p',model:'plain',reasoning:'high'},{provider:'p',model:'m',reasoning:'maximum'},{provider:'p',model:'m',reasoning:null}]) await assert.rejects(()=>api.resolveSummaryModel(ctx,{selection}));
 assert.deepEqual(await api.resolveSummaryModel(ctx),{provider:'p',model:'m',reasoning:'high'});
});
