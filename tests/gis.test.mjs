import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {unzipSync,zipSync,strToU8} from 'fflate';
import {inspectZip,normaliseDataset,safeZipPath,convertGisDataset} from '../src/gis-core.js';
const fixture=new Uint8Array(Buffer.from((await readFile(new URL('./fixtures/airfield.gdb.zip.b64',import.meta.url),'utf8')).trim(),'base64'));
test('FileGDB ZIP inventory recognises the complete database and excludes unrelated files',()=>{
 const report=inspectZip(fixture);assert.equal(report.datasets.length,1);assert.equal(report.datasets[0].kind,'gdb');assert.ok(report.fileCount>10);assert.ok(report.datasets[0].files.some(f=>f.path.endsWith('.gdbtable')));
 assert.throws(()=>safeZipPath('../private.txt'),/unsafe/);assert.throws(()=>safeZipPath('C:\\private.txt'),/unsafe/);assert.throws(()=>inspectZip(new Uint8Array([1,2,3])),/ZIP/);
});
test('Nested and flattened .gdb archives are normalised into a top-level geodatabase',()=>{
 const files=unzipSync(fixture),nested={},flat={};for(const [name,bytes] of Object.entries(files)){nested['export/airport/'+name]=bytes;flat[name.split('/').pop()]=bytes}
 for(const archive of [zipSync(nested),zipSync(flat)]){
  const report=inspectZip(archive);assert.equal(report.datasets.length,1);const normal=normaliseDataset(archive,report,report.datasets[0].key,unzipSync,zipSync);assert.equal(normal.name,'airfield.gdb.zip');assert.ok(Object.keys(unzipSync(normal.bytes)).every(name=>name.startsWith('airfield.gdb/')));
 }
});
test('An index-only ZIP fails clearly rather than pretending to contain geometry',()=>{
 const archive=zipSync({'a00000001.spx':strToU8('index')}),report=inspectZip(archive);assert.equal(report.datasets.length,0);assert.throws(()=>normaliseDataset(archive,report,'x',unzipSync,zipSync),/complete .gdb/);
});
test('The actual WASM FileGDB reader loads polygon, line and point layers and reprojects them',async()=>{
 const require=createRequire(import.meta.url),init=require('gdal3.js/dist/package/gdal3.node.js');
 const directory=await mkdtemp(path.join(os.tmpdir(),'fieldnote-gis-test-'));
 let g,dataset;
 try{
  const report=inspectZip(fixture),normal=normaliseDataset(fixture,report,report.datasets[0].key,unzipSync,zipSync),file=path.join(directory,'airfield.gdb.zip');await writeFile(file,normal.bytes);
  g=await init({path:'node_modules/gdal3.js/dist/package',dest:directory,useWorker:false});
  dataset=(await g.open(file,[],['vsizip'])).datasets[0];assert.ok(dataset);
  const result=await convertGisDataset(g,dataset);assert.equal(result.layers.length,3);assert.equal(result.featureCount,3);assert.equal(result.viewMode,'geographic');assert.ok(result.layers.every(l=>l.mode==='geographic'));
  const runway=result.layers.find(l=>l.name==='Runways'),first=runway.geojson.features[0].geometry.coordinates[0][0];assert.ok(Math.abs(first[0]+.11)<.00001);assert.ok(Math.abs(first[1]-51.3)<.00001);assert.equal(runway.geojson.features[0].properties.name,'Test runway');
  assert.ok(result.details.every(l=>l.sourceWKT.includes('Pseudo-Mercator')));
 }finally{if(dataset)await g.close(dataset);await rm(directory,{recursive:true,force:true})}
});
