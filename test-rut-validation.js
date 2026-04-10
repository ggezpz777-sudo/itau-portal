// Test para validación de RUT y búsqueda de nombres

// Helper: Validar y extraer RUT limpio
function cleanRut(rut) {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  const parts = clean.split('');
  const number = parts.slice(0, -1).join('');
  const dv = parts[parts.length - 1];
  return { number, dv, full: clean };
}

// Helper: Validar dígito verificador del RUT
function isValidRut(rut) {
  try {
    const { number, dv } = cleanRut(rut);
    if (!number || number.length < 6 || !dv) return false;
    
    let sum = 0;
    let multiplier = 2;
    for (let i = number.length - 1; i >= 0; i--) {
      sum += parseInt(number[i]) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    const expectedDv = (11 - (sum % 11)) % 11;
    const expectedDvChar = expectedDv === 10 ? 'K' : expectedDv.toString();
    
    return dv === expectedDvChar;
  } catch (e) {
    return false;
  }
}

// Base de datos simulada
const CLIENTES_DB = {
  '20320316': 'Roberto González',
  '24012345': 'Juan Martínez',
  '15987654': 'María López',
  '18234567': 'Carlos Fernández',
  '21345678': 'Ana Silva',
};

// Test cases
const TEST_CASES = [
  { rut: '20.320.316-6', expected: true, name: 'Roberto González', desc: 'RUT válido en BD' },
  { rut: '24.012.345-K', expected: true, name: 'Juan Martínez', desc: 'RUT válido con K' },
  { rut: '15.987.654-9', expected: true, name: 'María López', desc: 'RUT válido' },
  { rut: '99.999.999-9', expected: false, name: null, desc: 'RUT inválido (mal DV)' },
  { rut: '12345678', expected: false, name: null, desc: 'RUT sin DV' },
  { rut: '20.320.316-K', expected: false, name: null, desc: 'RUT válido pero mal DV' },
];

console.log('🧪 PRUEBAS DE VALIDACIÓN DE RUT\n');

TEST_CASES.forEach((test, i) => {
  const isValid = isValidRut(test.rut);
  const { number } = cleanRut(test.rut);
  const nameFound = CLIENTES_DB[number] || null;
  
  const resultOk = isValid === test.expected;
  const nameOk = !test.name || nameFound === test.name;
  const status = resultOk && nameOk ? '✅' : '❌';
  
  console.log(`${status} Test ${i + 1}: ${test.desc}`);
  console.log(`   RUT: ${test.rut}`);
  console.log(`   Válido: ${isValid} (esperado: ${test.expected})`);
  console.log(`   Nombre: ${nameFound || '(no encontrado)'}\n`);
});

console.log('\n📊 Instrucciones para usar:');
console.log('1. Los RUTs válidos en la BD devolverán el nombre');
console.log('2. Los RUTs válidos pero NO en BD devolverán null (fallback a API)');
console.log('3. Los RUTs inválidos fallarán antes de buscar en BD');
