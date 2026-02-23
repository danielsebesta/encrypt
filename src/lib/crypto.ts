/**
 * Web Crypto Primitives for encrypt.click
 * Zero-knowledge, browser-only cryptography.
 */

const PBKDF2_ITERATIONS = 100000;
const SALT_SIZE = 16;
const IV_SIZE = 12;

/**
 * Derives a 256-bit AES-GCM key from a password and salt using PBKDF2.
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as any,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts cleartext using AES-GCM-256 with PBKDF2 key derivation.
 * Returns [Salt(16) | IV(12) | Ciphertext]
 */
export async function encrypt(text: string, password: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
    const key = await deriveKey(password, salt);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(text)
    );

    const result = new Uint8Array(SALT_SIZE + IV_SIZE + ciphertext.byteLength);
    result.set(salt, 0);
    result.set(iv, SALT_SIZE);
    result.set(new Uint8Array(ciphertext), SALT_SIZE + IV_SIZE);

    return result;
}

/**
 * Decrypts the combined buffer [Salt(16) | IV(12) | Ciphertext].
 */
export async function decrypt(data: Uint8Array, password: string): Promise<string> {
    const salt = data.slice(0, SALT_SIZE);
    const iv = data.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
    const ciphertext = data.slice(SALT_SIZE + IV_SIZE);

    const key = await deriveKey(password, salt);
    const cleartext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );

    return new TextDecoder().decode(cleartext);
}

/**
 * Converts a Uint8Array bitstream into 14-bit chunks (0-16383).
 * Includes the original length (2 bytes) at the beginning for perfect recovery.
 */
export function to14BitChunks(data: Uint8Array): number[] {
    // Prepend length (up to 65535 bytes)
    const length = data.byteLength;
    const combined = new Uint8Array(length + 2);
    combined[0] = (length >> 8) & 0xff;
    combined[1] = length & 0xff;
    combined.set(data, 2);

    const chunks: number[] = [];
    let currentVal = 0;
    let currentBits = 0;

    for (const byte of combined) {
        currentVal = (currentVal << 8) | byte;
        currentBits += 8;

        while (currentBits >= 14) {
            currentBits -= 14;
            chunks.push((currentVal >> currentBits) & 0x3fff);
            currentVal &= (1 << currentBits) - 1;
        }
    }

    if (currentBits > 0) {
        chunks.push((currentVal << (14 - currentBits)) & 0x3fff);
    }

    return chunks;
}

/**
 * Reconstructs a Uint8Array from 14-bit chunks using the prepended length.
 */
export function from14BitChunks(chunks: number[]): Uint8Array {
    const bytes: number[] = [];
    let currentVal = 0;
    let currentBits = 0;

    for (const chunk of chunks) {
        currentVal = (currentVal << 14) | (chunk & 0x3fff);
        currentBits += 14;

        while (currentBits >= 8) {
            currentBits -= 8;
            bytes.push((currentVal >> currentBits) & 0xff);
            currentVal &= (1 << currentBits) - 1;
        }
    }

    if (bytes.length < 2) return new Uint8Array(0);

    const length = (bytes[0] << 8) | bytes[1];
    return new Uint8Array(bytes.slice(2, 2 + length));
}
