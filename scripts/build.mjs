import {mkdir,rm,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import path from 'node:path';
import {MODEL_CACHE,MODELS} from '../src/offline-config.js';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'dist');
await rm(out,{recursive:true,force:true});await mkdir(path.join(out,'vendor'),{recursive:true});
for(const file of ['index.html','style.css','inspection-data.js','area-groups.js','asset-data.js','record-storage.js','capture-map.js','gis-worker.js','offline-config.js','whisper-worker.js','manifest.webmanifest','icon.svg','sample.wav'])await copyFile(path.join(root,'src',file),path.join(out,file));
const app=await readFile(path.join(root,'src/offline.js'),'utf8')+'\n'+await readFile(path.join(root,'src/journal.js'),'utf8')+'\n'+await readFile(path.join(root,'src/capture.js'),'utf8')+'\n'+await readFile(path.join(root,'src/gis.js'),'utf8')+'\n'+await readFile(path.join(root,'src/boot.js'),'utf8');
await writeFile(path.join(out,'app.js'),app);
await mkdir(path.join(out,'gis'),{recursive:true});await mkdir(path.join(out,'gis-runtime'),{recursive:true});
for(const file of ['leaflet.js','leaflet.css'])await copyFile(path.join(root,'node_modules/leaflet/dist',file),path.join(out,'gis',file));
await copyFile(path.join(root,'node_modules/fflate/umd/index.js'),path.join(out,'gis/fflate.js'));
const gisCore=await readFile(path.join(root,'src/gis-core.js'),'utf8');await writeFile(path.join(out,'gis-core-classic.js'),gisCore.replaceAll('export ',''));
await writeFile(path.join(out,'gis-demo.gdb.zip'),Buffer.from((await readFile(path.join(root,'tests/fixtures/airfield.gdb.zip.b64'),'utf8')).trim(),'base64'));
const gisFiles=[];
for(const file of ['gdal3.js','gdal3WebAssembly.wasm','gdal3WebAssembly.data']){
 const bytes=await readFile(path.join(root,'node_modules/gdal3.js/dist/package',file));await writeFile(path.join(out,'gis-runtime',file),bytes);
 gisFiles.push({path:'gis-runtime/'+file,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(path.join(out,'gis-runtime.json'),JSON.stringify({version:'2.8.1',bytes:gisFiles.reduce((s,f)=>s+f.size,0),files:gisFiles}));
for(const [pkg,label] of [['gdal3.js','GDAL3'],['leaflet','LEAFLET'],['fflate','FFLATE']])await copyFile(path.join(root,'node_modules',pkg,'LICENSE'),path.join(out,label+'-LICENSE.txt'));
await writeFile(path.join(out,'GIS-SOURCES.txt'),'Unmodified gdal3.js 2.8.1 GIS runtime, LGPL-2.1-or-later. Corresponding source and build instructions: https://github.com/bugra9/gdal3.js/tree/2.8.1 (also https://www.npmjs.com/package/gdal3.js/v/2.8.1). Includes GDAL, PROJ and dependencies; see upstream source for notices. Leaflet 1.9.4 (BSD-2-Clause): https://github.com/Leaflet/Leaflet/tree/v1.9.4 . fflate 0.8.2 (MIT): https://github.com/101arrowz/fflate/tree/v0.8.2 . Synthetic FileGDB fixture contains invented geometry only. No user GIS data is bundled.\n');

// Use the WASM-only runtime: both external imports share its Tensor implementation.
let transformer=await readFile(path.join(root,'node_modules/@huggingface/transformers/dist/transformers.web.min.js'),'utf8');
const external='import*as e from"onnxruntime-common";import*as t from"onnxruntime-web";';
if(!transformer.startsWith(external))throw Error('Pinned Transformers bundle changed unexpectedly.');
transformer=transformer.replace(external,'import*as e from"./ort.wasm.min.mjs";import*as t from"./ort.wasm.min.mjs";');
await writeFile(path.join(out,'vendor/transformers.web.min.js'),transformer);
for(const file of ['ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.mjs','ort.wasm.min.mjs'])await copyFile(path.join(root,'node_modules/onnxruntime-web/dist',file),path.join(out,'vendor',file));
await copyFile(path.join(root,'node_modules/@huggingface/transformers/LICENSE'),path.join(out,'TRANSFORMERS-LICENSE.txt'));
await copyFile(path.join(root,'LICENSE'),path.join(out,'APP-LICENSE.txt'));
await copyFile(path.join(root,'LICENSES/ONNX-RUNTIME.txt'),path.join(out,'ONNX-RUNTIME-LICENSE.txt'));
await copyFile(path.join(root,'LICENSES/WHISPER.txt'),path.join(out,'WHISPER-LICENSE.txt'));
await writeFile(path.join(out,'NOTICE.txt'),'Fieldnote Offline proof of concept. Transformers.js: Apache-2.0, Hugging Face. ONNX Runtime: MIT, Microsoft. Whisper Tiny English: MIT, OpenAI; ONNX conversion: Xenova. Speech sample: excerpt of the public-domain 1961 JFK inaugural address, sourced from Xenova/transformers.js-docs/jfk.wav. App source: MIT. See repository README for source URLs and limitations.\n');
// Generate dependency-free PNG app icons.
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc(data){let c=0xffffffff;for(const x of data)c=table[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function chunk(type,data){const t=Buffer.from(type),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c])}
for(const size of [192,512]){
 const raw=Buffer.alloc((size*4+1)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const nx=x/size,ny=y/size;
  const border=nx>=.31&&nx<=.69&&ny>=.2&&ny<=.8&&(nx<.355||nx>.645||ny<.245||ny>.755);
  const line=nx>.405&&nx<.595&&((ny>.35&&ny<.39)||(ny>.47&&ny<.51)||(ny>.59&&ny<.63&&nx<.52));
  const i=y*(size*4+1)+1+x*4;raw.set(border||line?[212,236,156,255]:[25,61,52,255],i);
 }
 const head=Buffer.alloc(13);head.writeUInt32BE(size,0);head.writeUInt32BE(size,4);head[8]=8;head[9]=6;
 await writeFile(path.join(out,'icon-'+size+'.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
await writeFile(path.join(out,'.nojekyll'),'');
async function walk(dir){let files=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())files.push(...await walk(p));else files.push(path.relative(out,p).split(path.sep).join('/'))}return files.sort()}
const swSource=await readFile(path.join(root,'src/sw-template.js'));
const files=(await walk(out)).filter(file=>!file.startsWith('.')&&!file.startsWith('gis-runtime/')),hash=createHash('sha256').update(swSource);for(const f of files)hash.update(f).update(await readFile(path.join(out,f)));const version=hash.digest('hex').slice(0,16),cacheName='fieldnote-shell-'+version;
const runtimeCache='fieldnote-runtime-transformers-3.8.1-wasm-1';
const manifest={version,cacheName,runtimeCache,files:[...files,'offline-assets.json','sw-config.js']};
await writeFile(path.join(out,'offline-assets.json'),JSON.stringify(manifest));
await writeFile(path.join(out,'sw-config.js'),'self.FIELDNOTE_CACHE='+JSON.stringify({CACHE:cacheName,RUNTIME_CACHE:runtimeCache,FILES:manifest.files,MODEL_CACHE,MODEL_ROUTES:Object.fromEntries(Object.values(MODELS).map(m=>['models/'+m.id+'/',m.cache]))})+';\n');
await copyFile(path.join(root,'src/sw-template.js'),path.join(out,'sw.js'));
console.log('Built Fieldnote Offline '+version+' · '+manifest.files.length+' cached files.');
