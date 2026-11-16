import { pipeline, env } from './vendor/transformers.web.min.js';
import { MODELS } from './offline-config.js';
const base=new URL('./',self.location.href);
// Inference is strictly local. No Hugging Face/network fallback exists here.
env.allowRemoteModels=false;
env.allowLocalModels=true;
env.localModelPath=new URL('./models/',base).href;
env.useBrowserCache=false;
env.useFSCache=false;
env.backends.onnx.wasm.wasmPaths=new URL('./vendor/',base).href;
env.backends.onnx.wasm.numThreads=1;
env.backends.onnx.wasm.proxy=false;
const realFetch=self.fetch.bind(self);
self.fetch=(input,options)=>{
 const url=new URL(typeof input==='string'?input:input.url,base);
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw Error('External requests are disabled during transcription.');
 return realFetch(input,options);
};
let transcriber=null,loadedModel=null,working=false;
async function load(key){
 const model=MODELS[key]||MODELS.tiny;
 if(transcriber&&loadedModel!==model.key){await transcriber.dispose();transcriber=null}
 if(!transcriber){
  postMessage({type:'status',text:'Loading Whisper from this phone’s offline storage…'});
  transcriber=await pipeline('automatic-speech-recognition',model.id,{device:'wasm',dtype:'q8',local_files_only:true});loadedModel=model.key;
 }
 return transcriber;
}
self.onmessage=async({data})=>{
 if(working){postMessage({type:'error',id:data.id,message:'Whisper is already processing a clip.'});return}
 working=true;
 try{
  const model=await load(data.modelKey);
  if(data.type==='load'){postMessage({type:'ready',id:data.id});return}
  postMessage({type:'status',text:'Transcribing locally. Keep this screen open…'});
  const output=await model(data.audio,{chunk_length_s:20,stride_length_s:3,return_timestamps:false,max_new_tokens:160});
  postMessage({type:'result',id:data.id,text:output.text.trim()});
 }catch(e){transcriber=null;postMessage({type:'error',id:data.id,message:e.message||String(e)})}
 finally{working=false}
};
