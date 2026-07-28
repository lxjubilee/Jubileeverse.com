const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});
client.messages.create({
  model:'claude-sonnet-4-6', max_tokens:200,
  messages:[{role:'user',content:'Reply with only this exact JSON: {"title":"test","summary":"ok","body":"body text here"}'}]
}).then(r=>{ console.log('API OK:', r.content[0].text.substring(0,100)); process.exit(0); })
  .catch(e=>{ console.error('FAIL:', e.message); process.exit(1); });
