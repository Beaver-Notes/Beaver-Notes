// crypto-utils.js

import CryptoJS from 'crypto-js';

// Encryption function
export function encryptContent(password, content) {
  const encrypted = CryptoJS.AES.encrypt(content, password);
  return encrypted.toString();
}

// Decryption function
export function decryptContent(password, encryptedContent) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedContent, password);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted;
  } catch (error) {
    // Handle decryption errors (e.g., incorrect password)
    return null;
  }
}
