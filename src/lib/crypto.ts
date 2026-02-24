/**
 * Web Crypto Primitives for encrypt.click
 * Zero-knowledge, browser-only cryptography.
 */

import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { ulid } from 'ulid';
import * as bip39 from 'bip39';
import * as forge from 'node-forge';
import * as openpgp from 'openpgp';
import zxcvbn from 'zxcvbn';
import { jwtDecode } from 'jwt-decode';

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

/**
 * Bcrypt Hashing
 */
export async function bcryptHash(text: string, rounds: number = 10): Promise<string> {
    return new Promise((resolve, reject) => {
        bcrypt.hash(text, rounds, (err: Error | null, hash: string | undefined) => {
            if (err || !hash) reject(err || new Error('Bcrypt failed'));
            else resolve(hash);
        });
    });
}

export async function bcryptVerify(text: string, hash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        bcrypt.compare(text, hash, (err: Error | null, res: boolean | undefined) => {
            if (err) reject(err);
            else resolve(res || false);
        });
    });
}

/**
 * Token & ID Generation
 */
export function generateUUID(): string {
    return uuidv4();
}

export function generateULID(): string {
    return ulid();
}

export function generateToken(length: number = 32, type: 'hex' | 'base64' | 'url-safe' = 'hex'): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    if (type === 'hex') {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (type === 'base64') {
        return btoa(String.fromCharCode(...bytes));
    }
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * HMAC Generation
 */
export async function hmac(text: string, key: string, algorithm: 'SHA-256' | 'SHA-512' = 'SHA-256'): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const textData = encoder.encode(text);

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: algorithm },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, textData);
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * BIP39 Passphrase
 */
export function generateMnemonic(strength: 128 | 256 = 128): string {
    return bip39.generateMnemonic(strength);
}

/**
 * RSA Key Pair Generation
 */
export async function generateRSAKeyPair(bits: number = 2048): Promise<{ publicKey: string, privateKey: string }> {
    return new Promise((resolve, reject) => {
        forge.pki.rsa.generateKeyPair({ bits, workers: 2 }, (err: Error | null, keypair: forge.pki.rsa.KeyPair) => {
            if (err) reject(err);
            else {
                resolve({
                    publicKey: forge.pki.publicKeyToPem(keypair.publicKey),
                    privateKey: forge.pki.privateKeyToPem(keypair.privateKey)
                });
            }
        });
    });
}

/**
 * SSH Key Pair Generation (OpenSSH format)
 */
export async function generateSSHKeyPair(bits: number = 4096): Promise<{ publicKey: string; privateKey: string }> {
    return new Promise((resolve, reject) => {
        forge.pki.rsa.generateKeyPair({ bits, workers: 2 }, (err: Error | null, keypair: forge.pki.rsa.KeyPair) => {
            if (err) reject(err);
            else {
                const publicKey = (forge as any).ssh.publicKeyToOpenSSH(keypair.publicKey);
                const privateKey = (forge as any).ssh.privateKeyToOpenSSH(keypair.privateKey);
                resolve({ publicKey, privateKey });
            }
        });
    });
}

/**
 * PGP (OpenPGP) RSA Key Pair Generation
 */
export async function generatePGPKeyPair(options: {
    name: string;
    email: string;
    passphrase?: string;
    rsaBits?: number;
}): Promise<{ publicKey: string; privateKey: string }> {
    const { name, email, passphrase, rsaBits = 4096 } = options;

    const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'rsa',
        rsaBits,
        userIDs: [{ name, email }],
        passphrase: passphrase && passphrase.length > 0 ? passphrase : undefined
    } as any);

    return { publicKey, privateKey };
}

/**
 * Base64 Encoding (UTF-8 safe)
 */
export function base64Encode(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

export function base64Decode(base64: string): string {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

/**
 * Rot13 / Shift Cipher
 */
export function rot13(text: string, shift: number = 13, alphabet: string = 'abcdefghijklmnopqrstuvwxyz'): string {
    const lower = alphabet.toLowerCase();
    const upper = alphabet.toUpperCase();
    const len = alphabet.length;

    return text.split('').map(char => {
        const lowerIdx = lower.indexOf(char);
        if (lowerIdx !== -1) return lower[(lowerIdx + shift) % len];
        const upperIdx = upper.indexOf(char);
        if (upperIdx !== -1) return upper[(upperIdx + shift) % len];
        return char;
    }).join('');
}

/**
 * Atbash Cipher
 */
export function atbash(text: string, alphabet: string = 'abcdefghijklmnopqrstuvwxyz'): string {
    const lower = alphabet.toLowerCase();
    const upper = alphabet.toUpperCase();
    const reversedLower = lower.split('').reverse().join('');
    const reversedUpper = upper.split('').reverse().join('');

    return text.split('').map(char => {
        const lowerIdx = lower.indexOf(char);
        if (lowerIdx !== -1) return reversedLower[lowerIdx];
        const upperIdx = upper.indexOf(char);
        if (upperIdx !== -1) return reversedUpper[upperIdx];
        return char;
    }).join('');
}

/**
 * Vigenère Cipher
 */
export function vigenere(text: string, key: string, decrypt: boolean = false, alphabet: string = 'abcdefghijklmnopqrstuvwxyz'): string {
    const alpha = alphabet.toLowerCase();
    const len = alpha.length;
    const cleanKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (!cleanKey) return text;

    let keyIdx = 0;
    return text.split('').map(char => {
        const isUpper = char === char.toUpperCase() && char !== char.toLowerCase();
        const lowerChar = char.toLowerCase();
        const alphaIdx = alpha.indexOf(lowerChar);

        if (alphaIdx !== -1) {
            const shift = alpha.indexOf(cleanKey[keyIdx % cleanKey.length]);
            const newIdx = decrypt
                ? (alphaIdx - shift + len) % len
                : (alphaIdx + shift) % len;
            keyIdx++;
            const newChar = alpha[newIdx];
            return isUpper ? newChar.toUpperCase() : newChar;
        }
        return char;
    }).join('');
}

/**
 * Morse Code
 */
const MORSE_MAP: Record<string, string> = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.', 'G': '--.', 'H': '....',
    'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---', 'P': '.--.',
    'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....',
    '6': '-....', '7': '--...', '8': '---..', '9': '----.', '0': '-----', ' ': '/'
};
const REVERSE_MORSE = Object.fromEntries(Object.entries(MORSE_MAP).map(([k, v]) => [v, k]));

export function toMorse(text: string): string {
    return text.toUpperCase().split('').map(char => MORSE_MAP[char] || char).join(' ');
}

export function fromMorse(morse: string): string {
    return morse.split(' ').map(code => REVERSE_MORSE[code] || code).join('');
}

/**
 * Password Strength
 */
export function analyzePassword(password: string) {
    return zxcvbn(password);
}

/**
 * JWT Debugger
 */
export function decodeJWT(token: string) {
    try {
        return {
            header: jwtDecode(token, { header: true }),
            payload: jwtDecode(token)
        };
    } catch (e) {
        throw new Error('Invalid JWT token');
    }
}

/**
 * Leak Checker (k-Anonymity)
 * Returns the number of times the hash prefix matches in HIBP database
 */
export async function checkLeak(password: string): Promise<number> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fullHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    const prefix = fullHash.slice(0, 5);
    const suffix = fullHash.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    const text = await response.text();

    const lines = text.split('\n');
    for (const line of lines) {
        const [lineSuffix, count] = line.split(':');
        if (lineSuffix.trim() === suffix) {
            return parseInt(count);
        }
    }
    return 0;
}

/**
 * Enigma M3 Simulator
 */
const ENIGMA_ROTORS: Record<string, string> = {
    I: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ',
    II: 'AJDKSIRUXBLHWTMCQGZNPYFVOE',
    III: 'BDFHJLCPRTXVZNYEIWGAKMUSQO',
    IV: 'ESOVPZJAYQUIRHXLNFTGKDCMWB',
    V: 'VZBRGITYUPSDNHLXAWMJQOFECK'
};
const ENIGMA_REFLECTORS: Record<string, string> = {
    B: 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
    C: 'FVPJIAOYEDRZRKGXSHQBTLWNCU'
};
const ENIGMA_NOTCHES: Record<string, string> = { I: 'Q', II: 'E', III: 'V', IV: 'J', V: 'Z' };

export class Enigma {
    rotors: string[];
    positions: number[];
    rings: number[];
    reflector: string;
    plugboard: Record<string, string>;

    constructor(rotorTypes: string[], positions: string, rings: number[], reflector: string, plugs: string = '') {
        this.rotors = rotorTypes.map(t => ENIGMA_ROTORS[t]);
        this.positions = positions.split('').map(p => p.charCodeAt(0) - 65);
        this.rings = rings;
        this.reflector = ENIGMA_REFLECTORS[reflector];
        this.plugboard = {};
        plugs.split(' ').forEach(pair => {
            if (pair.length === 2) {
                this.plugboard[pair[0]] = pair[1];
                this.plugboard[pair[1]] = pair[0];
            }
        });
    }

    step() {
        // Double stepping logic
        const rotor1Type = Object.keys(ENIGMA_ROTORS).find(k => ENIGMA_ROTORS[k] === this.rotors[0]);
        const rotor2Type = Object.keys(ENIGMA_ROTORS).find(k => ENIGMA_ROTORS[k] === this.rotors[1]);

        if (!rotor1Type || !rotor2Type) return;

        const notch1 = ENIGMA_NOTCHES[rotor1Type].charCodeAt(0) - 65;
        const notch2 = ENIGMA_NOTCHES[rotor2Type].charCodeAt(0) - 65;

        if (this.positions[1] === notch2) {
            this.positions[0] = (this.positions[0] + 1) % 26;
            this.positions[1] = (this.positions[1] + 1) % 26;
        } else if (this.positions[2] === notch1) {
            this.positions[1] = (this.positions[1] + 1) % 26;
        }
        this.positions[2] = (this.positions[2] + 1) % 26;
    }

    processChar(char: string): string {
        if (!/[A-Z]/.test(char.toUpperCase())) return char;

        this.step();
        let c = this.plugboard[char.toUpperCase()] || char.toUpperCase();
        let val = c.charCodeAt(0) - 65;

        // Forward through rotors
        for (let i = 2; i >= 0; i--) {
            val = (this.rotors[i].charCodeAt((val + this.positions[i] - this.rings[i] + 26) % 26) - 65 - this.positions[i] + this.rings[i] + 26) % 26;
        }

        // Reflector
        val = this.reflector.charCodeAt(val) - 65;

        // Backward through rotors
        for (let i = 0; i <= 2; i++) {
            const charAtVal = String.fromCharCode(((val + this.positions[i] - this.rings[i] + 26) % 26) + 65);
            val = (this.rotors[i].indexOf(charAtVal) - this.positions[i] + this.rings[i] + 26) % 26;
        }

        c = String.fromCharCode(val + 65);
        return this.plugboard[c] || c;
    }

    process(text: string): string {
        return text.toUpperCase().split('').map(c => this.processChar(c)).join('');
    }
}
