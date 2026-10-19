// Demo 3: a supplier's Master Services Agreement, formatted as a real one is (a logo in the header,
// address blocks, Word's multilevel numbering, a pricing table with merged cells, a footer with
// page numbers), with their tracked changes and a comment. It shows the Word layout. The README in
// its folder (written by hand) is the guide.
import { deflateSync } from 'node:zlib'
import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  Footer,
  Header,
  ImageRun,
  InsertedTextRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType
} from 'docx'

export const MSA_FILE = 'Harbourline-Master-Services-Agreement.docx'

/** A small logo (a teal mark on white), drawn here so the demo needs no image files. */
function logo(): Buffer {
  const w = 96
  const h = 96
  const rows: number[] = []
  for (let y = 0; y < h; y++) {
    rows.push(0)
    for (let x = 0; x < w; x++) {
      const inMark = Math.hypot(x - 48, y - 48) < 44
      const wave = Math.abs(y - (52 + 9 * Math.sin(x / 9))) < 5
      const [r, g, b] = !inMark ? [255, 255, 255] : wave ? [255, 255, 255] : [13, 128, 128]
      rows.push(r, g, b)
    }
  }
  const crc = (buf: Buffer) => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))])
}

export async function msaDocx(): Promise<Buffer> {
  const who = { author: 'Harbourline Legal', date: '2026-10-14T10:00:00Z' }
  let id = 1
  const ins = (text: string) => new InsertedTextRun({ text, id: id++, ...who })
  const del = (text: string) => new DeletedTextRun({ text, id: id++, ...who })
  const t = (text: string, o: { bold?: boolean; italics?: boolean; underline?: object; break?: number; size?: number; color?: string } = {}) => new TextRun({ text, ...o })
  const num = (level: number, children: (TextRun | InsertedTextRun | DeletedTextRun | CommentRangeStart | CommentRangeEnd | CommentReference)[]) =>
    new Paragraph({ numbering: { reference: 'clauses', level }, spacing: { after: 120 }, children })
  const cell = (children: (TextRun | InsertedTextRun | DeletedTextRun)[], o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; span?: number; rows?: number; head?: boolean } = {}) =>
    new TableCell({
      children: [new Paragraph({ children, alignment: o.align })],
      columnSpan: o.span,
      rowSpan: o.rows,
      shading: o.head ? { type: ShadingType.CLEAR, fill: 'EEF3F3', color: 'auto' } : undefined
    })
  const address = (n: string, name: string, lines: string[], as: string) =>
    new Paragraph({
      indent: { left: 567, hanging: 567 },
      spacing: { after: 160 },
      children: [t(`${n}\t`), t(name, { bold: true }), ...lines.map((x) => t(x, { break: 1 })), t(`(${as})`, { break: 1 })]
    })
  const small = { size: 16, color: '5F6B6B' }

  const doc = new Document({
    creator: 'Harbourline Hosting Ltd',
    title: 'Master Services Agreement',
    comments: {
      children: [{ id: 0, author: 'Harbourline Legal', date: new Date('2026-10-14T10:05:00Z'), children: [new Paragraph({ children: [t('Our release cycle needs a longer cure period.')] })] }]
    },
    styles: { default: { document: { run: { font: 'Georgia', size: 21 } } } },
    numbering: {
      config: [
        {
          reference: 'clauses',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { run: { bold: true }, paragraph: { indent: { left: 567, hanging: 567 } } } },
            { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 567, hanging: 567 } } } },
            { level: 2, format: LevelFormat.LOWER_LETTER, text: '(%3)', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1134, hanging: 567 } } } }
          ]
        }
      ]
    },
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({ children: [new ImageRun({ type: 'png', data: logo(), transformation: { width: 34, height: 34 } })] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [t('Harbourline Hosting Ltd · Master Services Agreement', small)] })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
                children: [t('CONFIDENTIAL · HHL-MSA v3.2', small), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], ...small })]
              })
            ]
          })
        },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [t('MASTER SERVICES AGREEMENT', { bold: true, size: 32 })] }),
          new Paragraph({ spacing: { after: 160 }, children: [t('This Agreement is dated '), t('14 October 2026', { bold: true }), t(' and is made between:')] }),
          address('(1)', 'Harbourline Hosting Ltd', ['(company number 08812345)', 'Unit 4, Riverside Business Park', 'Bristol BS1 6QR', 'United Kingdom'], '"Harbourline"'),
          address('(2)', 'PortSwigger Ltd', ['(company number 05876422)', 'Victoria Court, Bexton Road', 'Knutsford WA16 0PF', 'United Kingdom'], 'the "Customer"'),
          num(0, [t('DEFINITIONS', { bold: true })]),
          num(1, [t('"Services"', { bold: true }), t(' means the managed hosting and support services described in '), t('Schedule 1', { italics: true }), t('.')]),
          num(1, [t('"Service Credits"', { bold: true }), t(' means the credits set out in the table in clause 3.2.')]),
          num(0, [t('SERVICE LEVELS', { bold: true })]),
          num(1, [t('Harbourline shall make the Services available '), del('99.9%'), ins('99.5%'), t(' of the time in each calendar month, excluding '), t('Scheduled Maintenance', { underline: {} }), t('.')]),
          num(1, [
            t('If Harbourline fails to meet a service level, the Customer may terminate on notice if the failure is not remedied within '),
            new CommentRangeStart(0),
            del('thirty (30)'),
            ins('sixty (60)'),
            new CommentRangeEnd(0),
            new CommentReference(0),
            t(' days.')
          ]),
          num(2, [t('This right is in addition to any Service Credits.')]),
          num(2, [t('This right may not be exercised more than once in any twelve-month period.')]),
          num(0, [t('FEES', { bold: true })]),
          num(1, [t('The Customer shall pay the fees in the table below, invoiced monthly in arrears.')]),
          num(1, [t('Service Credits apply as follows:')]),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  cell([t('Service', { bold: true })], { head: true }),
                  cell([t('Monthly fee', { bold: true })], { head: true, align: AlignmentType.RIGHT }),
                  cell([t('Service Credit', { bold: true })], { head: true, span: 2 })
                ]
              }),
              new TableRow({ children: [cell([t('Managed hosting')], { rows: 2 }), cell([t('£4,500')], { align: AlignmentType.RIGHT }), cell([t('Below 99.5%')]), cell([t('5%')])] }),
              new TableRow({ children: [cell([del('£1,200'), ins('£1,450')], { align: AlignmentType.RIGHT }), cell([t('Below 99.0%')]), cell([t('10%')])] }),
              new TableRow({ children: [cell([t('Total', { bold: true })]), cell([t('£5,950', { bold: true })], { align: AlignmentType.RIGHT }), cell([t('Cap', { bold: true })]), cell([t('20%')])] })
            ]
          }),
          new Paragraph({ spacing: { before: 240 }, children: [] }),
          num(0, [t('LIABILITY', { bold: true })]),
          num(1, [t("Each party's total liability under this Agreement in any contract year is limited to "), del('150%'), ins('100%'), t(' of the fees paid in that year.')]),
          num(0, [t('GOVERNING LAW', { bold: true })]),
          num(1, [t('This Agreement is governed by the laws of England and Wales.')]),
          new Paragraph({
            spacing: { before: 480 },
            tabStops: [{ type: TabStopType.LEFT, position: 4820 }],
            children: [
              t('Signed for Harbourline Hosting Ltd', { bold: true }),
              t('\tSigned for PortSwigger Ltd', { bold: true }),
              t('Name: Jordan Ellis', { break: 1 }),
              t('\tName: ______________________'),
              t('Title: General Counsel', { break: 1 }),
              t('\tTitle: _____________________')
            ]
          })
        ]
      }
    ]
  })
  return Packer.toBuffer(doc)
}
