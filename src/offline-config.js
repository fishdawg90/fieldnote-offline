export const MODEL_ID='Xenova/whisper-tiny.en';
export const MODEL_REVISION='79fb389fc764e7c395bd330e9531d9d32ada7049';
export const MODEL_CACHE='fieldnote-whisper-'+MODEL_REVISION;
export const MODEL_FILES=[
 {path:'config.json',size:2202},
 {path:'generation_config.json',size:1590},
 {path:'preprocessor_config.json',size:339},
 {path:'tokenizer.json',size:2128494},
 {path:'tokenizer_config.json',size:835},
 {path:'onnx/encoder_model_quantized.onnx',size:10124913,sha256:'8cc3c6f8563d1b3fbd2c5af9f64c2bed8b020bc593c402d1ef53b9f08fbf1b90'},
 {path:'onnx/decoder_model_merged_quantized.onnx',size:30727382,sha256:'dbb2e063b7fbc41d9803b9698f93ecb035c50cbb3fb87b56cb131e4a5eb99059'}
];
export const modelURL=(base,file)=>new URL('models/'+MODEL_ID+'/'+file,base).href;
export const downloadURL=file=>'https://huggingface.co/'+MODEL_ID+'/resolve/'+MODEL_REVISION+'/'+file;
