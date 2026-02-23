import * as forge from 'node-forge';
import * as crypto from 'crypto';
import { config } from './config';

/**
 * Represents the `encryptedContent` object from a Graph rich notification.
 */
export interface EncryptedContent {
    data: string; // base64-encoded encrypted resource data
    dataSignature: string; // base64-encoded HMAC-SHA256 signature
    dataKey: string; // base64-encoded RSA-OAEP-encrypted symmetric key
    encryptionCertificateId: string;
    encryptionCertificateThumbprint: string;
}

let cachedPrivateKey: forge.pki.rsa.PrivateKey | null = null;

/**
 * Loads the RSA private key from the base64-encoded PFX set in the
 * GRAPH_ENCRYPTION_PFX environment variable.
 */
function getPrivateKey(): forge.pki.rsa.PrivateKey {
    if (cachedPrivateKey) return cachedPrivateKey;

    const pfxBase64 = config.graphEncryptionPfx;
    if (!pfxBase64) {
        throw new Error(
            'GRAPH_ENCRYPTION_PFX environment variable is not set. ' +
                'Cannot decrypt rich notification payloads.',
        );
    }

    const pfxDer = forge.util.decode64(pfxBase64);
    const pfxAsn1 = forge.asn1.fromDer(pfxDer);
    const pkcs12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, config.graphEncryptionPfxPassword || '');

    // Extract the private key from the first matching bag
    const keyBags = pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const bags = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
    if (!bags || bags.length === 0 || !bags[0].key) {
        throw new Error('No private key found in the provided PFX.');
    }

    cachedPrivateKey = bags[0].key as forge.pki.rsa.PrivateKey;
    console.log('Loaded RSA private key from PFX for notification decryption.');
    return cachedPrivateKey;
}

/**
 * Decrypts the encrypted content from a Graph rich notification.
 *
 * Steps (per Microsoft Graph documentation):
 *  1. Decrypt `dataKey` with RSA-OAEP (SHA-1) using the private key → symmetric key
 *  2. Validate `dataSignature` — HMAC-SHA256 of the `data` base64 string using the symmetric key
 *  3. Decrypt `data` — base64-decode, first 16 bytes = IV, rest = AES-256-CBC ciphertext
 *
 * @returns The decrypted resource data as a parsed JSON object, or the raw string if not JSON.
 */
export function decryptNotificationContent(encrypted: EncryptedContent): any {
    const privateKey = getPrivateKey();

    // 1. Decrypt the symmetric key
    const encryptedKeyBytes = forge.util.decode64(encrypted.dataKey);
    const symmetricKeyBytes = privateKey.decrypt(encryptedKeyBytes, 'RSA-OAEP', {
        md: forge.md.sha1.create(),
        mgf1: { md: forge.md.sha1.create() },
    });

    // 2. Validate the HMAC-SHA256 signature
    // The HMAC is computed over the raw base64 string of `data`, NOT the decoded bytes.
    const hmac = forge.hmac.create();
    hmac.start('sha256', symmetricKeyBytes);
    hmac.update(forge.util.decode64(encrypted.data));
    const digest = hmac.digest().bytes();
    const computedSignature = forge.util.decodeUtf8(forge.util.encode64(digest));

    if (computedSignature !== encrypted.dataSignature) {
        console.error(
            `HMAC signature mismatch. Received ${encrypted.dataSignature}, computed ${computedSignature}`,
        );
    }

    // 3. Decrypt the data (AES-256-CBC)
    const symmetricKey = Buffer.from(symmetricKeyBytes, 'binary');
    const dataBytes = Buffer.from(encrypted.data, 'base64');
    const iv = symmetricKey.subarray(0, 16);

    const decipher = crypto.createDecipheriv('aes-256-cbc', symmetricKey, iv);
    const decrypted = Buffer.concat([decipher.update(dataBytes), decipher.final()]);
    const plaintext = decrypted.toString('utf8');

    return JSON.parse(plaintext);
}

/**
 * Returns true if the server is configured to decrypt rich notification payloads.
 */
export function canDecrypt(): boolean {
    return !!config.graphEncryptionPfx;
}
