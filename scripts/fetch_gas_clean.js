const fs = require('fs');

async function main() {
  const gasUrl = 'https://script.google.com/macros/s/AKfycbw8005H1Go8ygULx_eni6Vrk4UmrodioiI6KQm99jh4epcaQKrmT9IylpjLFvKLMZQw/exec';
  console.log('Fetching getInitialAppData from GAS...');
  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      functionName: 'getInitialAppData',
      arguments: []
    }),
    redirect: 'follow'
  });
  
  const text = await res.text();
  console.log('Received response, length:', text.length);
  const data = JSON.parse(text);
  console.log('Success:', data.success);
  console.log('Knowledge items count:', data.knowledge?.length);
  
  let corruptedCount = 0;
  for (const k of (data.knowledge || [])) {
    const s = JSON.stringify(k);
    if (s.includes('\uFFFD') || s.includes('')) corruptedCount++;
  }
  console.log('Knowledge items with corrupted characters in GAS response:', corruptedCount);
  
  if (data.knowledge && data.knowledge.length > 0) {
    fs.writeFileSync('data_backup/gas_live_initial_data.json', text, 'utf8');
    console.log('Saved to data_backup/gas_live_initial_data.json');
    console.log('First 3 titles:', data.knowledge.slice(0, 3).map(k => k.title));
  }
}

main().catch(console.error);
