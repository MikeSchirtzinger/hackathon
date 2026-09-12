// One acknowledged decode at a time. Audio waiting for decode lives in IndexedDB,
// not in an uninspectable Worker message queue. Inspired by silent-notetaker's
// bounded spill/ack design; this small implementation uses IndexedDB, not OPFS.
export class AudioQueue {
  constructor(){this.head=0;this.tail=0;this.samples=0;this.writes=0;this.closed=false;}
  async open(){
    this.name=`zoom-audio-${crypto.randomUUID()}`;
    this.db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(this.name,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('pcm');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  transaction(mode,operation){return new Promise((resolve,reject)=>{
    const tx=this.db.transaction('pcm',mode);let result;
    const request=operation(tx.objectStore('pcm'));
    request.onsuccess=()=>{result=request.result;};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Audio storage aborted'));
  });}
  async push(samples){
    if(this.closed)throw Error('Audio queue closed');
    if(this.samples+samples.length>16000*1800)throw Error('Audio backlog exceeded 30 minutes; stopping capture without silently dropping speech.');
    if(this.writes>=300)throw Error('Audio storage cannot keep up (60 seconds pending writes).');
    const id=this.tail++;this.samples+=samples.length;this.writes++;
    try{await this.transaction('readwrite',s=>s.put(samples,id));}finally{this.writes--;}
  }
  async peek(){if(this.head>=this.tail)return null;return await this.transaction('readonly',s=>s.get(this.head))||null;}
  async ack(length){await this.transaction('readwrite',s=>s.delete(this.head));this.head++;this.samples-=length;}
  close(){this.closed=true;this.db?.close();if(this.name)indexedDB.deleteDatabase(this.name);}
}
