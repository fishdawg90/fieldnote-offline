importScripts('./sw-config.js');
const {CACHE,FILES,MODEL_CACHE}=self.FIELDNOTE_CACHE;
const scope=new URL('./',self.location.href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 // Sequential writes limit peak memory on phones and keep failures resumable.
 for(const [i,path] of FILES.entries()){for(const client of await self.clients.matchAll({includeUncontrolled:true}))client.postMessage({type:'shell-progress',text:'Saving app files for offline use · '+(i+1)+' / '+FILES.length});const url=new URL(path,scope).href;if(!await cache.match(url)){const response=await fetch(url,{cache:'reload'});if(!response.ok)throw Error('Offline file missing: '+path);await cache.put(url,response)}}
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
 if(relative.startsWith('models/')){
  // Model inference never downloads or calls an external service.
  event.respondWith((async()=>{
   const cache=await caches.open(MODEL_CACHE),response=await cache.match(request);
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
  const cache=await caches.open(CACHE),cached=await cache.match(request,{ignoreSearch:true});
  if(cached)return cached;
  if(request.mode==='navigate')return await cache.match(new URL('./index.html',scope).href)||fetch(request);
  return fetch(request);
 })());
});
