import { XMLParser } from 'fast-xml-parser'

export type ParseResult =
  | { ok: true; data: fhir3.Bundle; format: 'json' | 'xml' }
  | { ok: false; error: string; format: 'json' | 'xml' | 'unknown' }

function detectFormat(text: string): 'json' | 'xml' | 'unknown' {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (trimmed.startsWith('<')) return 'xml'
  return 'unknown'
}

function parseXmlBundle(text: string): fhir3.Bundle {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    textNodeName: 'value',
    parseAttributeValue: false,
    parseTagValue: false,
    isArray: (name) =>
      ['entry', 'extension', 'coding', 'identifier', 'name', 'address',
       'telecom', 'dosage', 'note', 'reasonCode', 'performer',
       'basedOn', 'partOf', 'category', 'statusReason'].includes(name),
  })
  const raw = parser.parse(text)
  const bundle = raw['Bundle']
  if (!bundle) throw new Error('Root element is not a <Bundle>')
  return xmlBundleToFhir(bundle)
}

// Convert fast-xml-parser output to FHIR JSON structure
// This handles the FHIR XML serialisation format where values are attributes
function xmlNodeToFhir(node: Record<string, unknown>): unknown {
  if (node === null || typeof node !== 'object') return node

  // FHIR XML primitive: <status value="active"/> → { _value: "active" }
  if ('_value' in node && Object.keys(node).filter(k => !k.startsWith('_') && k !== 'value').length === 0) {
    return (node as Record<string, unknown>)['_value']
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('_') && key !== '_value') continue  // skip XML attributes except value
    if (key === '_value') {
      result['value'] = val
      continue
    }
    if (Array.isArray(val)) {
      result[key] = val.map(item =>
        typeof item === 'object' && item !== null ? xmlNodeToFhir(item as Record<string, unknown>) : item
      )
    } else if (typeof val === 'object' && val !== null) {
      result[key] = xmlNodeToFhir(val as Record<string, unknown>)
    } else {
      result[key] = val
    }
  }
  return result
}

function xmlBundleToFhir(raw: Record<string, unknown>): fhir3.Bundle {
  // Extract resourceType from XML tag name (already 'Bundle')
  const bundle: Record<string, unknown> = { resourceType: 'Bundle' }

  const typeNode = raw['type'] as Record<string, unknown> | undefined
  if (typeNode) bundle['type'] = typeNode['_value'] ?? typeNode['value'] ?? typeNode

  const idNode = raw['id'] as Record<string, unknown> | undefined
  if (idNode) bundle['id'] = idNode['_value'] ?? idNode['value'] ?? idNode

  const metaNode = raw['meta'] as Record<string, unknown> | undefined
  if (metaNode) bundle['meta'] = xmlNodeToFhir(metaNode)

  const rawEntries = raw['entry']
  if (!Array.isArray(rawEntries)) return bundle as unknown as fhir3.Bundle

  bundle['entry'] = rawEntries.map((entry: Record<string, unknown>) => {
    const fhirEntry: Record<string, unknown> = {}

    const fullUrl = entry['fullUrl'] as Record<string, unknown> | undefined
    if (fullUrl) fhirEntry['fullUrl'] = fullUrl['_value'] ?? fullUrl['value'] ?? fullUrl

    const resource = entry['resource'] as Record<string, unknown> | undefined
    if (resource) {
      // The actual resource type is the key inside <resource>
      const resourceTypeKey = Object.keys(resource).find(k => !k.startsWith('_') && k !== 'value')
      if (resourceTypeKey) {
        const resourceNode = resource[resourceTypeKey] as Record<string, unknown>
        fhirEntry['resource'] = {
          resourceType: resourceTypeKey,
          ...xmlNodeToFhir({ ...resourceNode }) as object,
        }
      }
    }

    const search = entry['search'] as Record<string, unknown> | undefined
    if (search) fhirEntry['search'] = xmlNodeToFhir(search)

    return fhirEntry
  })

  return bundle as unknown as fhir3.Bundle
}

export function normalizePastedJson(text: string):
  | { ok: true; data: fhir3.Bundle }
  | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` }
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, error: 'Pasted content is not recognisable FHIR JSON' }
  }

  if (Array.isArray(parsed)) {
    return {
      ok: true,
      data: { resourceType: 'Bundle', type: 'searchset', entry: parsed.map(r => ({ resource: r })) } as fhir3.Bundle,
    }
  }

  const obj = parsed as Record<string, unknown>

  if (obj['resourceType'] === 'Bundle') {
    return { ok: true, data: obj as unknown as fhir3.Bundle }
  }

  if (Array.isArray(obj['entry']) && !obj['resourceType']) {
    return { ok: true, data: { ...obj, resourceType: 'Bundle' } as unknown as fhir3.Bundle }
  }

  if (typeof obj === 'object') {
    return {
      ok: true,
      data: { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: obj }] } as fhir3.Bundle,
    }
  }

  return { ok: false, error: 'Pasted content is not recognisable FHIR JSON' }
}

export function parseBundle(text: string): ParseResult {
  const format = detectFormat(text)

  if (format === 'unknown') {
    return { ok: false, error: 'File does not appear to be JSON or XML', format: 'unknown' }
  }

  if (format === 'json') {
    try {
      const data = JSON.parse(text) as fhir3.Bundle
      return { ok: true, data, format: 'json' }
    } catch (e) {
      return { ok: false, error: `JSON parse error: ${(e as Error).message}`, format: 'json' }
    }
  }

  // XML
  try {
    const data = parseXmlBundle(text)
    return { ok: true, data, format: 'xml' }
  } catch (e) {
    return { ok: false, error: `XML parse error: ${(e as Error).message}`, format: 'xml' }
  }
}
