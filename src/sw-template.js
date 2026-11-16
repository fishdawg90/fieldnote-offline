importScripts('./sw-config.js');
const {CACHE,FILES,MODEL_CACHE,MODEL_ROUTES,RUNTIME_CACHE}=self.FIELDNOTE_CACHE;
const scope=new URL('./',self.location.href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 // Remove incomplete shells left by interrupted updates, keeping the last complete app.
 for(const name of await caches.keys())if(name.startsWith('fieldnote-shell-')&&name!==CACHE){
  const previous=await caches.open(name);if(!await previous.match(new URL('offline-assets.json',scope).href))await caches.delete(name);
 }
 const cache=await caches.open(CACHE);
 // Discard interrupted model-file fragments; complete model files are retained.
 for(const name of new Set([MODEL_CACHE,...Object.values(MODEL_ROUTES||{})])){
 const models=await caches.open(name);
 for(const key of await models.keys())if(new URL(key.url).searchParams.has('chunk')){const base=key.url.split('?')[0];if(!await models.match(base))await models.delete(key)}
 }
 // Runtime files are shared across app updates. Migrate earlier cached files without redownloading.
 const runtime=await caches.open(RUNTIME_CACHE||CACHE);
 for(const [i,path] of FILES.entries()){
  for(const client of await self.clients.matchAll({includeUncontrolled:true}))client.postMessage({type:'shell-progress',text:'Updating offline app · '+(i+1)+' / '+FILES.length});
  const url=new URL(path,scope).href,target=path.startsWith('vendor/')?runtime:cache;
  if(await target.match(url))continue;
  let response;
  if(path.startsWith('vendor/'))for(const name of await caches.keys()){
   if(!name.startsWith('fieldnote-shell-')||name===CACHE)continue;
   const previous=await caches.open(name),existing=await previous.match(url);
   if(existing){response=existing;await previous.delete(url);break}
  }
  response??=await fetch(url,{cache:'reload'});if(!response.ok)throw Error('Offline file missing: '+path);try{await target.put(url,response)}catch(error){throw Error('Saving '+path+': '+error.message)}
 }
 await self.skipWaiting();
})().catch(async error=>{for(const client of await self.clients.matchAll({includeUncontrolled:true}))client.postMessage({type:'shell-error',text:error.message});throw error})));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith('fieldnote-shell-')&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 const relative=url.pathname.slice(scope.pathname.length);
 if(relative.startsWith('gis-runtime/')){
  event.respondWith((async()=>{
   const cache=await caches.open('fieldnote-gis-runtime-2.8.1'),response=await cache.match(request);
   if(!response)return fetch(request);
   const chunks=Number(response.headers.get('x-fieldnote-chunks')||0);if(!chunks)return response;
   let i=0,reader=null;
   const stream=new ReadableStream({async pull(controller){try{while(true){if(reader){const next=await reader.read();if(!next.done){controller.enqueue(next.value);return}reader=null}if(i>=chunks){controller.close();return}const part=await cache.match(request.url+'?chunk='+i++);if(!part)throw Error('GIS runtime chunk missing. Prepare GIS offline again.');reader=part.body.getReader()}}catch(error){controller.error(error)}},cancel(){return reader?.cancel()}});
   return new Response(stream,{headers:{'Content-Type':'application/octet-stream','Content-Length':response.headers.get('x-fieldnote-size')}});
  })());return;
 }
 if(relative.startsWith('models/')){
  // Model inference never downloads or calls an external service.
  event.respondWith((async()=>{
   const route=Object.entries(MODEL_ROUTES||{}).find(([prefix])=>relative.startsWith(prefix));
   const cache=await caches.open(route?route[1]:MODEL_CACHE),response=await cache.match(request);
   if(!response)return new Response('Model asset is not prepared on this phone.',{status:404});
   const chunks=Number(response.headers.get('x-fieldnote-chunks')||0);if(!chunks)return response;
   let index=0,reader=null;
   const stream=new ReadableStream({async pull(controller){
    try{
     while(true){
      if(reader){const next=await reader.read();if(!next.done){controller.enqueue(next.value);return}reader=null}
      if(index>=chunks){controller.close();return}
      const part=await cache.match(request.url+'?chunk='+index++);if(!part)throw Error('Offline model chunk is missing. Run setup again.');reader=part.body.getReader();
     }
    }catch(error){controller.error(error)}
   },cancel(){return reader?.cancel()}});
   return new Response(stream,{headers:{'Content-Type':'application/octet-stream','Content-Length':response.headers.get('x-fieldnote-size')}});
  })());return;
 }
 event.respondWith((async()=>{
  const cache=await caches.open(relative.startsWith('vendor/')?(RUNTIME_CACHE||CACHE):CACHE),cached=await cache.match(request,{ignoreSearch:true});
  if(cached)return cached;
  if(request.mode==='navigate')return await cache.match(new URL('./index.html',scope).href)||fetch(request);
  return fetch(request);
 })());
});
