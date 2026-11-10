import * as esbuild from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
await mkdir('src/generated',{recursive:true});
let katex=await readFile('node_modules/katex/dist/katex.min.css','utf8');
for(const match of [...katex.matchAll(/url\((fonts\/[^)]+)\)/g)]){const path=match[1],mime=path.endsWith('.woff2')?'font/woff2':path.endsWith('.woff')?'font/woff':'font/ttf';const bytes=await readFile('node_modules/katex/dist/'+path);katex=katex.replaceAll('url('+path+')','url(data:'+mime+';base64,'+bytes.toString('base64')+')');}
katex=katex.replace(/(^|})([^{}@][^{}]*)\{/g,(_all,boundary,selectors)=>boundary+selectors.split(',').map(selector=>'.rss-pal '+selector.trim()).join(',')+'{');
await writeFile('src/generated/katex.css',katex);
await esbuild.build({entryPoints:['src/host/index.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'lib/index.js',external:['@deepseek-ai/*','better-sqlite3','jsdom','@mozilla/readability','dompurify','fast-xml-parser','node:*'],banner:{js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'},logLevel:'info'});
await esbuild.build({entryPoints:['src/client/index.tsx'],bundle:true,platform:'browser',format:'cjs',target:'chrome120',jsx:'automatic',outfile:'lib/client.js',external:['react','react/jsx-runtime','react-dom','react-dom/client','@deepseek-ai/*'],loader:{'.css':'text'},banner:{js:'window.__ModuleLoader__.load({id:"rss-pal-dsh",factory:(require)=>{var module={exports:{}};var exports=module.exports;'},footer:{js:'return module.exports;}});'},logLevel:'info'});
