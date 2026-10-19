/**
 * Ligatures a PDF draws as one glyph with no letters recorded for it. Word's Calibri, for one,
 * joins "ti", "tt" and "ft", and a PDF exported from Word may give pdf.js nothing for them: the
 * text reads "termina on", "wri en", "a er". Glyphs drawn alike (same font, same width) are the
 * same ligature, so each group is resolved together: the letters that turn the words it appears in
 * into known words most often. A group no candidate fits is left as "�", never guessed.
 */

/** The ligatures to try, most common first (a tie goes to the earlier one). */
const CANDIDATES = ['ti', 'tt', 'ft', 'fi', 'fl', 'ff', 'ffi', 'ffl', 'tf', 'fj']

/** Words these ligatures appear in, common in contracts and letters (their -s, -ed, -ing, -ly forms count too). */
const WORDS = new Set(
  `
time timely sometimes overtime timetable timesheet timescale entitle entitled entitlement title titles notice notices practice practices
information termination terminations relating relation relations induction additional restriction restrictions restrictive discretion
discretionary confidential confidentiality certificate certification protection obligation obligations section sections constitute
constitutes constituted particular particulars continuous continue continued continues continuing duties duty warranties potential
probationary action actions position positions condition conditions conditional option options optional parties partial essential
initial investigation negotiation negotiations application applications legislation compensation authorisation authorization
notification notifications resolution solicitation competition competitive jurisdiction definition definitions provision provisions
exception exceptions attention sanction sanctions limitation limitations representation representations consultation question
questions continuation satisfaction activities activity facilities authorities liabilities securities entities entity identity
quantity opportunity opportunities situation station stationery practitioner certain certainly statutory pertinent multiple anti
artificial beneficial official officially sufficiently essentially potentially substantial substantially confidentially
intellectual institution instruction instructions destination description descriptions subscription prescription transition
mention mentioned operation operations organisation organization registration administration calculation calculations
location locations education qualification qualifications publication publications communication communications
deduction deductions reduction production introduction function functions direction directions election elections
correction protection detection collection selection connection connections consideration considerations declaration
duration expiration expiry ratification rectification modification modifications specification specifications
justification classification verification identification promotion promotions motion emotion relocation allocation
accommodation recommendation recommendations obligated stipulation stipulations retention attendance attendant notional
national international regional additional traditional exceptional professional occupational vocational
written attend attended attending attendance attention matter matters letter letters settlement settlements settle settled committee
committed commitment commitments permitted admitted submitted omitted transmitted bottom pattern patterns better button attach attached
attachment attachments attempt attempts attorney setting settings getting putting fitted little battery cutting attribute attributable
attest attestation fitting sitting quitting splitting regrettably
after afterwards thereafter hereafter shift shifts left gift gifts draft drafts drafted software soft craft lift theft swift aircraft
often soften
first final finally fine fines file files filed filing fit fixed fixture financial finance field fields figure figures find finding
findings profit profits benefit benefits specific specifically specified specify satisfied satisfy sufficient justified modified
modify notified notify confirm confirmed confirmation definite infinite beneficiary fiscal fiduciary fifteen fifty firm firms fire
fiction profile classified certified
flexible flexibility floor flight flights conflict conflicts influence reflect reflects flow fluid
effect effects effective effectively affect affected staff offer offered offers different difference effort efforts tariff suffer
suffered affair affairs afford traffic
office offices officer officers efficient efficiently affiliate affiliates affiliated difficult difficulty
`
    .split(/\s+/)
    .filter(Boolean)
)

const known = (w: string) => {
  const x = w.toLowerCase()
  return WORDS.has(x) || [/s$/, /es$/, /ed$/, /d$/, /ing$/, /ly$/, /'s$/].some((end) => end.test(x) && WORDS.has(x.replace(end, '')))
}

const BASE = 0xe000

export class Ligatures {
  private groups = new Map<string, number>()

  /** A marker for an unmapped glyph, the same for every glyph drawn alike (font and width). */
  mark(font: string, width: number): string {
    const key = `${font}:${width.toFixed(3)}`
    if (!this.groups.has(key)) this.groups.set(key, this.groups.size)
    return String.fromCharCode(BASE + this.groups.get(key)!)
  }

  /** The lines with each marker replaced by its group's letters (or "�" if none fits). */
  repair(lines: string[]): string[] {
    if (!this.groups.size) return lines
    const votes = new Map<number, Map<string, number>>()
    for (const line of lines)
      for (const word of line.match(/[\p{L}-]*[-][\p{L}-]*/gu) ?? []) {
        const marks = [...word].filter((c) => c.charCodeAt(0) >= BASE && c.charCodeAt(0) < 0xf900)
        if (marks.length !== 1) continue // two in one word: resolved from words with one
        const group = marks[0].charCodeAt(0) - BASE
        const tally = votes.get(group) ?? new Map<string, number>()
        for (const c of CANDIDATES) if (known(word.replace(marks[0], c))) tally.set(c, (tally.get(c) ?? 0) + 1)
        votes.set(group, tally)
      }
    const letters = new Map<number, string>()
    for (const [group, tally] of votes) {
      const best = [...tally].sort((a, b) => b[1] - a[1] || CANDIDATES.indexOf(a[0]) - CANDIDATES.indexOf(b[0]))[0]
      if (best) letters.set(group, best[0])
    }
    return lines.map((line) => line.replace(/[-]/g, (c) => letters.get(c.charCodeAt(0) - BASE) ?? '�'))
  }
}
