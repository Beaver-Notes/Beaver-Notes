import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage';

const storage = useStorage();

export const usePasswordStore = defineStore('password', {
  state: () => ({
    hashes: [],
  }),
  actions: {
    async retrieve() {
      try {
        const storedHashes = await storage.get('password_hashes', []);
        this.hashes = storedHashes;
        return this.hashes;
      } catch (error) {
        console.error('Error retrieving password hashes:', error);
        return [];
      }
    },
    async add(password) {
      try {
        // Generate a random salt
        const salt = crypto.getRandomValues(new Uint8Array(16));
        // Concatenate the password and salt
        const saltedPassword = new TextEncoder().encode(
          password + arrayBufferToHex(salt)
        );
        // Calculate hash of the salted password
        const hashBuffer = await crypto.subtle.digest(
          'SHA-256',
          saltedPassword
        );
        const passwordHash = arrayBufferToHex(hashBuffer);

        // Add the hash to the array
        this.hashes.push(passwordHash);

        // Store the updated hashes array
        await storage.set('password_hashes', this.hashes);

        return passwordHash;
      } catch (error) {
        console.error('Error adding password hash:', error);
        throw error;
      }
    },
    async delete(passwordHash) {
      try {
        const hashIndex = this.hashes.indexOf(passwordHash);
        if (hashIndex !== -1) {
          // Remove the hash from the array
          this.hashes.splice(hashIndex, 1);
          // Store the updated hashes array
          await storage.set('password_hashes', this.hashes);
          return passwordHash;
        }
        return null;
      } catch (error) {
        console.error('Error deleting password hash:', error);
        throw error;
      }
    },
    async isValidPassword(enteredPassword) {
      try {
        // Iterate through stored password hashes
        for (const storedPasswordHash of this.hashes) {
          // Extract the stored salt and hash
          const storedSalt = hexToArrayBuffer(storedPasswordHash.slice(64));
          const storedHash = hexToArrayBuffer(storedPasswordHash.slice(0, 64));
          // Concatenate the entered password and stored salt
          const saltedEnteredPassword = new TextEncoder().encode(
            enteredPassword + arrayBufferToHex(storedSalt)
          );
          // Calculate hash of the salted entered password
          const enteredPasswordHashBuffer = await crypto.subtle.digest(
            'SHA-256',
            saltedEnteredPassword
          );
          const enteredPasswordHash = arrayBufferToHex(
            enteredPasswordHashBuffer
          );
          // Check if the entered password hash matches the stored hash
          if (enteredPasswordHash === arrayBufferToHex(storedHash)) {
            return true;
          }
        }
        // If no match is found, return false
        return false;
      } catch (error) {
        console.error('Error validating password:', error);
        throw error;
      }
    },
  },
});

// Helper function to convert ArrayBuffer to hexadecimal string
function arrayBufferToHex(buffer) {
  return Array.prototype.map
    .call(new Uint8Array(buffer), (byte) =>
      ('00' + byte.toString(16)).slice(-2)
    )
    .join('');
}

// Helper function to convert hexadecimal string to ArrayBuffer
function hexToArrayBuffer(hexString) {
  const bytes = [];
  for (let i = 0; i < hexString.length; i += 2) {
    bytes.push(parseInt(hexString.substr(i, 2), 16));
  }
  return new Uint8Array(bytes);
}
