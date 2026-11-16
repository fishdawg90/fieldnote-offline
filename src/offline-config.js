const tinyFiles=[
 {path:'config.json',size:2202},{path:'generation_config.json',size:1590},{path:'preprocessor_config.json',size:339},{path:'tokenizer.json',size:2128494},{path:'tokenizer_config.json',size:835},
 {path:'onnx/encoder_model_quantized.onnx',size:10124913,sha256:'8cc3c6f8563d1b3fbd2c5af9f64c2bed8b020bc593c402d1ef53b9f08fbf1b90'},
 {path:'onnx/decoder_model_merged_quantized.onnx',size:30727382,sha256:'dbb2e063b7fbc41d9803b9698f93ecb035c50cbb3fb87b56cb131e4a5eb99059'}
];
const baseFiles=[
 {path:'config.json',size:2202},{path:'generation_config.json',size:1500},{path:'preprocessor_config.json',size:339},{path:'tokenizer.json',size:2128494},{path:'tokenizer_config.json',size:835},
 {path:'onnx/encoder_model_quantized.onnx',size:23200856,sha256:'d0d4e59e2842617b39787cece73d7e8f76f99b1697d3386c0e682eca2269f4a1'},
 {path:'onnx/decoder_model_merged_quantized.onnx',size:53707027,sha256:'a25afc5858a20aabb7652cb2d555996ebe10691a69bbdb423d5073d52f060325'}
];
function model(key,name,id,revision,files){return{key,name,id,revision,files,cache:'fieldnote-whisper-'+revision,bytes:files.reduce((n,f)=>n+f.size,0)}}
export const MODELS={
 tiny:model('tiny','Whisper Tiny English','Xenova/whisper-tiny.en','79fb389fc764e7c395bd330e9531d9d32ada7049',tinyFiles),
 base:model('base','Whisper Base English','Xenova/whisper-base.en','95bf40a508535962c6483ead40270b2e32267508',baseFiles)
};
export const MODEL_ID=MODELS.tiny.id,MODEL_REVISION=MODELS.tiny.revision,MODEL_CACHE=MODELS.tiny.cache,MODEL_FILES=MODELS.tiny.files;
export const modelURL=(base,file,model=MODELS.tiny)=>new URL('models/'+model.id+'/'+file,base).href;
export const downloadURL=(file,model=MODELS.tiny)=>'https://huggingface.co/'+model.id+'/resolve/'+model.revision+'/'+file;
