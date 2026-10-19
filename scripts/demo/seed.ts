/**
 * The demo workspace's starting data (data/seed-demo/): what demo mode opens with the first time,
 * so a demo starts at uploading the draft. PortSwigger's approved clauses and playbook (the same
 * as each demo folder's library.json and playbook.json), and an account and contract for each
 * demo. Written by npm run demo:build (and npm run demo:seed on its own).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, ContractRecord } from '../../src/shared/types'
import { LIBRARY } from './library'
import { PLAYBOOK } from './playbook'

const AT = '2026-10-01T09:00:00.000Z'

/** One per demo, as its guide names them. */
const DEMOS: { account: string; contract: string; type: ContractRecord['contractType']; key: string }[] = [
  { key: 'brightwater', account: 'Brightwater Robotics', contract: 'Mutual NDA', type: 'nda' },
  { key: 'kestrel', account: 'Kestrel Health Systems', contract: 'Confidentiality Agreement', type: 'nda' },
  { key: 'harbourline', account: 'Harbourline Hosting', contract: 'Master Services Agreement', type: 'general' }
]

export function writeDemoSeed(root = process.cwd()) {
  const dir = join(root, 'data', 'seed-demo')
  mkdirSync(dir, { recursive: true })
  const accounts: Account[] = DEMOS.map((x) => ({ id: `ac-demo-${x.key}`, name: x.account, createdAt: AT }))
  const contracts: ContractRecord[] = DEMOS.map((x) => ({ id: `ct-demo-${x.key}`, accountId: `ac-demo-${x.key}`, title: x.contract, contractType: x.type, createdAt: AT }))
  const write = (file: string, data: unknown) => writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + '\n')
  write('library.json', LIBRARY)
  write('playbook.json', PLAYBOOK)
  write('accounts.json', accounts)
  write('contracts.json', contracts)
  write('precedents.json', [])
  console.log(`data/seed-demo: ${LIBRARY.length} clauses, ${PLAYBOOK.length} positions, ${accounts.length} accounts and contracts`)
}

// Run on its own (npm run demo:seed).
if (process.argv[1]?.endsWith('seed.ts')) writeDemoSeed()
