import type { VercelRequest, VercelResponse } from '@vercel/node'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  try {
    const data = req.body
    if (!data?.systems || !data?.project) {
      return res.status(400).json({ error: 'Missing project or systems data' })
    }

    const id = randomUUID().slice(0, 8)
    const inputPath = join(tmpdir(), `sembrado_input_${id}.json`)
    const outputPath = join(tmpdir(), `sembrado_${id}.pdf`)

    // Write input data to temp file
    writeFileSync(inputPath, JSON.stringify(data))

    // Execute Python generator
    const scriptPath = join(__dirname, 'generate_sembrado.py')
    const cmd = `python3 ${scriptPath} --input "${inputPath}" --output "${outputPath}"`

    try {
      execSync(cmd, { timeout: 25000, stdio: 'pipe' })
    } catch (pyErr: unknown) {
      const errMsg = pyErr instanceof Error ? (pyErr as { stderr?: Buffer }).stderr?.toString() || pyErr.message : 'Unknown error'
      console.error('Python error:', errMsg)
      return res.status(500).json({ error: 'PDF generation failed', details: errMsg.substring(0, 500) })
    }

    // Read generated PDF
    const pdfBuffer = readFileSync(outputPath)

    // Cleanup
    try { unlinkSync(inputPath) } catch {}
    try { unlinkSync(outputPath) } catch {}

    // Return PDF
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="Sembrado_${data.project?.name || 'OMM'}.pdf"`)
    res.setHeader('Content-Length', pdfBuffer.length.toString())
    return res.send(pdfBuffer)

  } catch (err) {
    console.error('Sembrado endpoint error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
