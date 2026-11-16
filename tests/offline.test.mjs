import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MODEL_FILES,MODEL_REVISION,modelURL,downloadURL} from '../src/offline-config.js';
test('All offline model assets are pinned; large model files are hash-verified',()=>{
 assert.match(MODEL_REVISION,/^[0-9a-f]{40}$/);assert.equal(MODEL_FILES.length,7);
 for(const f of MODEL_FILES){assert.ok(f.size>0);if(f.path.endsWith('.onnx'))assert.match(f.sha256,/^[0-9a-f]{64}$/)}
 assert.ok(MODEL_FILES.reduce((s,f)=>s+f.size,0)<50e6);
});
test('Project subpath stays inside the GitHub Pages repository',()=>{
 const base='https://example.github.io/fieldnote-offline/';
 assert.equal(modelURL(base,'config.json'),base+'models/Xenova/whisper-tiny.en/config.json');
 assert.ok(downloadURL('config.json').includes('/'+MODEL_REVISION+'/config.json'));
});
test('Inference disables remote models and rejects external fetches',async()=>{
 const s=await readFile(new URL('../src/whisper-worker.js',import.meta.url),'utf8');
 assert.match(s,/env\.allowRemoteModels=false/);assert.match(s,/local_files_only:true/);assert.match(s,/url\.origin!==base\.origin/);
});
test('Recording is saved before offline transcription, with no live speech service',async()=>{
 const s=await readFile(new URL('../src/journal.js',import.meta.url),'utf8');
 assert.ok(!s.includes('new SR('));assert.ok(!s.includes('webkitSpeechRecognition'));
 const saved=s.indexOf("await put('entries',entry)");const transcribed=s.indexOf('await transcribeSaved(entry.id)');
 assert.ok(saved>=0&&transcribed>saved);assert.match(s,/getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/);
});
test('Model cache fetches cannot fall back to network',async()=>{
 const sw=await readFile(new URL('../src/sw-template.js',import.meta.url),'utf8');
 const modelBranch=sw.slice(sw.indexOf("if(relative.startsWith('models/'))"),sw.indexOf('event.respondWith((async()=>'));
 assert.match(modelBranch,/status:404/);assert.ok(!modelBranch.includes('fetch('));
});
test('Speech fixture is a six-second mono PCM file at 16 kHz',async()=>{
 const b=await readFile(new URL('../src/sample.wav',import.meta.url));
 assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt16LE(22),1);assert.equal(b.readUInt32LE(24),16000);assert.equal(b.length,192044);
});
