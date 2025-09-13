const bcrypt = require('bcrypt');

(async () => {
  const password = 'dirwo0-Wycwof-borzoj';
  const saltRounds = 12;
  const hash = await bcrypt.hash(password, saltRounds);
  console.log(hash);
})();