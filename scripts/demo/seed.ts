/**
 * The demo workspace's starting data (data/seed-demo/): what demo mode opens with the first time,
 * so a demo starts at uploading the draft. PortSwigger's approved clauses and playbook (the same
 * as each demo folder's library.json and playbook.json), and an account and contract for each
 * demo. Written by npm run demo:build (and npm run demo:seed on its own).
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, ContractRecord } from '../../src/shared/types'
import { LIBRARY } from './library'
import { PLAYBOOK } from './playbook'

const AT = '2026-10-01T09:00:00.000Z'

type Kind = ContractRecord['contractType']
/**
 * A round of a contract's history, reviewed in the past: the draft (with the original we sent, or
 * on their paper), how long ago, how much of it was decided, and whether the review was closed.
 */
export interface HistoryRound {
  file: string
  original?: string
  theirs?: boolean
  daysAgo: number
  decide: 'all' | 'half' | 'none'
  closed?: boolean
}
interface SeedContract {
  key: string
  title: string
  type: Kind
  /** Kept, but out of the sidebar. */
  archived?: boolean
  history?: HistoryRound[]
}

/** Our order form, redlined by the client (round 1, compared with what we sent). */
const order = (k: string, product: string, daysAgo: number, decide: HistoryRound['decide'], closed = false): HistoryRound[] => [
  { file: `${k}-${product}-Order-Form-v1-redline.docx`, original: `${k}-${product}-Order-Form-v0-we-sent.docx`, daysAgo, decide, closed }
]
const nda = (k: string, days: number[], last: HistoryRound['decide'] = 'all', closed = true): HistoryRound[] => [
  { file: `${k}-Mutual-NDA-v1-redline.docx`, original: `${k}-Mutual-NDA-v0-we-sent.docx`, daysAgo: days[0], decide: days.length > 1 ? 'all' : last, closed: days.length > 1 ? false : closed },
  ...(days.length > 1 ? [{ file: `${k}-Mutual-NDA-v2-response.docx`, daysAgo: days[1], decide: last, closed }] : [])
]

/**
 * Each client and their contracts. The first contract of the first three is a demo's (its quick
 * start opens it, so it has no history); the rest have history: reviews finished and closed,
 * reviews in progress, earlier rounds, a contract archived, and contracts not started.
 */
const DEMOS: { account: string; key: string; contracts: SeedContract[] }[] = [
  {
    key: 'brightwater',
    account: 'Brightwater Robotics',
    contracts: [
      { key: 'brightwater', title: 'Mutual NDA', type: 'nda' },
      { key: 'brightwater-order', title: 'Burp Suite Enterprise order form', type: 'order-form', history: order('Brightwater', 'Burp-Suite-Enterprise', 3, 'half') }
    ]
  },
  {
    key: 'kestrel',
    account: 'Kestrel Health Systems',
    contracts: [
      { key: 'kestrel', title: 'Confidentiality Agreement', type: 'nda' },
      // Their paper, half read.
      { key: 'kestrel-data', title: 'Data Sharing Agreement', type: 'nda', history: [{ file: 'Kestrel-Data-Sharing-Agreement.docx', theirs: true, daysAgo: 4, decide: 'half' }] }
    ]
  },
  {
    key: 'harbourline',
    account: 'Harbourline Hosting',
    contracts: [
      { key: 'harbourline', title: 'Master Services Agreement', type: 'general' },
      // Our NDA, agreed after two rounds last spring.
      { key: 'harbourline-nda', title: 'Mutual NDA', type: 'nda', history: nda('Harbourline', [210, 196]) }
    ]
  },
  {
    key: 'northwind',
    account: 'Northwind Logistics',
    contracts: [
      // Their supplier agreement, decided and signed off.
      { key: 'northwind', title: 'Logistics Services Agreement', type: 'general', history: [{ file: 'Northwind-Logistics-Services-Agreement.docx', theirs: true, daysAgo: 62, decide: 'all', closed: true }] },
      // Their paper, arrived on Saturday, half read.
      { key: 'northwind-2', title: 'Partner Confidentiality Agreement', type: 'nda', history: [{ file: 'Northwind-Partner-Confidentiality-Agreement.docx', theirs: true, daysAgo: 2, decide: 'half' }] },
      { key: 'northwind-3', title: 'Burp Suite DAST order form', type: 'order-form', history: order('Northwind', 'Burp-Suite-DAST', 1, 'none') }
    ]
  },
  {
    key: 'acme',
    account: 'Acme Analytics',
    contracts: [
      // Round 1 decided; their second draft arrived yesterday, not started.
      { key: 'acme', title: 'Mutual NDA', type: 'nda', history: nda('Acme', [12, 1], 'none', false) },
      // Their platform agreement, half decided.
      { key: 'acme-2', title: 'Analytics Platform Agreement', type: 'general', history: [{ file: 'Acme-Analytics-Platform-Agreement.docx', theirs: true, daysAgo: 8, decide: 'half' }] }
    ]
  },
  {
    key: 'globex',
    account: 'Globex Retail',
    contracts: [
      // Their payment services agreement, arrived this morning.
      { key: 'globex', title: 'Payment Services Agreement', type: 'general', history: [{ file: 'Globex-Payment-Services-Agreement.docx', theirs: true, daysAgo: 0, decide: 'none' }] },
      { key: 'globex-2', title: 'Mutual NDA', type: 'nda', history: nda('Globex', [34]) },
      { key: 'globex-3', title: 'Supplier NDA (2024)', type: 'nda', archived: true, history: nda('Globex', [420]) }
    ]
  },
  {
    key: 'corvid',
    account: 'Corvid Freight',
    contracts: [{ key: 'corvid', title: 'Mutual NDA', type: 'nda' }]
  },
  {
    key: 'initech',
    account: 'Initech Software',
    contracts: [
      // Their reseller agreement, on their paper, half read.
      { key: 'initech', title: 'Reseller Agreement', type: 'nda', history: [{ file: 'Initech-Reseller-Agreement.docx', theirs: true, daysAgo: 6, decide: 'half' }] },
      { key: 'initech-2', title: 'Mutual NDA', type: 'nda', history: nda('Initech', [95], 'all', true) },
      { key: 'initech-3', title: 'Burp Suite Professional order form', type: 'order-form', history: order('Initech', 'Burp-Suite-Professional', 42, 'all', true) }
    ]
  }
]

/** The demo contracts, copied with the app (the demo folders aren't packaged), for the quick starts. */
const FILES = [
  '1-our-nda-two-rounds/Brightwater-Mutual-NDA-v0-original-we-sent.docx',
  '1-our-nda-two-rounds/Brightwater-Mutual-NDA-v1-client-redline.docx',
  '1-our-nda-two-rounds/Brightwater-Mutual-NDA-v2-client-response.docx',
  '2-client-paper/Kestrel-Confidentiality-Agreement-client-paper.docx',
  '3-supplier-msa/Harbourline-Master-Services-Agreement.docx',
  '4-prompt-injection/Corvid-Mutual-NDA-v0-we-sent.docx',
  '4-prompt-injection/Corvid-Mutual-NDA-v1-client-redline.docx'
]

export function writeDemoSeed(root = process.cwd()) {
  const dir = join(root, 'data', 'seed-demo')
  mkdirSync(dir, { recursive: true })
  const accounts: Account[] = DEMOS.map((x) => ({ id: `ac-demo-${x.key}`, name: x.account, createdAt: AT }))
  const contracts: ContractRecord[] = DEMOS.flatMap((x) =>
    x.contracts.map((c) => ({
      id: `ct-demo-${c.key}`,
      accountId: `ac-demo-${x.key}`,
      title: c.title,
      contractType: c.type,
      createdAt: AT,
      ...(c.archived ? { archived: { by: 'Priya Shah', at: AT } } : {})
    }))
  )
  // The history the app makes the first time the demo workspace opens: each contract's past rounds.
  const history = DEMOS.flatMap((x) => x.contracts.filter((c) => c.history?.length).map((c) => ({ contractId: `ct-demo-${c.key}`, rounds: c.history! })))
  const write = (file: string, data: unknown) => writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + '\n')
  write('library.json', LIBRARY)
  write('playbook.json', PLAYBOOK)
  write('accounts.json', accounts)
  write('contracts.json', contracts)
  // Earlier negotiations with other clients (curated from real runs: see git history); kept if there.
  if (!existsSync(join(dir, 'precedents.json'))) write('precedents.json', [])
  write('history.json', history)
  const files = join(root, 'data', 'demo-files')
  mkdirSync(files, { recursive: true })
  for (const f of FILES) copyFileSync(join(root, 'demo', f), join(files, f.split('/').pop()!))
  console.log(`data/seed-demo: ${LIBRARY.length} clauses, ${PLAYBOOK.length} positions, ${accounts.length} accounts, ${contracts.length} contracts, history for ${history.length}; data/demo-files: ${FILES.length} demo contracts`)
}

// Run on its own (npm run demo:seed).
if (process.argv[1]?.endsWith('seed.ts')) writeDemoSeed()
