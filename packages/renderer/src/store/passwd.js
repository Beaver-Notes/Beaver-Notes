import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage';
import bcrypt from 'bcryptjs'; // Import bcrypt library

const storage = useStorage();

export const usePasswordStore = defineStore('password', {
  state: () => ({
    hashedPasswords: [],
  }),
  actions: {
    async retrieve() {
      try {
        this.hashedPasswords = await storage.get('hashedPasswords', []);
        return this.hashedPasswords;
      } catch (error) {
        console.error('Error retrieving hashed passwords:', error);
        return [];
      }
    },
    async add(password) {
      try {
        const saltRounds = 10; // Number of salt rounds
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        this.hashedPasswords.push(hashedPassword);
        await storage.set('hashedPasswords', this.hashedPasswords);
        return hashedPassword;
      } catch (error) {
        console.error('Error hashing password:', error);
        throw error;
      }
    },
    async delete(password) {
      try {
        const index = this.hashedPasswords.indexOf(password);
        if (index !== -1) {
          this.hashedPasswords.splice(index, 1);
          await storage.set('hashedPasswords', this.hashedPasswords);
          return password;
        }
        return null;
      } catch (error) {
        console.error('Error deleting password:', error);
        throw error;
      }
    },
    async isValidPassword(enteredPassword) {
      try {
        for (const hashedPassword of this.hashedPasswords) {
          if (await bcrypt.compare(enteredPassword, hashedPassword)) {
            return true;
          }
        }
        return false;
      } catch (error) {
        console.error('Error validating password:', error);
        throw error;
      }
    },
  },
});
