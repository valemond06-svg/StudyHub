const fs = require('fs');
const content = fs.readFileSync('./dist/assets/index-C98XVuQO.js', 'utf8');
console.log('Has Boolean(lecture.n_slides:', content.includes('Boolean(lecture.n_slides'));
console.log('Has has_slides:', content.includes('has_slides'));
console.log('Has .map(', content.includes('.map('));
