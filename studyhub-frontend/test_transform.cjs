async function test() {
  try {
    // Test direct backend
    const backendResponse = await fetch('http://localhost:8765/api/courses/25782/lectures');
    const backendData = await backendResponse.json();
    console.log('=== BACKEND (direct) ===');
    console.log('has_audio:', backendData[0].has_audio);
    console.log('n_slides:', backendData[0].n_slides);
    console.log('transcript_source:', backendData[0].transcript_source);

    // Test via Vite proxy
    const proxyResponse = await fetch('http://localhost:5175/api/courses/25782/lectures');
    const proxyData = await proxyResponse.json();
    console.log('\n=== VIA VITE PROXY ===');
    console.log('has_audio:', proxyData[0].has_audio);
    console.log('has_slides:', proxyData[0].has_slides);
    console.log('has_transcript:', proxyData[0].has_transcript);
  } catch (e) {
    console.error('Error:', e.message);
  }
}
test();
