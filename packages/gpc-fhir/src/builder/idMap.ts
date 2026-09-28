import type { DraftRecord } from './types'

export class TempIdMap {
  private map = new Map<string, string>()

  constructor(draft: DraftRecord) {
    this.set(draft.patient._tempId)
    this.set(draft.organisation._tempId)
    for (const p of draft.practitioners) this.set(p._tempId)
    for (const l of draft.locations) this.set(l._tempId)
    for (const m of draft.medications) {
      this.set(m._tempId)
      for (const i of m.issues ?? []) this.set(i._tempId)
    }
    for (const a of draft.allergies) this.set(a._tempId)
    for (const p of draft.problems) this.set(p._tempId)
    for (const c of draft.consultations) {
      this.set(c._tempId)
      for (const t of c.topics) {
        this.set(t._tempId)
        for (const cat of t.categories) {
          this.set(cat._tempId)
          for (const item of cat.items) this.set(item._tempId)
        }
        for (const item of t.items) this.set(item._tempId)
      }
    }
    for (const i of draft.immunisations) this.set(i._tempId)
    for (const inv of draft.investigations) {
      this.set(inv._tempId)
      for (const g of inv.testGroups) {
        this.set(g._tempId)
        for (const r of g.results) this.set(r._tempId)
      }
    }
    for (const r of draft.referrals) this.set(r._tempId)
    for (const d of draft.diaryEntries) this.set(d._tempId)
    for (const cd of draft.codedData) this.set(cd._tempId)
    for (const doc of draft.documents) this.set(doc._tempId)
  }

  private set(tempId: string): void {
    if (!this.map.has(tempId)) {
      this.map.set(tempId, crypto.randomUUID())
    }
  }

  resolve(tempId: string): string {
    if (!this.map.has(tempId)) {
      this.map.set(tempId, crypto.randomUUID())
    }
    return this.map.get(tempId)!
  }

  ref(tempId: string, resourceType: string): string {
    return `${resourceType}/${this.resolve(tempId)}`
  }

  entry(tempId: string): { id: string; fullUrl: string } {
    const id = this.resolve(tempId)
    return { id, fullUrl: `urn:uuid:${id}` }
  }
}
