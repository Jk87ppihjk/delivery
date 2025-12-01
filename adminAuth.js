// adminAuth.js (CORRIGIDO E COMPLETO)

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('./db'); // Importa a conexão de banco de dados

const adminRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const TABLE = 'administradores';

// --- HIERARQUIA DE CARGOS (RBAC) ---
const roleHierarchy = {
    'dono': 3,
    'gerente': 2,
    'funcionario': 1
};

// ====================================================================
// I. MIDDLEWARES DE AUTENTICAÇÃO E PERMISSÃO
// ====================================================================

/**
 * Middleware para verificar o token JWT e autenticar o usuário.
 * Anexa os dados do usuário (id, email, role) em req.user.
 */
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; 
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
};

/**
 * Função geradora de Middleware para verificar a permissão (role) necessária.
 * @param {string} requiredRole - O cargo mínimo necessário ('dono', 'gerente', 'funcionario').
 */
const checkPermission = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({ message: 'Permissão negada. Informações de cargo ausentes.' });
        }
        
        const userRole = req.user.role;
        
        // Verifica se o nível do usuário é suficiente
        if (roleHierarchy[userRole] >= roleHierarchy[requiredRole]) {
            next();
        } else {
            return res.status(403).json({ message: `Acesso negado. Requer cargo de ${requiredRole} ou superior.` });
        }
    };
};


// ====================================================================
// II. ROTAS DE AUTENTICAÇÃO
// ====================================================================

/**
 * @route POST /api/admin/login
 * Realiza o login, buscando o nome e a role.
 */
adminRouter.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
    }

    try {
        // Buscar todos os dados relevantes
        const sql = `SELECT id, nome, email, password_hash, role FROM ${TABLE} WHERE email = ?`;
        const result = await db.query(sql, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const admin = result.rows[0];

        // Comparar Senha
        const match = await bcrypt.compare(senha, admin.password_hash);

        if (!match) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        // Gerar Token JWT (Incluindo nome e role)
        const token = jwt.sign(
            { id: admin.id, email: admin.email, role: admin.role, nome: admin.nome }, 
            JWT_SECRET, 
            { expiresIn: '1h' } 
        );

        return res.status(200).json({ 
            message: `Login bem-sucedido como ${admin.role}.`, 
            token,
            admin: { id: admin.id, nome: admin.nome, email: admin.email, role: admin.role }
        });

    } catch (error) {
        console.error('Erro no login do administrador:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});


// ====================================================================
// III. ROTAS DE GERENCIAMENTO DE FUNCIONÁRIOS (RBAC)
// ====================================================================

/**
 * @route POST /api/admin/novo-funcionario
 * Cria novo funcionário/admin. Requer 'gerente' ou 'dono'.
 */
adminRouter.post('/novo-funcionario', 
    authMiddleware, 
    checkPermission('gerente'), 
    async (req, res) => {
    
    const { nome, email, senha, role = 'funcionario' } = req.body; 

    // Regras de segurança de cargo
    if (role === 'dono' && req.user.role !== 'dono') {
        return res.status(403).json({ message: 'Apenas o Dono Mestre pode criar outra conta Dono.' });
    }
    if (req.user.role === 'gerente' && roleHierarchy[role] > roleHierarchy['funcionario']) {
        return res.status(403).json({ message: 'Gerentes só podem criar funcionários.' });
    }

    if (!nome || !email || !senha) {
        return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(senha, saltRounds);

        const sql = `INSERT INTO ${TABLE} (nome, email, password_hash, role) VALUES (?, ?, ?, ?)`;
        const result = await db.query(sql, [nome, email, passwordHash, role]);

        const newAdminId = result.rows.insertId;

        return res.status(201).json({ 
            message: `Funcionário/Admin (${role}) criado com sucesso!`,
            admin: { id: newAdminId, nome, email, role }
        });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') { 
            return res.status(409).json({ message: 'Email já cadastrado.' });
        }
        console.error('Erro ao criar novo funcionário:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});


/**
 * @route DELETE /api/admin/funcionario/:id
 * Exclui um funcionário pelo ID. Requer 'dono'.
 */
adminRouter.delete('/funcionario/:id', 
    authMiddleware, 
    checkPermission('dono'), 
    async (req, res) => {
    
    const adminIdToDelete = parseInt(req.params.id);

    // Prevenção: Dono não pode excluir a si mesmo.
    if (adminIdToDelete === req.user.id) {
        return res.status(403).json({ message: 'O Dono Mestre não pode excluir a própria conta desta forma.' });
    }

    try {
        // Verifica se o admin a ser excluído é outro Dono
        const checkSql = `SELECT role FROM ${TABLE} WHERE id = ?`;
        const result = await db.query(checkSql, [adminIdToDelete]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Funcionário não encontrado.' });
        }

        if (result.rows[0].role === 'dono') {
            return res.status(403).json({ message: 'Você não tem permissão para excluir outra conta Dono Mestre.' });
        }

        const deleteSql = `DELETE FROM ${TABLE} WHERE id = ?`;
        const deleteResult = await db.query(deleteSql, [adminIdToDelete]);

        if (deleteResult.rows.affectedRows === 0) {
            return res.status(404).json({ message: 'Funcionário não encontrado ou já excluído.' });
        }

        return res.status(200).json({ message: 'Funcionário excluído com sucesso.' });

    } catch (error) {
        console.error('Erro ao excluir funcionário:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});


// ====================================================================
// IV. ROTAS DE TESTE PROTEGIDAS (CORREÇÃO APLICADA AQUI)
// ====================================================================

/**
 * @route GET /api/admin/dashboard
 * Rota que fornece os dados completos do usuário para o Dashboard.
 */
adminRouter.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        // Buscamos o nome completo no DB (caso o nome do JWT seja antigo ou incompleto)
        const sql = `SELECT nome FROM ${TABLE} WHERE id = ?`;
        const result = await db.query(sql, [req.user.id]);
        const nomeCompleto = result.rows.length > 0 ? result.rows[0].nome : req.user.email;
        
        // CORREÇÃO: Retorna o objeto completo 'usuario' conforme o frontend espera.
        return res.status(200).json({ 
            message: `Acesso ao Dashboard Admin concedido.`,
            role: req.user.role,
            usuario: {
                id: req.user.id,
                email: req.user.email,
                role: req.user.role,
                nome: nomeCompleto
            }
        });

    } catch (error) {
        console.error("Erro ao buscar nome completo do admin:", error);
        return res.status(500).json({ message: "Erro interno ao buscar dados do dashboard." });
    }
});

/**
 * @route GET /api/admin/relatorios-gerenciais
 * Acesso restrito a 'dono' ou 'gerente'.
 */
adminRouter.get('/relatorios-gerenciais', 
    authMiddleware, 
    checkPermission('gerente'), 
    (req, res) => {
    res.status(200).json({ 
        message: `Acesso a relatórios concedido!`,
        usuario: req.user,
        dados: 'Relatórios de Vendas, Lucro, etc.'
    });
});


module.exports = { adminRouter, authMiddleware, checkPermission };
