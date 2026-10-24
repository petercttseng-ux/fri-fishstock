const fs = require('fs'), vm = require('vm'), path = require('path');
module.exports = function (...files) { for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js/core', f), 'utf8'), { filename: f }); return globalThis.FS; };
