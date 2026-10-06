// Only encoded buffers are retained: cache capacity measures actual payload bytes,
// rather than assuming each filter result consumes the same amount of memory.
export class BoundedJsonCache {
  constructor({maxBytes=32*1024*1024,ttlMs=60000,maxEntries=50}={}) {
    this.maxBytes=maxBytes;this.ttlMs=ttlMs;this.maxEntries=maxEntries;
    this.entries=new Map();this.bytes=0;this.hits=0;this.misses=0;
  }
  delete(key) {
    const entry=this.entries.get(key);
    if(entry) {this.bytes-=entry.buffer.length;this.entries.delete(key);}
  }
  clear() {this.entries.clear();this.bytes=0;}
  get(key) {
    const entry=this.entries.get(key);
    if(!entry || Date.now()-entry.createdAt>=this.ttlMs) {
      this.delete(key);this.misses++;return null;
    }
    this.entries.delete(key);this.entries.set(key,entry);this.hits++;
    return JSON.parse(entry.buffer.toString('utf8'));
  }
  set(key,data) {
    const buffer=Buffer.from(JSON.stringify(data));
    this.delete(key);
    if(buffer.length>this.maxBytes) return false;
    while(this.entries.size && (this.bytes+buffer.length>this.maxBytes || this.entries.size>=this.maxEntries)) this.delete(this.entries.keys().next().value);
    this.entries.set(key,{buffer,createdAt:Date.now()});this.bytes+=buffer.length;return true;
  }
  stats() {return {bytes:this.bytes,maxBytes:this.maxBytes,entries:this.entries.size,hits:this.hits,misses:this.misses};}
}
