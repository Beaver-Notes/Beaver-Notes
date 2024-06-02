import {separateToken} from '.';
import store from '../store';

/**
 * @param {string[]} permissions
 */
export function verify(permissions) {
  return (req, res, next) => {
    const token = (req.headers['authorization'] ?? '').replace('Bearer ', '');
    
    if (!token) {
      console.log('Token is blank!');
      return res.status(401).send('Token is blank!');
    }
    
    try {
      const info = separateToken(token);
      
      // Log the entire info object
      console.log('Parsed token info:', info);

      // Ensure info.auth is a string and convert it to an array
      if (typeof info.auth === 'string') {
        info.auth = info.auth.split(',').sort();
      }

      // Ensure info.auth is now an array
      if (!Array.isArray(info.auth)) {
        console.log('Token auth data is invalid!', info.auth);
        return res.status(401).send('Token auth data is invalid!');
      }

      // Log the permissions being checked
      console.log('Required permissions:', permissions);
      console.log('Token permissions:', info.auth);

      // Ensure all permissions are present
      if (!permissions.every((p) => info.auth.includes(p))) {
        console.log('No such permission!');
        return res.status(401).send('No such permission!');
      }
      
      const authRecords = store.settings.get('authRecords') || [];

      // Log the authorization records
      console.log('Authorization records:', authRecords);

      // Ensure authRecords is an array of objects with auth as a comma-separated string
      const isAuthorized = authRecords.some((record) => {
        const recordAuthArray = record.auth.split(',').sort(); // Convert back to array and sort
        const infoAuthSorted = info.auth.sort();
        const match = (
          typeof record === 'object' &&
          record !== null &&
          Array.isArray(recordAuthArray) &&
          record.id === info.id &&
          record.clientId === info.clientId &&
          record.platform === info.platform &&
          record.name === info.name &&
          JSON.stringify(recordAuthArray) === JSON.stringify(infoAuthSorted) && // Compare sorted arrays
          record.status === 1 &&
          record.createdAt === info.createdAt &&
          record.expiredTime === info.expiredTime
        );

        if (!match) {
          console.log('Record mismatch:', record, info);
        }

        return match;
      });

      if (!isAuthorized) {
        console.log('Authorization not recorded!');
        return res.status(401).send('Authorization not recorded!');
      }
      
      if (info.expiredTime !== 0 && Date.now() > info.createdAt + info.expiredTime) {
        console.log('Token is expired!');
        return res.status(401).send('Token is expired!');
      }

      req.auth = info;
    } catch (error) {
      console.error('Token validation error:', error);
      return res.status(401).send('Token is not valid!');
    }
    
    next();
  };
}
