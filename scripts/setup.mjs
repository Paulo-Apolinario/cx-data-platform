import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { hashPassword } from '../server/security.mjs';
import * as v from '../server/validation.mjs';

const db = openDatabase(resolve(process.env.DATA_DIR || 'data'));
const rl = createInterface({ input: stdin, output: stdout });
try {
  if (db.prepare("SELECT id FROM users WHERE role='ENGINEER'").get()) {
    console.log('Engenheiro já cadastrado. Acesse o sistema com sua conta.');
  } else {
    console.log('Configure a conta do engenheiro. Nenhuma senha padrão é criada.');
    const name = v.text(await rl.question('Nome: '), 'Nome');
    const email = v.email(await rl.question('E-mail: '));
    console.log('A senha será exibida neste terminal. Faça a configuração em um local privado.');
    const password = v.password(await rl.question('Senha (12 a 128 caracteres): '));
    if (password !== await rl.question('Repita a senha: ')) throw new Error('As senhas não coincidem.');
    db.prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,'ENGINEER')").run(randomUUID(), name, email, hashPassword(password));
    console.log('Conta criada. Execute npm start e abra http://localhost:3000.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rl.close(); db.close(); }
