import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sanitiseGpHtml } from '../src/sanitise'

const real = JSON.parse(
  readFileSync(new URL('../../../packages/fixtures/gpconnect-examples/html/demonstrator-0.7.2-ALL.response.json', import.meta.url), 'utf8'),
)
const realHtml: string = real.entry[0].resource.section[0].text.div

describe('sanitiseGpHtml', () => {
  it('keeps everything that matters in real GP Connect HTML', () => {
    const out = sanitiseGpHtml(realHtml)
    for (const kept of [
      '<h1>Allergies and Adverse Reactions</h1>',
      '<table id="all-tab-curr">',
      '<table id="all-tab-hist">',
      '<td class="date-column">15-Mar-2016</td>',
      'Allergy to Penicillin, Patient experienced rash, nausea and vomiting',
      'Hayfever, allergy to pollen',
    ]) {
      expect(out).toContain(kept)
    }
    // Only the xmlns attribute is dropped; the text content is identical.
    const text = (h: string) => h.replace(/<[^>]+>/g, '')
    expect(text(out)).toBe(text(realHtml))
  })

  it.each([
    ['script', '<div><script>alert(1)</script>ok</div>', '<div>ok</div>'],
    ['event handler', '<td onclick="alert(1)">x</td>', '<td>x</td>'],
    ['link', '<p><a href="javascript:alert(1)">x</a></p>', '<p>x</p>'],
    ['image beacon', '<div><img src="https://evil.example/p.gif">x</div>', '<div>x</div>'],
    ['inline style', '<p style="background:url(https://evil.example)">x</p>', '<p>x</p>'],
    ['iframe', '<div><iframe src="https://evil.example"></iframe></div>', '<div></div>'],
  ])('removes %s', (_, input, expected) => {
    expect(sanitiseGpHtml(input)).toBe(expected)
  })
})
