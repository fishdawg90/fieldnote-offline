export const GIS_LIMITS={zipBytes:100*1024*1024,unpackedBytes:256*1024*1024,files:20000,layers:80,features:100000,jsonBytes:48*1024*1024};
export function safeZipPath(name){
 const path=name.replace(/\\/g,'/');
 if(path.startsWith('/')||/^[A-Za-z]:/.test(path)||path.split('/').some(s=>s==='..'))throw Error('The ZIP contains an unsafe file path.');
 return path.replace(/^\.\//,'');
}
export function inspectZip(bytes){
 if(bytes.length>GIS_LIMITS.zipBytes)throw Error('This test accepts ZIP files up to 100 MB. Try an export with fewer layers.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break}
 if(end<0)throw Error('This is not a readable ZIP file.');
 const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true);if(count===65535||start===0xffffffff)throw Error('ZIP64 archives are not supported by this phone test.');
 if(count>GIS_LIMITS.files)throw Error('Too many files in this ZIP. Export a smaller geodatabase.');
 let p=start,total=0;const files=[];const decoder=new TextDecoder();
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw Error('The ZIP directory is damaged.');
  const flags=v.getUint16(p+8,true),size=v.getUint32(p+24,true),nl=v.getUint16(p+28,true),el=v.getUint16(p+30,true),cl=v.getUint16(p+32,true);
  if(flags&1)throw Error('Password-protected ZIP files are not supported.');
  if(size===0xffffffff||p+46+nl+el+cl>bytes.length)throw Error('ZIP64 or damaged ZIP entry.');
  const original=decoder.decode(bytes.subarray(p+46,p+46+nl)),path=safeZipPath(original);p+=46+nl+el+cl;total+=size;
  if(total>GIS_LIMITS.unpackedBytes)throw Error('The ZIP expands beyond 256 MB. Try a smaller layer export for this test.');
  if(path.endsWith('/')||path.startsWith('__MACOSX/')||path.split('/').pop()==='.DS_Store')continue;
  files.push({original,path,size});
 }
 const roots=new Map();
 for(const file of files){
  const parts=file.path.split('/'),gdbIndex=parts.findIndex(s=>/\.gdb$/i.test(s));
  if(gdbIndex>=0){const root=parts.slice(0,gdbIndex+1).join('/');if(!roots.has(root))roots.set(root,{key:root,kind:'gdb',label:parts[gdbIndex],files:[]});roots.get(root).files.push(file)}
 }
 // Support ZIPs where the .gdb directory was flattened during extraction/repacking.
 if(!roots.size){const folders=new Map();for(const f of files)if(/^a[0-9a-f]+\.gdbtable$/i.test(f.path.split('/').pop())){const dir=f.path.slice(0,f.path.lastIndexOf('/')+1);folders.set(dir,true)}
  for(const dir of folders.keys())roots.set(dir||'__flat__',{key:dir||'__flat__',kind:'gdb',label:(dir.split('/').filter(Boolean).pop()||'Airfield')+'.gdb',files:files.filter(f=>f.path.startsWith(dir)&&!f.path.slice(dir.length).includes('/')),flat:true,dir});
 }
 const datasets=Array.from(roots.values()).filter(r=>r.files.some(f=>/\.gdbtable$/i.test(f.path)));
 if(!datasets.length)for(const f of files)if(/\.(geojson|json)$/i.test(f.path))datasets.push({key:f.path,kind:'geojson',label:f.path,files:[f]});
 return{fileCount:files.length,unpackedBytes:total,datasets,files};
}
export function normaliseDataset(bytes,report,key,unzip,zip){
 const dataset=report.datasets.find(x=>x.key===key);if(!dataset)throw Error('No supported dataset was found. Keep the complete .gdb folder and its companion files in the ZIP.');
 const names=new Set(dataset.files.map(f=>f.original)),extracted=unzip(bytes,{filter:f=>names.has(f.name)});
 if(dataset.kind==='geojson')return{bytes:extracted[dataset.files[0].original],name:'layout.geojson',kind:'geojson'};
 const output={};
 for(const f of dataset.files){const rel=dataset.flat?f.path.slice(dataset.dir.length):f.path.slice(dataset.key.length+1);if(!rel||rel.endsWith('.lock'))continue;output['airfield.gdb/'+rel]=extracted[f.original]}
 if(!Object.keys(output).some(p=>/\.gdbtable$/i.test(p))||!Object.keys(output).some(p=>/\.gdbtablx$/i.test(p)))throw Error('The ZIP is missing geodatabase tables or companion indexes. Select the original, complete ZIP.');
 return{bytes:zip(output,{level:1}),name:'airfield.gdb.zip',kind:'gdb'};
}
export function geometryCount(collection){
 return collection.features.filter(f=>f.geometry&&(f.geometry.type==='GeometryCollection'?f.geometry.geometries?.length:f.geometry.coordinates?.length)).length;
}
export async function convertGisDataset(gdal,dataset,sourceCRS='',progress=()=>{}){
 if(sourceCRS&&!/^EPSG:\d{3,6}$/i.test(sourceCRS))throw Error('Use a source reference such as EPSG:27700, or leave it blank.');
 const info=await gdal.getInfo(dataset);if(info.type!=='vector')throw Error('This test views vector layers. This dataset contains raster data.');
 const metadata=await gdal.ogrinfo(dataset,['-al','-so']).catch(()=>({layers:[]}));
 const layers=[],warnings=[],details=[];let features=0;
 if(info.layers.length>GIS_LIMITS.layers)throw Error('More than 80 layers found. Export a smaller set for this phone test.');
 for(let i=0;i<info.layers.length;i++){
  const entry=info.layers[i],meta=metadata.layers?.find(l=>l.name===entry.name),geometry=meta?.geometryFields||[];
  const wkt=geometry[0]?.coordinateSystem?.wkt||'',crs=geometry[0]?.coordinateSystem?.projjson?.id;
  const hasCRS=!!sourceCRS||!!wkt,mode=hasCRS?'geographic':'local';
  const summary={name:entry.name,features:entry.featureCount,geometry:geometry.map(g=>g.type).join(', '),sourceCRS:sourceCRS||(crs?crs.authority+':'+crs.code:wkt.match(/^(?:PROJCRS|GEOGCRS|PROJCS|GEOGCS)\["([^"]+)"/)?.[1]||'Unknown'),sourceWKT:wkt};details.push(summary);
  if(meta&&geometry.length===0){summary.skipped='Non-spatial table';continue}
  progress('Reading '+entry.name+' · '+(i+1)+' / '+info.layers.length);
  if(entry.featureCount>GIS_LIMITS.features){summary.skipped='Too many features';warnings.push(entry.name+': over 100,000 features; skipped.');continue}
  try{
   const options=['-f','GeoJSON','-dim','XY'];if(sourceCRS)options.push('-s_srs',sourceCRS.toUpperCase());if(hasCRS)options.push('-t_srs','EPSG:4326','-lco','RFC7946=YES');options.push(entry.name);
   const output=await gdal.ogr2ogr(dataset,options,'layer_'+i),data=await gdal.getFileBytes(output);
   if(data.byteLength>GIS_LIMITS.jsonBytes)throw Error('Converted layer exceeds 48 MB; export a smaller layer.');
   const json=JSON.parse(new TextDecoder().decode(data));if(!Array.isArray(json.features))throw Error('Layer did not produce GeoJSON features.');
   const count=geometryCount(json);if(!count){summary.skipped='No geometry';continue}
   if(features+count>GIS_LIMITS.features)throw Error('Combined layout exceeds 100,000 features.');
   features+=count;layers.push({id:'layer-'+i,name:entry.name,mode,features:count,geojson:json,visible:true});summary.loaded=count;
   if(mode==='local')warnings.push(entry.name+': source coordinate system missing; shown in local XY view, with GPS disabled.');
  }catch(error){summary.error=String(error.message||error);warnings.push(entry.name+': '+summary.error)}
 }
 if(!layers.length)throw Error('No drawable vector layers could be read. '+warnings.slice(0,3).join(' '));
 return{layers,warnings,details,driver:info.driverName,layerCount:info.layers.length,featureCount:features,viewMode:layers.some(l=>l.mode==='geographic')?'geographic':'local'};
}
