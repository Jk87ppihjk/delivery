// adminAuth.js

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('./db'); // Importa a conexão de banco de dados

const adminRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const TABLE = 'administradores'; // Tabela diferente para admins

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Garante que o usuário tem a role de administrador
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: 'Permissão negada. Requer acesso de administrador.' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
};

// 1. Rota de CADASTRO (Normalmente o cadastro admin é restrito ou manual)
adminRouter.post('/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;
    
    // ATENÇÃO: Em produção, o cadastro de admin não deve ser público!
    // Esta rota deve ser protegida ou removida após o primeiro admin ser criado.

    if (!nome || !email || !senha) {
        return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(senha, saltRounds);

        const sql = `INSERT INTO ${TABLE} (nome, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nome, email`;
        const result = await db.query(sql, [nome, email, passwordHash]);

        const newUser = result.rows[0];

        return res.status(201).json({ 
            message: 'Cadastro de administrador realizado com sucesso!',
            admin: { id: newUser.id, nome: newUser.nome, email: newUser.email }
        });

    } catch (error) {
        if (error.message.includes('duplicate key')) {
            return res.status(409).json({ message: 'Email já cadastrado.' });
        }
        console.error('Erro no cadastro do administrador:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});

// 2. Rota de LOGIN
adminRouter.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
    }

    try {
        const sql = `SELECT id, nome, email, password_hash FROM ${TABLE} WHERE email = $1`;
        const result = await db.query(sql, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const admin = result.rows[0];

        const match = await bcrypt.compare(senha, admin.password_hash);

        if (!match) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        // 3. Gerar Token JWT com a role 'admin'
        const token = jwt.sign(
            { id: admin.id, email: admin.email, role: 'admin' }, // IMPORTANTE: role = 'admin'
            JWT_SECRET, 
            { expiresIn: '1h' } // Token Admin é bom ser mais curto
        );

        return res.status(200).json({ 
            message: 'Login de administrador bem-sucedido.', 
            token,
            admin: { id: admin.id, nome: admin.nome, email: admin.email }
        });

    } catch (error) {
        console.error('Erro no login do administrador:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});

// 3. Exemplo de Rota Protegida (Dashboard)
adminRouter.get('/dashboard', authMiddleware, (req, res) => {
    // Acesso só é concedido se o token for válido e a role for 'admin'
    res.status(200).json({ 
        message: 'Acesso ao Dashboard Admin concedido.', 
        usuario: req.user,
        dados_sensíveis: 'Dados de vendas, usuários, etc.'
    });
});


module.exports = { adminRouter, adminAuthMiddleware: authMiddleware };
