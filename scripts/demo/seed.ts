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

/** One per demo, as its guide names them; then other clients, so the workspace looks in use. */
const DEMOS: { account: string; contract: string; type: ContractRecord['contractType']; key: string; more?: { title: string; type: ContractRecord['contractType'] }[] }[] = [
  { key: 'brightwater', account: 'Brightwater Robotics', contract: 'Mutual NDA', type: 'nda' },
  { key: 'kestrel', account: 'Kestrel Health Systems', contract: 'Confidentiality Agreement', type: 'nda' },
  { key: 'harbourline', account: 'Harbourline Hosting', contract: 'Master Services Agreement', type: 'general' },
  { key: 'northwind', account: 'Northwind Logistics', contract: 'Mutual NDA', type: 'nda', more: [{ title: 'Burp Suite DAST order form', type: 'order-form' }] },
  { key: 'acme', account: 'Acme Analytics', contract: 'Order form 2026', type: 'order-form' },
  { key: 'globex', account: 'Globex Retail', contract: 'Mutual NDA', type: 'nda', more: [{ title: 'Penetration testing services', type: 'general' }] },
  { key: 'initech', account: 'Initech Software', contract: 'Reseller NDA', type: 'nda' }
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
  const contracts: ContractRecord[] = DEMOS.flatMap((x) => [
    { id: `ct-demo-${x.key}`, accountId: `ac-demo-${x.key}`, title: x.contract, contractType: x.type, createdAt: AT },
    ...(x.more ?? []).map((m, i) => ({ id: `ct-demo-${x.key}-${i + 2}`, accountId: `ac-demo-${x.key}`, title: m.title, contractType: m.type, createdAt: AT }))
  ])
  const write = (file: string, data: unknown) => writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + '\n')
  write('library.json', LIBRARY)
  write('playbook.json', PLAYBOOK)
  write('accounts.json', accounts)
  write('contracts.json', contracts)
  write('precedents.json', [])
  const files = join(root, 'data', 'demo-files')
  mkdirSync(files, { recursive: true })
  for (const f of FILES) copyFileSync(join(root, 'demo', f), join(files, f.split('/').pop()!))
  console.log(`data/seed-demo: ${LIBRARY.length} clauses, ${PLAYBOOK.length} positions, ${accounts.length} accounts, ${contracts.length} contracts; data/demo-files: ${FILES.length} contracts`)
}

// Run on its own (npm run demo:seed).
if (process.argv[1]?.endsWith('seed.ts')) writeDemoSeed()
