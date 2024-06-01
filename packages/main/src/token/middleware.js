import {separateToken} from '.';
import store from '../store';

/**
 * @param {string[]} permissions
 */
export function verify(permissions) {
  return (req, res, next) => {
    const token = (req.headers['authorization'] ?? '').replace('Bearer ', '');
    if (!token) {
      res.status(401);
      res.send('Token is blank!');
      return ;
    }
    try {
      const info = separateToken(token);
      if (!permissions.every((p) => info.auth.indexOf(p) >= 0)) {
        res.status(401);
        res.send('No such auth!');
        return ;
      }
      const authRecords = store.settings.get('authRecords') || [];
      if (authRecords.length === 0 || !authRecords.some((a) => a.id === info.id && a.clientId === info.clientId && a.platform === info.platform && a.name === info.name && a.auth === info.auth && a.status === 1)) {
        res.status(401);
        res.send('Authorization not recorded!');
        return ;
      }
      if (info.expiredTime !== 0) {
        if (Date.now() > info.expiredTime + info.createdAt) {
          res.status(401);
          res.send('Token is expired!');
          return ;
        }
      }
      req.auth = info;
    } catch (e) {
      console.error(e);
      res.status(401);
      res.send('Token is not valid!');
      return ;
    }
    next();
  };
}
