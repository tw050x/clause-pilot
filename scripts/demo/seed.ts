/**
 * The demo workspace's starting data (data/seed-demo/): what demo mode opens with the first time,
 * so a demo starts at uploading the draft. PortSwigger's approved clauses and playbook (the same
 * as each demo folder's library.json and playbook.json), and an account and contract for each
 * demo. Written by npm run demo:build (and npm run demo:seed on its own).
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
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
      { key: 'brightwater-order', title: 'Burp Suite Enterprise order form', type: 'order-form' }
    ]
  },
  {
    key: 'kestrel',
    account: 'Kestrel Health Systems',
    contracts: [
      { key: 'kestrel', title: 'Confidentiality Agreement', type: 'nda' },
      { key: 'kestrel-data', title: 'Data Sharing Agreement', type: 'nda', history: [{ file: 'Kestrel-Data-Sharing-Agreement.docx', theirs: true, daysAgo: 4, decide: 'half' }] }
    ]
  },
  {
    key: 'harbourline',
    account: 'Harbourline Hosting',
    contracts: [
      { key: 'harbourline', title: 'Master Services Agreement', type: 'general' },
      { key: 'harbourline-nda', title: 'Mutual NDA', type: 'nda', history: nda('Harbourline', [210, 196]) }
    ]
  },
  {
    key: 'northwind',
    account: 'Northwind Logistics',
    contracts: [
      { key: 'northwind', title: 'Mutual NDA', type: 'nda', history: nda('Northwind', [62, 47]) },
      { key: 'northwind-2', title: 'Partner Confidentiality Agreement', type: 'nda', history: [{ file: 'Northwind-Partner-Confidentiality-Agreement.docx', theirs: true, daysAgo: 2, decide: 'half' }] },
      { key: 'northwind-3', title: 'Burp Suite DAST order form', type: 'order-form' }
    ]
  },
  {
    key: 'acme',
    account: 'Acme Analytics',
    contracts: [
      { key: 'acme', title: 'Mutual NDA', type: 'nda', history: nda('Acme', [12, 1], 'none', false) },
      { key: 'acme-2', title: 'Order form 2026', type: 'order-form' }
    ]
  },
  {
    key: 'globex',
    account: 'Globex Retail',
    contracts: [
      { key: 'globex', title: 'Mutual NDA', type: 'nda', history: nda('Globex', [34]) },
      { key: 'globex-2', title: 'Penetration testing services', type: 'general' },
      { key: 'globex-3', title: 'Supplier NDA (2024)', type: 'nda', archived: true, history: nda('Globex', [420]) }
    ]
  },
  {
    key: 'initech',
    account: 'Initech Software',
    contracts: [
      { key: 'initech', title: 'Reseller Agreement', type: 'nda', history: [{ file: 'Initech-Reseller-Agreement.docx', theirs: true, daysAgo: 6, decide: 'half' }] },
      { key: 'initech-2', title: 'Mutual NDA', type: 'nda', history: nda('Initech', [95], 'all', true) }
    ]
  }
]

/** The demo contracts, copied with the app (the demo folders aren't packaged), for the quick starts. */
const FILES = [
  '1-our-nda-two-rounds/Brightwater-Mutual-NDA-v0-original-we-sent.docx',
  '1-our-nda-two-rounds/Brightwater-Mutual-NDA-v1-client-redline.docx',
  '1-our-nda-two-rounds/Brightwater-Mutual-NDA-v2-client-response.docx',
  '2-client-paper/Kestrel-Confidentiality-Agreement-client-paper.docx',
  '3-supplier-msa/Harbourline-Master-Services-Agreement.docx'
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
  write('precedents.json', [])
  write('history.json', history)
  const files = join(root, 'data', 'demo-files')
  mkdirSync(files, { recursive: true })
  for (const f of FILES) copyFileSync(join(root, 'demo', f), join(files, f.split('/').pop()!))
  console.log(`data/seed-demo: ${LIBRARY.length} clauses, ${PLAYBOOK.length} positions, ${accounts.length} accounts, ${contracts.length} contracts, history for ${history.length}; data/demo-files: ${FILES.length} demo contracts`)
}

// Run on its own (npm run demo:seed).
if (process.argv[1]?.endsWith('seed.ts')) writeDemoSeed()
