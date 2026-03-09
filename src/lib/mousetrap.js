import Mousetrap from 'mousetrap';

Mousetrap.prototype.stopCallback = function () {
  return false;
};

export default Mousetrap;
