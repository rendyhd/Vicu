import { randomBytes, createHash } from 'crypto'

export function generatePKCE(): { code_verifier: string; code_challenge: string } {
  const code_verifier = randomBytes(32).toString('base64url')
  const code_challenge = createHash('sha256').update(code_verifier).digest('base64url')
  return { code_verifier, code_challenge }
}
