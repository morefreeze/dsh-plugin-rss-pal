import test from 'node:test';
import assert from 'node:assert/strict';
import { RssPalService, METHODS } from '../src/host/service.js';
const ctx=()=>({get:()=>({currentSelection:()=>({provider:'p',model:'m',reasoningEffort:'high'})}),llm:{listProviders:()=>[{id:'p',name:'P'}],listModels:async()=>[{id:'m',name:'M'}],resolveModelInfo:async()=>({provider:'p',id:'m',name:'M',reasoning:{efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}],defaultEffort:'low'}})}});
test('Remote registration preserves submission resolver and never overrides special wrappers',async()=>{
 assert.doesNotMatch(RssPalService.prototype.resolveSummaryModel.toString().split('{')[0], /=/);
 const calls:any[]=[];const service=Object.create(RssPalService.prototype) as any;service.ctx=ctx();
 service.app={generateSummary:async(r:any)=>{calls.push(r);return {jobId:'j'};},getSummarySelection:async()=>({provider:'p',model:'m',reasoning:'low'}),saveSummarySelection:async(r:any)=>r.selection};
 const request={id:'article'};await service.generateSummary(request);
 assert.deepEqual(calls[0].selection,{provider:'p',model:'m',reasoning:'high'});assert.ok(Object.isFrozen(calls[0].selection));assert.equal((request as any).selection,undefined);
 const result=await service.resolveSummaryModel({selection:{provider:'p',model:'m'}});assert.equal(result.selection.reasoning,'low');assert.equal(result.model.name,'M');
 assert.deepEqual(await service.getSummarySelection(),{provider:'p',model:'m',reasoning:'low'});
 await assert.rejects(()=>service.saveSummarySelection({selection:{provider:'p',model:'bad'}}));assert.equal(await service.saveSummarySelection({selection:null}),null);
 await assert.rejects(()=>service.saveSummarySelection({}));
 assert.equal(new Set(METHODS).size,METHODS.length);assert.ok(METHODS.includes('listSummaryModels' as any));
});
