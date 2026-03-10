import fs from 'fs';

export class FSMap<K, V> implements Map<K, V> {
  get size() { return this.map.size; }
  // Iterator
  get [Symbol.iterator]() {
    return this.map[Symbol.iterator].bind(this.map);
  }

  // eslint-disable-next-line @typescript-eslint/class-literal-property-style, class-methods-use-this
  get [Symbol.toStringTag]() {
    return 'FSMap';
  }

  private map = new Map<K, V>();
  private path: string;
  constructor(path: string) {
    this.path = path;
    if (!fs.existsSync(path)) fs.writeFileSync(this.path, '[]', 'utf8');
    this.map = new Map<K, V>(JSON.parse(fs.readFileSync(path, 'utf8')));
  }
  clear() {
    this.map.clear();
    fs.writeFileSync(this.path, JSON.stringify([...this.map]), 'utf8');
  }
  // Write
  delete(key: K) {
    const status = this.map.delete(key);
    fs.writeFileSync(this.path, JSON.stringify([...this.map]), 'utf8');
    return status;
  }
  entries = () => this.map.entries();
  forEach = (callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown) => this.map.forEach(callbackfn, thisArg);

  // Read
  get = (key: K) => this.map.get(key);
  getOrInsert = (key: K, defaultValue: V): V => {
    const v = this.map.get(key)
    if (v) return v
    this.map.set(key, defaultValue)
    return defaultValue
  };
  getOrInsertComputed = (key: K, callback: (key: K) => V): V => {
    const v = this.map.get(key)
    if (v) return v
    const newValue = callback(key)
    this.map.set(key, newValue)
    return newValue
  };
  has = (key: K) => this.map.has(key);
  keys = () => this.map.keys();

  set(key: K, value: V) {
    this.map.set(key, value)
    fs.writeFileSync(this.path, JSON.stringify([...this.map]), 'utf8');
    return this;
  }
  values = () => this.map.values();
}
