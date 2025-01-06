import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage';
import bcryptjs from 'bcryptjs';

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
        const hashedPassword = await bcryptjs.hash(password, 10); // Hash the password
        this.sharedKey = hashedPassword;
        await storage.set('sharedKey', hashedPassword); // Store the hashed password
      } catch (error) {
        console.error('Error setting global password:', error);
        throw error;
      }
    },
    async isValidPassword(enteredPassword) {
      try {
        return await bcryptjs.compare(enteredPassword, this.sharedKey); // Compare with hashed global password
      } catch (error) {
        console.error('Error validating password:', error);
        throw error;
      }
    },
    async resetPassword(currentPassword, newPassword) {
      try {
        // Check if the current password matches the stored one
        const isCurrentPasswordValid = await this.isValidPassword(
          currentPassword
        );
        if (!isCurrentPasswordValid) {
          throw new Error('Current password is incorrect');
        }

        // Hash the new password
        const hashedNewPassword = await bcryptjs.hash(newPassword, 10);

        // Update the sharedKey with the new hashed password
        this.sharedKey = hashedNewPassword;
        await storage.set('sharedKey', hashedNewPassword);

        return true; // Password reset successful
      } catch (error) {
        console.error('Error resetting password:', error);
        throw error;
      }
    },
  },
});
