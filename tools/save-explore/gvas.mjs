// Minimal, exploratory GVAS (Unreal Engine SaveGame) binary parser.
// Goal: read-only, resilient walk of a .sav file into a JS object tree,
// skipping anything unrecognized rather than crashing, so we can inspect
// the real structure of "The Artisan of Glimmith" save data.

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  get remaining() { return this.buf.length - this.pos; }
  u8() { const v = this.buf.readUInt8(this.pos); this.pos += 1; return v; }
  i32() { const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  u32() { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  u16() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  i64() { const v = this.buf.readBigInt64LE(this.pos); this.pos += 8; return v; }
  u64() { const v = this.buf.readBigUInt64LE(this.pos); this.pos += 8; return v; }
  f32() { const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
  f64() { const v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v; }
  bytes(n) { const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  guid() { return this.bytes(16).toString('hex'); }
  seek(p) { this.pos = p; }
  skip(n) { this.pos += n; }

  fstring() {
    const len = this.i32();
    if (len === 0) return '';
    if (len > 0) {
      // ASCII/UTF-8, null terminated
      const raw = this.bytes(len);
      let s = raw.toString('latin1');
      if (s.endsWith('\0')) s = s.slice(0, -1);
      return s;
    } else {
      // UTF-16LE, null terminated, length is negative char count
      const n = -len;
      const raw = this.bytes(n * 2);
      let s = raw.toString('utf16le');
      if (s.endsWith('\0')) s = s.slice(0, -1);
      return s;
    }
  }
}

const FIXED_STRUCTS = {
  Vector: { fields: ['X', 'Y', 'Z'], type: 'f64' }, // UE5-style double vectors; will auto-detect below
  Vector2D: { fields: ['X', 'Y'], type: 'f64' },
  Rotator: { fields: ['Pitch', 'Yaw', 'Roll'], type: 'f64' },
  Quat: { fields: ['X', 'Y', 'Z', 'W'], type: 'f64' },
  IntPoint: { fields: ['X', 'Y'], type: 'i32' },
  IntVector: { fields: ['X', 'Y', 'Z'], type: 'i32' },
  LinearColor: { fields: ['R', 'G', 'B', 'A'], type: 'f32' },
  Color: { fields: ['B', 'G', 'R', 'A'], type: 'u8' },
  Guid: { raw: 16 },
  DateTime: { raw: 8, as: 'i64' },
  Timespan: { raw: 8, as: 'i64' },
};

function readFixedStruct(r, structName, size) {
  const spec = FIXED_STRUCTS[structName];
  if (!spec) return null;
  const start = r.pos;
  if (spec.raw) {
    if (spec.as === 'i64') {
      const v = r.i64();
      return v.toString();
    }
    return r.bytes(spec.raw).toString('hex');
  }
  // try double first if size matches fields.length*8, else float, else int32
  const n = spec.fields.length;
  let elemSize = size / n;
  const out = {};
  for (const f of spec.fields) {
    if (spec.type === 'i32') out[f] = r.i32();
    else if (spec.type === 'u8') out[f] = r.u8();
    else if (elemSize === 8) out[f] = r.f64();
    else out[f] = r.f32();
  }
  // safety: if we didn't consume exactly `size` bytes, resync
  const consumed = r.pos - start;
  if (size != null && consumed !== size) {
    r.seek(start + size);
  }
  return out;
}

function readValueByType(r, type, sizeHint, ctx) {
  switch (type) {
    case 'IntProperty': return r.i32();
    case 'Int8Property': return r.u8() << 24 >> 24;
    case 'Int16Property': return r.buf.readInt16LE((r.pos += 2, r.pos - 2));
    case 'Int64Property': return r.i64().toString();
    case 'UInt32Property': return r.u32();
    case 'UInt16Property': return r.u16();
    case 'UInt64Property': return r.u64().toString();
    case 'FloatProperty': return r.f32();
    case 'DoubleProperty': return r.f64();
    case 'BoolProperty': return null; // value lives in the tag itself
    case 'StrProperty': return r.fstring();
    case 'NameProperty': return r.fstring();
    case 'TextProperty': return readTextProperty(r);
    case 'ObjectProperty': return r.fstring();
    case 'SoftObjectProperty': { const path = r.fstring(); const sub = r.fstring(); return sub ? `${path}:${sub}` : path; }
    case 'EnumProperty': case 'ByteProperty': {
      const enumName = ctx && ctx.enumName;
      if (!enumName || enumName === 'None') {
        return r.u8();
      }
      return r.fstring();
    }
    default:
      throw new Error(`UNHANDLED_SCALAR:${type}`);
  }
}

function readTextProperty(r) {
  // FText serialization (simplified, common case: culture-invariant literal string)
  const start = r.pos;
  try {
    const flags = r.u32();
    const historyType = r.u8();
    if (historyType === 255 || historyType === -1) {
      return { flags, empty: true };
    }
    if (historyType === 0) {
      // Base: namespace, key, sourceString
      const ns = r.fstring();
      const key = r.fstring();
      const src = r.fstring();
      return { flags, namespace: ns, key, source: src };
    }
    // Unknown history type: bail, caller should catch via size-based resync upstream
    throw new Error(`TEXT_HISTORY_${historyType}`);
  } catch (e) {
    r.seek(start);
    throw e;
  }
}

function readTag(r) {
  const name = r.fstring();
  if (name === 'None' || name === '') return null;
  const type = r.fstring();
  const size = r.i32();
  const arrayIndex = r.i32();
  const tag = { name, type, size, arrayIndex };
  if (type === 'StructProperty') {
    tag.structName = r.fstring();
    tag.structGuid = r.guid();
  } else if (type === 'BoolProperty') {
    tag.boolValue = r.u8() !== 0;
  } else if (type === 'ByteProperty' || type === 'EnumProperty') {
    tag.enumName = r.fstring();
  } else if (type === 'ArrayProperty' || type === 'SetProperty') {
    tag.innerType = r.fstring();
  } else if (type === 'MapProperty') {
    tag.keyType = r.fstring();
    tag.valueType = r.fstring();
  }
  const terminator = r.u8(); // usually 0, "has property guid" flag
  if (terminator === 1) {
    tag.propGuid = r.guid();
  }
  return tag;
}

function readPropertyList(r, depth, warnings, path) {
  const props = [];
  let guardCount = 0;
  while (true) {
    guardCount++;
    if (guardCount > 500000) { warnings.push(`ABORT_LOOP at ${path}`); break; }
    const tagStart = r.pos;
    let tag;
    try {
      tag = readTag(r);
    } catch (e) {
      warnings.push(`TAG_READ_FAIL at ${path} pos=${tagStart}: ${e.message}`);
      break;
    }
    if (tag === null) break; // "None" terminator
    const valueStart = r.pos;
    let value;
    try {
      value = readPropertyValue(r, tag, depth + 1, warnings, `${path}.${tag.name}`);
    } catch (e) {
      warnings.push(`VALUE_READ_FAIL type=${tag.type} at ${path}.${tag.name} pos=${valueStart} size=${tag.size}: ${e.message}`);
      value = { __error: e.message, __rawHex: r.buf.subarray(valueStart, valueStart + Math.min(tag.size, 256)).toString('hex') };
    }
    // resync using declared size, in case our decode drifted
    const expectedEnd = valueStart + tag.size;
    if (r.pos !== expectedEnd) {
      if (r.pos > expectedEnd) warnings.push(`OVERRUN at ${path}.${tag.name}: read ${r.pos - valueStart} expected ${tag.size}`);
      r.seek(expectedEnd);
    }
    props.push({ name: tag.name, type: tag.type, value, tag: { structName: tag.structName, innerType: tag.innerType, keyType: tag.keyType, valueType: tag.valueType, enumName: tag.enumName } });
    if (depth > 60) { warnings.push(`DEPTH_LIMIT at ${path}`); break; }
  }
  return props;
}

function readPropertyValue(r, tag, depth, warnings, path) {
  const { type, size } = tag;
  if (type === 'BoolProperty') return tag.boolValue;
  if (type === 'StructProperty') {
    return readStruct(r, tag.structName, size, depth, warnings, path);
  }
  if (type === 'ArrayProperty') {
    return readArray(r, tag, depth, warnings, path);
  }
  if (type === 'SetProperty') {
    return readSet(r, tag, depth, warnings, path);
  }
  if (type === 'MapProperty') {
    return readMap(r, tag, depth, warnings, path);
  }
  return readValueByType(r, type, size, { enumName: tag.enumName });
}

function readStruct(r, structName, size, depth, warnings, path) {
  const start = r.pos;
  if (FIXED_STRUCTS[structName]) {
    const v = readFixedStruct(r, structName, size);
    if (v !== null) return v;
  }
  // Try generic tagged-property-list struct; validate we land within [start, start+size]
  try {
    const props = readPropertyList(r, depth, warnings, path);
    if (r.pos > start + size) throw new Error('struct overran declared size');
    return propsToObject(props);
  } catch (e) {
    r.seek(start + size);
    return { __rawStruct: structName, __rawHex: r.buf.subarray(start, start + Math.min(size, 256)).toString('hex') };
  }
}

function propsToObject(props) {
  const obj = {};
  for (const p of props) {
    if (obj[p.name] !== undefined) {
      if (!Array.isArray(obj[p.name])) obj[p.name] = [obj[p.name]];
      obj[p.name].push(p.value);
    } else {
      obj[p.name] = p.value;
    }
  }
  return obj;
}

function readArray(r, tag, depth, warnings, path) {
  const start = r.pos;
  const end = start + tag.size;
  const count = r.i32();
  const inner = tag.innerType;
  const out = [];
  if (inner === 'StructProperty') {
    // Quirk: redundant inner tag describing the element struct type
    const innerTag = readTag(r); // name repeats array name
    const structName = innerTag ? innerTag.structName : 'Unknown';
    for (let i = 0; i < count; i++) {
      out.push(readStruct(r, structName, end - r.pos, depth + 1, warnings, `${path}[${i}]`));
      if (r.pos >= end) break;
    }
  } else if (inner === 'ByteProperty' || inner === 'EnumProperty') {
    for (let i = 0; i < count; i++) out.push(r.u8());
  } else {
    for (let i = 0; i < count; i++) {
      out.push(readValueByType(r, inner, undefined, {}));
    }
  }
  if (r.pos !== end) r.seek(end);
  return out;
}

function readSet(r, tag, depth, warnings, path) {
  const start = r.pos;
  const end = start + tag.size;
  const unknown = r.i32(); // allocation flags, usually 0
  const count = r.i32();
  const inner = tag.innerType;
  const out = [];
  for (let i = 0; i < count; i++) {
    if (inner === 'StructProperty') {
      out.push(readStruct(r, 'Unknown', end - r.pos, depth + 1, warnings, `${path}{${i}}`));
    } else {
      out.push(readValueByType(r, inner, undefined, {}));
    }
  }
  if (r.pos !== end) r.seek(end);
  return out;
}

function readMap(r, tag, depth, warnings, path) {
  const start = r.pos;
  const end = start + tag.size;
  const unknown = r.i32();
  const count = r.i32();
  const { keyType, valueType } = tag;
  const entries = [];
  for (let i = 0; i < count; i++) {
    let key, val;
    if (keyType === 'StructProperty') key = readStruct(r, 'Unknown', end - r.pos, depth + 1, warnings, `${path}<k${i}>`);
    else key = readValueByType(r, keyType, undefined, {});
    if (valueType === 'StructProperty') val = readStruct(r, 'Unknown', end - r.pos, depth + 1, warnings, `${path}<v${i}>`);
    else if (valueType === 'ArrayProperty' || valueType === 'MapProperty' || valueType === 'SetProperty' || valueType === 'BoolProperty') {
      // rare: nested container as map value without its own tag; best effort raw skip
      val = { __unsupportedMapValueType: valueType };
    } else val = readValueByType(r, valueType, undefined, {});
    entries.push([key, val]);
    if (r.pos >= end) break;
  }
  if (r.pos !== end) r.seek(end);
  return entries;
}

export function parseGvas(buf) {
  const r = new Reader(buf);
  const magic = r.bytes(4).toString('latin1');
  if (magic !== 'GVAS') throw new Error(`Not a GVAS file (magic=${magic})`);
  const saveGameFileVersion = r.i32();
  let packageFileUE4Version, packageFileUE5Version = null;
  if (saveGameFileVersion >= 3) {
    packageFileUE4Version = r.i32();
    packageFileUE5Version = r.i32();
  } else {
    packageFileUE4Version = r.i32();
  }
  const engineVersion = {
    major: r.u16(), minor: r.u16(), patch: r.u16(),
    changelist: r.u32(), branch: r.fstring(),
  };
  const customVersionFormat = r.i32();
  const customVersionCount = r.i32();
  const customVersions = [];
  for (let i = 0; i < customVersionCount; i++) {
    customVersions.push({ guid: r.guid(), version: r.i32() });
  }
  const saveGameClassName = r.fstring();

  const warnings = [];
  const properties = readPropertyList(r, 0, warnings, '$');

  return {
    header: { magic, saveGameFileVersion, packageFileUE4Version, packageFileUE5Version, engineVersion, customVersionFormat, customVersionCount, saveGameClassName },
    properties: propsToObject(properties),
    rawProperties: properties,
    warnings,
    bytesConsumed: r.pos,
    totalBytes: buf.length,
  };
}
