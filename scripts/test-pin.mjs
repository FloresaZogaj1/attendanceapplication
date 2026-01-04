import bcrypt from "bcrypt";

const [plainArg, hashArg] = process.argv.slice(2);
const plain = plainArg || process.env.TEST_PIN_PLAIN;
const hash = hashArg || process.env.TEST_PIN_HASH;

if (!plain || !hash) {
  console.log("Usage: node scripts/test-pin.mjs <plain> <hash>");
  console.log("Or set TEST_PIN_PLAIN and TEST_PIN_HASH environment variables.");
  process.exit(1);
}

const ok = await bcrypt.compare(plain, hash);
console.log("Match:", ok);
