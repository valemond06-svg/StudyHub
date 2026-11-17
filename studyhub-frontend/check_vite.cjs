const { build } = require('vite');
build({
  root: '.',
  build: {
    outDir: 'dist-test',
    emptyOutDir: true,
  },
}).then(() => {
  const fs = require('fs');
  const content = fs.readFileSync('./dist-test/assets/index-B6jC8pTr.js', 'utf8');
  console.log('Has transformLecture:', content.includes('transformLecture'));
  console.log('Has transformLectures:', content.includes('transformLectures'));
  console.log('Has Boolean(lecture.n_slides:', content.includes('Boolean(lecture.n_slides'));
  console.log('Has has_slides:', content.includes('has_slides'));
});
