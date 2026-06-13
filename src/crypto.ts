/**
 * End-to-End Encryption Utilities using Web Crypto API.
 */

const getInternalKey = async (secret: string): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  
  // Hash the secret to ensure it's a valid length for AES-GCM (256 bits)
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  
  return await crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encryptMessage = async (message: string, secret: string): Promise<string> => {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getInternalKey(secret);
  
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(message)
  );

  const encryptedBytes = new Uint8Array(encryptedBuf);
  // Combine IV and Encrypted message
  const combined = new Uint8Array(iv.length + encryptedBytes.length);
  combined.set(iv, 0);
  combined.set(encryptedBytes, iv.length);

  // Convert to Base64
  return btoa(String.fromCharCode(...combined));
};

export const decryptMessage = async (encryptedBase64: string, secret: string): Promise<string> => {
  try {
    const combinedBytes = new Uint8Array(
      atob(encryptedBase64).split('').map(c => c.charCodeAt(0))
    );
    
    const iv = combinedBytes.slice(0, 12);
    const encryptedBytes = combinedBytes.slice(12);
    const key = await getInternalKey(secret);

    const decryptedBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedBytes
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuf);
  } catch (e) {
    return "[Encrypted Message - Invalid Secret]";
  }
};
