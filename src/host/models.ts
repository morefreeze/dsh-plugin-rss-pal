export interface SummarySelection { readonly provider: string; readonly model: string; readonly reasoning?: string }
export interface SummaryModel { id: string; name: string; description?: string; reasoning?: { efforts: { id: string; name: string; description?: string }[]; defaultEffort?: string } }
export function validSummarySelection(value: unknown): value is SummarySelection {
 const v=value as SummarySelection;
 return !!v && typeof v==='object' && typeof v.provider==='string' && !!v.provider.trim() && typeof v.model==='string' && !!v.model.trim() && (v.reasoning===undefined || (typeof v.reasoning==='string' && !!v.reasoning.trim()));
}
export function snapshotSelection(value: SummarySelection): SummarySelection {
 if(!validSummarySelection(value))throw Error('Invalid summary model selection');
 return Object.freeze({provider:value.provider,model:value.model,...(value.reasoning===undefined?{}:{reasoning:value.reasoning})});
}
export function selectionKey(selection?: SummarySelection): string {
 return selection ? JSON.stringify([selection.provider,selection.model,selection.reasoning??null]) : '';
}
function hostSelection(ctx:any): SummarySelection {
 const current=ctx.get('agentDefaultModel')?.currentSelection();
 if(!current)throw Error('Select an available host model');
 return snapshotSelection({provider:current.provider,model:current.model,...(current.reasoningEffort===undefined?{}:{reasoning:current.reasoningEffort})});
}
export function summaryModel(model:any,resolved:any): SummaryModel {
 return {id:model.id,name:model.name,...(model.description===undefined?{}:{description:model.description}),...(resolved.reasoning===undefined?{}:{reasoning:{efforts:resolved.reasoning.efforts.map((e:any)=>({id:e.id,name:e.name,...(e.description===undefined?{}:{description:e.description})})),...(resolved.reasoning.defaultEffort===undefined?{}:{defaultEffort:resolved.reasoning.defaultEffort})}})};
}
export async function listSummaryModels(ctx:any) {
 let defaultSelection:SummarySelection|null=null;
 try {defaultSelection=hostSelection(ctx);} catch { /* Catalog browsing also works before deployment defaults are selected. */ }
 const errors:{id:string;name:string;message:string}[]=[];
 const groups=await Promise.all(ctx.llm.listProviders().map(async(provider:any)=>{
  try {
   const models=await ctx.llm.listModels(provider.id);
   const entries=models.filter((model:any)=>model.inputModalities===undefined || model.inputModalities.includes('text')).map((model:any)=>summaryModel(model,{}));
   return entries.length?{id:provider.id,name:provider.name,models:entries}:null;
  } catch (error) {errors.push({id:provider.id,name:provider.name,message:error instanceof Error?error.message:String(error)});return null;}
 }));
 return {providers:groups.filter((p:any)=>p!==null),defaultSelection,errors};
}
export async function resolveSummaryModel(ctx:any,request:{selection?:SummarySelection}={}) {
 // Detach before asynchronous discovery, so a caller cannot change this request in flight.
 const selection=request.selection===undefined?hostSelection(ctx):snapshotSelection(request.selection);
 if(!ctx.llm.listProviders().some((p:any)=>p.id===selection.provider))throw Error('Summary provider is unavailable');
 const models=await ctx.llm.listModels(selection.provider);
 if(!models.some((m:any)=>m.id===selection.model))throw Error('Summary model is unavailable');
 const advertised=models.find((m:any)=>m.id===selection.model);
 if(advertised.inputModalities!==undefined && !advertised.inputModalities.includes('text'))throw Error('Summary model does not support text input');
 const resolved=await ctx.llm.resolveModelInfo(selection.provider,selection.model);
 if(resolved.inputModalities!==undefined && !resolved.inputModalities.includes('text'))throw Error('Summary model does not support text input');
 const reasoning=selection.reasoning??resolved.reasoning?.defaultEffort;
 if(reasoning!==undefined && !resolved.reasoning?.efforts.some((e:any)=>e.id===reasoning))throw Error('Unsupported summary reasoning effort');
 return snapshotSelection({provider:selection.provider,model:selection.model,...(reasoning===undefined?{}:{reasoning})});
}
