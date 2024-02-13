import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage';
import bcrypt from 'bcryptjs';

const storage = useStorage();

export const usePasswordStore = defineStore('password', {
  state: () => ({
    sharedKey: '', // Store the global password
  }),
  actions: {
    async retrieve() {
      try {
        const storedPassword = await storage.get('sharedKey', '');
        this.sharedKey = storedPassword;
        return this.sharedKey;
      } catch (error) {
        console.error('Error retrieving global password:', error);
        return '';
      }
    },
    async setsharedKey(password) {
      try {
        const hashedPassword = await bcrypt.hash(password, 10); // Hash the password
        this.sharedKey = hashedPassword;
        await storage.set('sharedKey', hashedPassword); // Store the hashed password
      } catch (error) {
        console.error('Error setting global password:', error);
        throw error;
      }
    },
    async isValidPassword(enteredPassword) {
      try {
        return await bcrypt.compare(enteredPassword, this.sharedKey); // Compare with hashed global password
      } catch (error) {
        console.error('Error validating password:', error);
        throw error;
      }
    },
  },
});
