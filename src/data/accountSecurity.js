export const ACCOUNT_PASSWORDS_KEY = 'smartLocationAccountPasswords'

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value) {
  return Uint8Array.from(value.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16))
}

async function derivePasswordHash(password, salt) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Trình duyệt không hỗ trợ lưu mật khẩu an toàn.')
  }

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const derivedBits = await globalThis.crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: hexToBytes(salt),
    iterations: 120000,
    hash: 'SHA-256',
  }, keyMaterial, 256)
  return bytesToHex(new Uint8Array(derivedBits))
}

export async function createAccountPasswordCredential(password) {
  const saltBytes = new Uint8Array(16)
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Trình duyệt không hỗ trợ tạo mật khẩu an toàn.')
  }
  globalThis.crypto.getRandomValues(saltBytes)
  const salt = bytesToHex(saltBytes)
  return { salt, hash: await derivePasswordHash(password, salt) }
}

export async function verifyAccountPassword(password, credential) {
  if (!credential || typeof credential.salt !== 'string' || typeof credential.hash !== 'string') {
    return false
  }
  return await derivePasswordHash(password, credential.salt) === credential.hash
}

export function readAccountPasswordHashes() {
  const storedPasswords = localStorage.getItem(ACCOUNT_PASSWORDS_KEY)
  if (!storedPasswords) return {}

  const parsedPasswords = JSON.parse(storedPasswords)
  if (!parsedPasswords || typeof parsedPasswords !== 'object' || Array.isArray(parsedPasswords)) {
    throw new Error('Dữ liệu tài khoản đã lưu không hợp lệ.')
  }

  return parsedPasswords
}
