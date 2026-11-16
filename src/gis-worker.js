importScripts('./gis/fflate.js','./gis-core-classic.js');
let input=null,report=null,gdal=null,working=false;
const base=new URL('./',self.location.href),messages=[];
const progress=text=>postMessage({type:'progress',text});
async function engine(){
 if(!gdal){
  progress('Starting local GIS reader…');importScripts('./gis-runtime/gdal3.js');
  gdal=await initGdalJs({path:new URL('./gis-runtime/',base).href,useWorker:false,env:{PROJ_NETWORK:'OFF'},logHandler:m=>{messages.push(String(m));if(messages.length>40)messages.shift()},errorHandler:m=>{messages.push(String(m));if(messages.length>40)messages.shift()}});
 }
 return gdal;
}
self.onmessage=async({data})=>{
 if(working)return;working=true;
 try{
  if(data.action==='scan'){
   input=new Uint8Array(data.bytes);report=inspectZip(input);
   const datasets=report.datasets.map(d=>({key:d.key,label:d.label,kind:d.kind,files:d.files.length}));
   if(!datasets.length)throw Error('No File Geodatabase or GeoJSON was found. The ZIP needs the complete .gdb folder, including .gdbtable and .gdbtablx files.');
   postMessage({type:'scan',datasets,diagnostics:{zipBytes:input.byteLength,fileCount:report.fileCount,unpackedBytes:report.unpackedBytes,datasets}});return;
  }
  if(data.action==='load'){
   if(!input||!report)throw Error('Choose the ZIP again.');
   progress('Preparing geodatabase files locally…');
   const normal=normaliseDataset(input,report,data.key,fflate.unzipSync,fflate.zipSync),g=await engine();
   const file=new File([normal.bytes],normal.name);normal.bytes=null;
   const opened=await g.open(file,[],normal.kind==='gdb'?['vsizip']:[]);
   const dataset=opened.datasets.find(d=>d.type==='vector')||opened.datasets[0];
   if(!dataset)throw Error('No readable dataset. '+(opened.errors||[]).join(' '));
   const result=await convertGisDataset(g,dataset,data.sourceCRS||'',progress);await g.close(dataset);
   postMessage({type:'loaded',result:{...result,dataset:report.datasets.find(x=>x.key===data.key)?.label,log:messages.slice(-15)}});
  }
 }catch(error){postMessage({type:'error',message:Array.isArray(error)?error.join(' '):String(error.message||error),log:messages.slice(-15)})}
 finally{working=false}
};
