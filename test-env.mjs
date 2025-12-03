// Quick test to verify env variable access
console.log('Testing .env.local loading...')
console.log('VITE_GMAIL_CLIENT_ID:', process.env.VITE_GMAIL_CLIENT_ID || 'NOT FOUND')
