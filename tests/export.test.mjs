import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {unzipSync} from 'fflate';
import {exportPhotoSize,exportZip} from '../src/export-media.js';
test('Export photos preserve aspect ratio, cap the long edge and never upscale',()=>{
 assert.deepEqual(exportPhotoSize(4032,3024),{width:2048,height:1536});
 assert.deepEqual(exportPhotoSize(3024,4032),{width:1536,height:2048});
 assert.deepEqual(exportPhotoSize(600,400),{width:600,height:400});
 assert.throws(()=>exportPhotoSize(0,100));
});
test('ZIP round-trips large binary files, empty files and Unicode filenames with monotonic byte progress',async()=>{
 const bytes=Uint8Array.from({length:800000},(_,i)=>i%251),progress=[];
 const archive=await exportZip([{name:'A6/photo.jpg',blob:new Blob([bytes])},{name:'A6/note café.txt',blob:new Blob(['GPS preserved'])},{name:'empty',blob:new Blob([])}],value=>progress.push(value));
 const decoded=unzipSync(new Uint8Array(await archive.arrayBuffer()));
 assert.deepEqual(decoded['A6/photo.jpg'],bytes);assert.equal(new TextDecoder().decode(decoded['A6/note café.txt']),'GPS preserved');assert.equal(decoded.empty.length,0);
 assert.equal(progress[0],0);assert.equal(progress.at(-1),1);assert.ok(progress.length>4);assert.ok(progress.every((value,i)=>!i||value>=progress[i-1]));
 assert.equal(archive.type,'application/zip');
});
test('Inspection export includes one compressed geotagged photo, keeps audio and originals, and has accurate CSV/sidecars',async()=>{
 const source=await readFile(new URL('../src/journal.js',import.meta.url),'utf8'),nodes=new Map(),progress=[];
 const original=new Blob([new Uint8Array(4000)],{type:'image/png'}),audio=new Blob(['original recording'],{type:'audio/webm'});
 const photo={id:'p',area:'a',type:'photo',created:1700000000000,blob:original,name:'photo.png',exifGPS:{latitude:51.3,longitude:-.1},gps:{latitude:52,longitude:1}},voice={id:'v',area:'a',type:'voice',created:1700000000000,blob:audio,text:'test'};
 let downloaded;
 const context={Blob,TextEncoder,Uint8Array,DataView,Date,Map,Math,Number,JSON,String,Promise,setTimeout,
  $:selector=>{if(!nodes.has(selector))nodes.set(selector,{setAttribute(){}});return nodes.get(selector)},
  state:{inspection:'i',inspections:[{id:'i',name:'Inspection'}]},currentScope:()=>({areas:[{id:'a',name:'A6'}],entries:[photo,voice]}),inspectionName:()=> 'Inspection',safe:x=>x,mediaName:e=>e===photo?'photo.png':'voice.webm',metadata:e=>({id:e.id,gps:e.gps,exifGPS:e.exifGPS}),csvCell:x=>'"'+String(x??'')+'"',
  compressExportPhoto:async()=>({blob:new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'}),compressed:true}),exportYield:async()=>{},exportZip,exportProgress:(value)=>progress.push(value),busy:async(button,fn)=>fn(),toast(){},download:(blob,name)=>{downloaded={blob,name}}};
 vm.createContext(context);
 const gps=source.slice(source.indexOf('function exifSegment('),source.indexOf('function metadata(e)'));
 const handler=source.slice(source.indexOf("$('#exportZip').onclick="),source.indexOf('\nconst toDataURL='));
 vm.runInContext(gps+'\n'+handler,context);await nodes.get('#exportZip').onclick();
 const files=unzipSync(new Uint8Array(await downloaded.blob.arrayBuffer()));
 assert.ok(files['A6/photo.jpg']);assert.ok(!Object.keys(files).some(name=>name.includes('geotagged_')||name.endsWith('photo.png')));
 const sidecar=JSON.parse(new TextDecoder().decode(files['A6/photo.jpg.gps.json']));assert.equal(sidecar.filename,'photo.jpg');assert.equal(sidecar.originalBytes,4000);assert.equal(sidecar.photoCompressed,true);
 context.bytes=files['A6/photo.jpg'];const position=vm.runInContext('parseGPS(bytes)',context);assert.ok(Math.abs(position.latitude-51.3)<.000001);assert.ok(Math.abs(position.longitude+.1)<.000001);
 assert.deepEqual(files['A6/voice.webm'],new Uint8Array(await audio.arrayBuffer()));assert.equal(photo.blob,original);assert.equal(original.size,4000);
 assert.match(new TextDecoder().decode(files['index.csv']),/A6\/photo.jpg/);assert.equal(progress.at(-1),100);assert.ok(progress.every((value,i)=>!i||value>=progress[i-1]));
});
