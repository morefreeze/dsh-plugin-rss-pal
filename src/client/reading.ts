export interface ReadingEvent { id:string; clientId:string; sequence:number; progress:number; seconds:number; opened?:boolean }
interface TrackerOptions {id:string;clientId:string;send:(event:ReadingEvent)=>unknown;now?:()=>number}
const sequences=new Map<string,number>();
export const clientId = `rss-reader-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
/** Integrates elapsed foreground time, clipping each interval at the last interaction + 120s. */
export class ReadingTracker {
 private now:()=>number; private last:number; private touched:number; private foreground=true;private started=false;private opened=false;private dirty=false; private position=0; private seconds=0;
 constructor(private options:TrackerOptions){this.now=options.now??(()=>performance.now());this.last=this.touched=this.now();}
 start(progress=0){this.position=Math.max(0,Math.min(1,progress||0));this.started=true;if(this.foreground){this.opened=true;this.emit(true);}}
 tick(){const current=this.now();if(this.foreground)this.seconds+=Math.max(0,Math.min(current,this.touched+120000)-this.last)/1000;this.last=current;}
 touch(){this.tick();this.touched=this.now();}
 setForeground(value:boolean){this.tick();this.foreground=value;if(value&&this.started&&!this.opened){this.touched=this.now();this.opened=true;this.emit(true);}}
 progress(value:number){this.touch();this.dirty=true;this.position=Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
 flush(force=false){this.tick();if(this.seconds>0||this.dirty||force&&this.opened)this.emit();}
 private emit(opened=false){const sequence=(sequences.get(this.options.clientId)??0)+1;sequences.set(this.options.clientId,sequence);const seconds=this.seconds;this.seconds=0;this.dirty=false;this.options.send({id:this.options.id,clientId:this.options.clientId,sequence,progress:this.position,seconds,...(opened?{opened:true}:{})});}
}
