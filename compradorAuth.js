// compradorAuth.js

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('./db'); // Importa a conexão de banco de dados

const compradorRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const TABLE = 'compradores';

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        // Verifica o token usando o JWT_SECRET
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Anexa os dados do usuário à requisição
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
};

// 1. Rota de CADASTRO
compradorRouter.post('/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
    }

    try {
        // 1. Hashing da Senha
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(senha, saltRounds);

        // 2. Inserir no Banco de Dados
        const sql = `INSERT INTO ${TABLE} (nome, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nome, email`;
        // OBS: AJUSTE O SQL CONFORME SEU DB (Ex: '?' para MySQL)
        const result = await db.query(sql, [nome, email, passwordHash]);

        // Assumindo que a query retorna o novo usuário
        const newUser = result.rows[0]; 

        return res.status(201).json({ 
            message: 'Cadastro de comprador realizado com sucesso!',
            comprador: { id: newUser.id, nome: newUser.nome, email: newUser.email }
        });

    } catch (error) {
        // Erro de duplicação de email (a ser implementado no db.js)
        if (error.message.includes('duplicate key')) {
            return res.status(409).json({ message: 'Email já cadastrado.' });
        }
        console.error('Erro no cadastro do comprador:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});

// 2. Rota de LOGIN
compradorRouter.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
    }

    try {
        // 1. Buscar usuário por email
        const sql = `SELECT id, nome, email, password_hash FROM ${TABLE} WHERE email = $1`;
        const result = await db.query(sql, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const comprador = result.rows[0];

        // 2. Comparar Senha
        const match = await bcrypt.compare(senha, comprador.password_hash);

        if (!match) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        // 3. Gerar Token JWT
        const token = jwt.sign(
            { id: comprador.id, email: comprador.email, role: 'comprador' }, 
            JWT_SECRET, 
            { expiresIn: '1d' } // Expira em 1 dia
        );

        return res.status(200).json({ 
            message: 'Login de comprador bem-sucedido.', 
            token,
            comprador: { id: comprador.id, nome: comprador.nome, email: comprador.email }
        });

    } catch (error) {
        console.error('Erro no login do comprador:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});

// 3. Exemplo de Rota Protegida (Perfil)
compradorRouter.get('/perfil', authMiddleware, (req, res) => {
    // req.user contém os dados decodificados do token (id, email, role)
    res.status(200).json({ 
        message: 'Acesso ao perfil de comprador concedido.', 
        usuario: req.user 
    });
});


module.exports = { compradorRouter, compradorAuthMiddleware: authMiddleware };
