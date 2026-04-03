import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'fs'
import path from 'path'

import { FSMap } from './FSMap'

const TMP_DIR = '/tmp/fsmap-tests'
let testFile: string
let counter = 0

beforeEach(() => {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  testFile = path.join(TMP_DIR, `fsmap-${Date.now()}-${counter++}.json`)
})

afterEach(() => {
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile)
})

describe('FSMap construction', () => {
  it('creates the backing file if it does not exist', () => {
    new FSMap(testFile)
    expect(fs.existsSync(testFile)).toBe(true)
  })

  it('starts empty when the backing file does not exist', () => {
    const map = new FSMap<string, number>(testFile)
    expect(map.size).toBe(0)
  })

  it('loads existing entries from disk on construction', () => {
    fs.writeFileSync(testFile, JSON.stringify([['key1', 'value1'], ['key2', 'value2']]), 'utf8')
    const map = new FSMap<string, string>(testFile)
    expect(map.size).toBe(2)
    expect(map.get('key1')).toBe('value1')
    expect(map.get('key2')).toBe('value2')
  })
})

describe('FSMap set and get', () => {
  it('sets a key-value pair and retrieves it', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('a', 1)
    expect(map.get('a')).toBe(1)
  })

  it('persists set operations to disk', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('x', 42)
    const contents = JSON.parse(fs.readFileSync(testFile, 'utf8'))
    expect(contents).toContainEqual(['x', 42])
  })

  it('overwrites existing value for the same key', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('k', 1)
    map.set('k', 99)
    expect(map.get('k')).toBe(99)
  })

  it('returns undefined for a missing key', () => {
    const map = new FSMap<string, number>(testFile)
    expect(map.get('missing')).toBeUndefined()
  })
})

describe('FSMap has', () => {
  it('returns true for an existing key', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('exists', 1)
    expect(map.has('exists')).toBe(true)
  })

  it('returns false for a missing key', () => {
    const map = new FSMap<string, number>(testFile)
    expect(map.has('missing')).toBe(false)
  })
})

describe('FSMap delete', () => {
  it('deletes an existing key', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('del', 1)
    map.delete('del')
    expect(map.has('del')).toBe(false)
    expect(map.size).toBe(0)
  })

  it('persists delete to disk', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('del', 1)
    map.delete('del')
    const contents = JSON.parse(fs.readFileSync(testFile, 'utf8'))
    expect(contents.find(([k]: [string]) => k === 'del')).toBeUndefined()
  })

  it('returns true when deleting an existing key', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('y', 2)
    expect(map.delete('y')).toBe(true)
  })

  it('returns false when deleting a nonexistent key', () => {
    const map = new FSMap<string, number>(testFile)
    expect(map.delete('nonexistent')).toBe(false)
  })
})

describe('FSMap clear', () => {
  it('removes all entries', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('a', 1)
    map.set('b', 2)
    map.clear()
    expect(map.size).toBe(0)
    expect(map.has('a')).toBe(false)
  })

  it('writes empty array to disk after clear', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('a', 1)
    map.clear()
    const contents = JSON.parse(fs.readFileSync(testFile, 'utf8'))
    expect(contents).toHaveLength(0)
  })
})

describe('FSMap size', () => {
  it('reflects the number of entries', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('a', 1)
    map.set('b', 2)
    expect(map.size).toBe(2)
    map.delete('a')
    expect(map.size).toBe(1)
  })
})

describe('FSMap iteration', () => {
  it('keys() returns all keys', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('x', 1)
    map.set('y', 2)
    expect([...map.keys()]).toEqual(['x', 'y'])
  })

  it('values() returns all values', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('x', 10)
    map.set('y', 20)
    expect([...map.values()]).toEqual([10, 20])
  })

  it('entries() returns all entries', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('x', 10)
    expect([...map.entries()]).toContainEqual(['x', 10])
  })

  it('forEach iterates over all entries', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('a', 1)
    map.set('b', 2)
    const collected: [string, number][] = []
    map.forEach((value, key) => collected.push([key, value]))
    expect(collected).toContainEqual(['a', 1])
    expect(collected).toContainEqual(['b', 2])
  })
})

describe('FSMap getOrInsert', () => {
  it('returns the existing value if key exists', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('k', 99)
    expect(map.getOrInsert('k', 0)).toBe(99)
  })

  it('inserts and returns the default value if key is missing', () => {
    const map = new FSMap<string, number>(testFile)
    expect(map.getOrInsert('new', 42)).toBe(42)
    expect(map.get('new')).toBe(42)
  })
})

describe('FSMap getOrInsertComputed', () => {
  it('returns the existing value if key exists', () => {
    const map = new FSMap<string, number>(testFile)
    map.set('k', 5)
    expect(map.getOrInsertComputed('k', () => 999)).toBe(5)
  })

  it('computes and inserts when key is missing', () => {
    const map = new FSMap<string, number>(testFile)
    expect(map.getOrInsertComputed('new', k => k.length)).toBe(3)
    expect(map.get('new')).toBe(3)
  })
})

describe('FSMap persistence across instances', () => {
  it('second instance reads data written by first instance', () => {
    const map1 = new FSMap<string, string>(testFile)
    map1.set('persistent', 'hello')

    const map2 = new FSMap<string, string>(testFile)
    expect(map2.get('persistent')).toBe('hello')
  })
})

describe('FSMap Symbol.toStringTag', () => {
  it('has a toStringTag of FSMap', () => {
    const map = new FSMap<string, number>(testFile)
    expect(map[Symbol.toStringTag]).toBe('FSMap')
  })
})
