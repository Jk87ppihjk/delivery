// compradorAuth.js

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('./db'); // Importa a conexão de banco de dados

const compradorRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const TABLE = 'compradores';

// ====================================================================
// I. MIDDLEWARE DE AUTENTICAÇÃO DO COMPRADOR
// ====================================================================

/**
 * Middleware para verificar o token JWT e autenticar o usuário comprador.
 * Anexa os dados do usuário (id, email) em req.user.
 */
const compradorAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        // Verifica o token usando o JWT_SECRET
        const decoded = jwt.verify(token, JWT_SECRET);
        // Garante que o usuário é um comprador (se precisar diferenciar de admin no futuro)
        if (decoded.role !== 'comprador') {
             return res.status(403).json({ message: 'Token inválido para esta rota (Não é um comprador).' });
        }
        
        req.user = decoded; // Anexa os dados do usuário à requisição
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
};

// ====================================================================
// II. ROTAS DE AUTENTICAÇÃO
// ====================================================================

/**
 * @route POST /api/comprador/cadastro
 * Realiza o cadastro de um novo usuário comprador.
 */
compradorRouter.post('/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ message: 'Nome, email e senha são obrigatórios.' });
    }

    try {
        // 1. Hashing da Senha
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(senha, saltRounds);

        // 2. Inserir no Banco de Dados (Sintaxe MySQL: usa '?')
        const sql = `INSERT INTO ${TABLE} (nome, email, password_hash) VALUES (?, ?, ?)`;
        const result = await db.query(sql, [nome, email, passwordHash]);

        const newCompradorId = result.rows.insertId;
        
        // 3. Gerar Token de Login após o cadastro (experiência de usuário)
        const token = jwt.sign(
            { id: newCompradorId, email: email, role: 'comprador' }, 
            JWT_SECRET, 
            { expiresIn: '7d' } // Token de comprador pode ser mais longo
        );

        return res.status(201).json({ 
            message: 'Cadastro de comprador realizado com sucesso e login efetuado.',
            token,
            comprador: { id: newCompradorId, nome: nome, email: email }
        });

    } catch (error) {
        // Trata erro de email duplicado (ER_DUP_ENTRY é o código MySQL)
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Este email já está cadastrado.' });
        }
        console.error('Erro no cadastro do comprador:', error);
        return res.status(500).json({ message: 'Erro interno no servidor ao cadastrar.' });
    }
});

/**
 * @route POST /api/comprador/login
 * Realiza o login de um usuário comprador.
 */
compradorRouter.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
    }

    try {
        // 1. Buscar usuário por email
        const sql = `SELECT id, nome, email, password_hash FROM ${TABLE} WHERE email = ?`;
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
            { expiresIn: '7d' }
        );

        return res.status(200).json({ 
            message: 'Login bem-sucedido.', 
            token,
            comprador: { id: comprador.id, nome: comprador.nome, email: comprador.email }
        });

    } catch (error) {
        console.error('Erro no login do comprador:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});


// ====================================================================
// III. ROTAS PROTEGIDAS (Exemplo: Perfil)
// ====================================================================

/**
 * @route GET /api/comprador/perfil
 * Retorna os dados do perfil do comprador logado.
 */
compradorRouter.get('/perfil', compradorAuthMiddleware, async (req, res) => {
    // req.user já foi preenchido pelo middleware
    const comprador_id = req.user.id;
    
    try {
        const sql = `SELECT id, nome, email, created_at FROM ${TABLE} WHERE id = ?`;
        const result = await db.query(sql, [comprador_id]);

        if (result.rows.length === 0) {
             // Teoricamente impossível, já que o token é válido
             return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        return res.status(200).json({ 
            message: 'Dados do perfil do comprador.',
            perfil: result.rows[0]
        });

    } catch (error) {
        console.error('Erro ao buscar perfil:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar perfil.' });
    }
});


module.exports = { compradorRouter, compradorAuthMiddleware };
