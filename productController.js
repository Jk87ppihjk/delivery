// productController.js

require('dotenv').config();
const express = require('express');
const { db } = require('./db');
const { authMiddleware, checkPermission } = require('./adminAuth'); // Importa middlewares de autenticação e permissão

const productRouter = express.Router();
const TABLE = 'produtos';

// ====================================================================
// A. Rota: CRIAR Produto
// Requer autenticação e permissão de 'gerente' ou superior.
// ====================================================================
productRouter.post('/', 
    authMiddleware, 
    checkPermission('gerente'), // Apenas Dono e Gerente podem criar
    async (req, res) => {

    const { nome, descricao, preco, categoria, disponivel = true } = req.body;
    const created_by = req.user.id; // Quem criou é o usuário logado

    if (!nome || !preco) {
        return res.status(400).json({ message: 'Nome e Preço são campos obrigatórios.' });
    }
    
    // Converte o preço para número, garantindo que o MySQL não tenha problemas
    const precoNumerico = parseFloat(preco);
    if (isNaN(precoNumerico)) {
         return res.status(400).json({ message: 'Preço deve ser um valor numérico.' });
    }


    try {
        const sql = `
            INSERT INTO ${TABLE} (nome, descricao, preco, categoria, disponivel, created_by) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const params = [nome, descricao || null, precoNumerico, categoria || null, disponivel, created_by];
        
        const result = await db.query(sql, params);

        const newProductId = result.rows.insertId;

        return res.status(201).json({ 
            message: 'Produto criado com sucesso!',
            produto: { id: newProductId, nome, preco: precoNumerico, created_by }
        });

    } catch (error) {
        console.error('Erro ao criar produto:', error);
        return res.status(500).json({ message: 'Erro interno ao salvar o produto.' });
    }
});


// ====================================================================
// B. Rota: LER/LISTAR Todos os Produtos (Público)
// Requer autenticação (mesmo o funcionário pode ver).
// Poderia ser pública, mas vamos mantê-la protegida para o Admin.
// ====================================================================
productRouter.get('/', 
    authMiddleware, 
    async (req, res) => { // Todos os admins (dono, gerente, funcionario) podem ler

    try {
        // Query para selecionar todos os produtos. Usamos um JOIN para obter o nome do criador.
        const sql = `
            SELECT p.*, a.nome AS nome_criador 
            FROM ${TABLE} p
            JOIN administradores a ON p.created_by = a.id
        `;
        const result = await db.query(sql);

        return res.status(200).json({ 
            message: 'Lista de produtos retornada com sucesso.',
            produtos: result.rows
        });

    } catch (error) {
        console.error('Erro ao listar produtos:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar produtos.' });
    }
});

// ====================================================================
// C. Rota: LER Produto por ID
// Requer autenticação.
// ====================================================================
productRouter.get('/:id', 
    authMiddleware, 
    async (req, res) => {
    
    const productId = req.params.id;

    try {
        const sql = `
            SELECT p.*, a.nome AS nome_criador 
            FROM ${TABLE} p
            JOIN administradores a ON p.created_by = a.id
            WHERE p.id = ?
        `;
        const result = await db.query(sql, [productId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Produto não encontrado.' });
        }

        return res.status(200).json({ produto: result.rows[0] });

    } catch (error) {
        console.error('Erro ao buscar produto por ID:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar o produto.' });
    }
});


// ====================================================================
// D. Rota: ATUALIZAR Produto
// Requer autenticação e permissão de 'gerente' ou superior.
// ====================================================================
productRouter.put('/:id', 
    authMiddleware, 
    checkPermission('gerente'), // Apenas Dono e Gerente podem editar
    async (req, res) => {
    
    const productId = req.params.id;
    const { nome, descricao, preco, categoria, disponivel } = req.body;
    
    // Constrói a query dinamicamente
    let updates = [];
    let params = [];

    if (nome !== undefined) {
        updates.push('nome = ?');
        params.push(nome);
    }
    if (descricao !== undefined) {
        updates.push('descricao = ?');
        params.push(descricao);
    }
    if (preco !== undefined) {
        const precoNumerico = parseFloat(preco);
        if (isNaN(precoNumerico)) {
             return res.status(400).json({ message: 'Preço deve ser um valor numérico.' });
        }
        updates.push('preco = ?');
        params.push(precoNumerico);
    }
    if (categoria !== undefined) {
        updates.push('categoria = ?');
        params.push(categoria);
    }
    if (disponivel !== undefined) {
        updates.push('disponivel = ?');
        params.push(disponivel);
    }

    if (updates.length === 0) {
        return res.status(400).json({ message: 'Nenhum campo para atualizar fornecido.' });
    }
    
    // Adiciona o ID do produto como último parâmetro
    params.push(productId);

    try {
        const sql = `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE id = ?`;
        
        const result = await db.query(sql, params);

        if (result.rows.affectedRows === 0) {
            return res.status(404).json({ message: 'Produto não encontrado para atualização.' });
        }

        return res.status(200).json({ message: 'Produto atualizado com sucesso.' });

    } catch (error) {
        console.error('Erro ao atualizar produto:', error);
        return res.status(500).json({ message: 'Erro interno ao atualizar o produto.' });
    }
});


// ====================================================================
// E. Rota: DELETAR Produto
// Requer autenticação e permissão de 'gerente' ou superior.
// ====================================================================
productRouter.delete('/:id', 
    authMiddleware, 
    checkPermission('gerente'), // Apenas Dono e Gerente podem excluir
    async (req, res) => {
    
    const productId = req.params.id;

    try {
        const sql = `DELETE FROM ${TABLE} WHERE id = ?`;
        const result = await db.query(sql, [productId]);

        if (result.rows.affectedRows === 0) {
            return res.status(404).json({ message: 'Produto não encontrado para exclusão.' });
        }

        return res.status(200).json({ message: 'Produto excluído com sucesso.' });

    } catch (error) {
        console.error('Erro ao excluir produto:', error);
        return res.status(500).json({ message: 'Erro interno ao excluir o produto.' });
    }
});


module.exports = { productRouter };
