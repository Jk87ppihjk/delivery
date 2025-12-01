// productController.js (Corrigido com Rotas Separadas para Admin e Público)

require('dotenv').config();
const express = require('express');
const { db } = require('./db');
// Importa as funções de upload e os middlewares
const { upload, uploadToCloudinary } = require('./upload'); 
const { authMiddleware, checkPermission } = require('./adminAuth'); 
const { compradorAuthMiddleware } = require('./compradorAuth'); 

const productRouter = express.Router();
const TABLE = 'produtos';
const ITEMS_TABLE = 'imagens_produto';

// ====================================================================
// A. Rota: CRIAR Produto (COM UPLOAD DE MÚLTIPLAS IMAGENS)
// ====================================================================
productRouter.post('/', 
    authMiddleware, 
    checkPermission('gerente'), 
    upload.array('imagens', 10), 
    async (req, res) => {

    const { nome, descricao, preco, categoria, disponivel = true } = req.body;
    const created_by = req.user.id;
    const files = req.files; 

    if (!nome || !preco) {
        return res.status(400).json({ message: 'Nome e Preço são campos obrigatórios.' });
    }
    
    let connection;
    try {
        const precoNumerico = parseFloat(preco);
        if (isNaN(precoNumerico)) {
             return res.status(400).json({ message: 'Preço deve ser um valor numérico.' });
        }
        
        connection = await db.getConnection();
        await connection.query('START TRANSACTION');

        const productSql = `
            INSERT INTO ${TABLE} (nome, descricao, preco, categoria, disponivel, created_by) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const productParams = [nome, descricao || null, precoNumerico, categoria || null, disponivel, created_by];
        
        const [productResult] = await connection.execute(productSql, productParams);
        const newProductId = productResult.insertId;

        if (files && files.length > 0) {
            const uploadPromises = files.map(file => uploadToCloudinary(file));
            const imageResults = await Promise.all(uploadPromises);

            for (let i = 0; i < imageResults.length; i++) {
                const img = imageResults[i];
                const is_main = i === 0; 
                
                const imgSql = `
                    INSERT INTO ${ITEMS_TABLE} (produto_id, url, public_id, is_main)
                    VALUES (?, ?, ?, ?)
                `;
                await connection.execute(imgSql, [newProductId, img.secure_url, img.public_id, is_main]);
            }
        }

        await connection.query('COMMIT'); 

        return res.status(201).json({ 
            message: 'Produto e imagens criados com sucesso!',
            produto: { id: newProductId, nome, preco: precoNumerico, imagens_count: files.length }
        });

    } catch (error) {
        if (connection) await connection.query('ROLLBACK');
        console.error('Erro ao criar produto e imagens:', error);
        
        if (error.message.includes('Apenas arquivos') || error.message.includes('too large') || error.message.includes('files')) {
            return res.status(400).json({ message: error.message });
        }
        
        return res.status(500).json({ message: 'Erro interno ao salvar o produto e imagens.' });
    } finally {
        if (connection) connection.release();
    }
});


// ====================================================================
// B1. Rota: LER/LISTAR Produtos para o Catálogo (Público)
// * Esta é a rota que a página inicial (index.html) deve chamar.
// * Filtra por DISPONÍVEL = TRUE.
// ====================================================================
productRouter.get('/', 
    // ROTA PÚBLICA: Sem middleware de autenticação
    async (req, res) => {

    try {
        const sql = `
            SELECT 
                p.*, 
                (SELECT url FROM ${ITEMS_TABLE} WHERE produto_id = p.id AND is_main = TRUE LIMIT 1) AS imagem_principal
            FROM ${TABLE} p
            WHERE p.disponivel = TRUE 
            ORDER BY p.id DESC
        `;
        const result = await db.query(sql);

        return res.status(200).json({ 
            message: 'Lista de produtos para o catálogo retornada com sucesso.',
            produtos: result.rows
        });

    } catch (error) {
        console.error('Erro ao listar produtos (catálogo):', error);
        return res.status(500).json({ message: 'Erro interno ao buscar produtos.' });
    }
});


// ====================================================================
// B2. Rota: LER/LISTAR Todos os Produtos para o Admin (Gerenciamento)
// * Esta é a rota que o painel 'admin_products.html' deve chamar.
// * Mostra TODOS os produtos, disponíveis ou não.
// ====================================================================
productRouter.get('/admin', 
    authMiddleware,             
    checkPermission('funcionario'), 
    async (req, res) => {

    try {
        const sql = `
            SELECT 
                p.*, 
                a.nome AS nome_criador,
                (SELECT url FROM ${ITEMS_TABLE} WHERE produto_id = p.id AND is_main = TRUE LIMIT 1) AS imagem_principal
            FROM ${TABLE} p
            LEFT JOIN administradores a ON p.created_by = a.id
            ORDER BY p.id DESC
        `;
        const result = await db.query(sql);

        return res.status(200).json({ 
            message: 'Lista completa de produtos para o administrador.',
            produtos: result.rows
        });

    } catch (error) {
        console.error('Erro ao listar produtos (admin):', error);
        return res.status(500).json({ message: 'Erro interno ao buscar produtos.' });
    }
});


// ====================================================================
// C. Rota: LER Produto por ID
// ====================================================================
productRouter.get('/:id', 
    // Pode ser protegido por compradorAuthMiddleware ou AdminAuthMiddleware
    (req, res, next) => {
        const isPublicCall = req.headers.authorization && !req.headers.authorization.includes('adminToken');
        if (isPublicCall) {
            return compradorAuthMiddleware(req, res, next);
        }
        return authMiddleware(req, res, next); // Assume-se que o admin está buscando detalhes
    },
    async (req, res) => {
    
    const productId = req.params.id;

    try {
        const sql = `
            SELECT 
                p.*, 
                a.nome AS nome_criador,
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('url', ip.url, 'is_main', ip.is_main)) FROM ${ITEMS_TABLE} ip WHERE ip.produto_id = p.id) AS imagens_json
            FROM ${TABLE} p
            LEFT JOIN administradores a ON p.created_by = a.id
            WHERE p.id = ?
        `;
        const result = await db.query(sql, [productId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Produto não encontrado.' });
        }
        
        const produto = result.rows[0];
        // JSON.parse pode falhar se o resultado for NULL.
        try {
            produto.imagens = produto.imagens_json ? JSON.parse(produto.imagens_json) : [];
        } catch (e) {
            produto.imagens = [];
        }
        delete produto.imagens_json;

        return res.status(200).json({ produto });

    } catch (error) {
        console.error('Erro ao buscar produto por ID:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar o produto.' });
    }
});


// ====================================================================
// D. Rota: ATUALIZAR Produto (PUT)
// ====================================================================
productRouter.put('/:id', 
    authMiddleware, 
    checkPermission('gerente'), 
    async (req, res) => {
    
    const productId = req.params.id;
    const { nome, descricao, preco, categoria, disponivel } = req.body;
    
    let updates = [];
    let params = [];

    if (nome !== undefined) { updates.push('nome = ?'); params.push(nome); }
    if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
    if (preco !== undefined) { 
        const precoNumerico = parseFloat(preco);
        if (isNaN(precoNumerico)) { return res.status(400).json({ message: 'Preço deve ser um valor numérico.' }); }
        updates.push('preco = ?');
        params.push(precoNumerico);
    }
    if (categoria !== undefined) { updates.push('categoria = ?'); params.push(categoria); }
    if (disponivel !== undefined) { updates.push('disponivel = ?'); params.push(disponivel); }

    if (updates.length === 0) {
        return res.status(400).json({ message: 'Nenhum campo para atualizar fornecido.' });
    }
    
    params.push(productId);

    try {
        const sql = `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE id = ?`;
        
        const [result] = await db.query(sql, params);

        if (result.affectedRows === 0) {
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
// ====================================================================
productRouter.delete('/:id', 
    authMiddleware, 
    checkPermission('gerente'), 
    async (req, res) => {
    
    const productId = req.params.id;
    let connection;

    try {
        
        connection = await db.getConnection();
        await connection.query('START TRANSACTION');

        const deleteSql = `DELETE FROM ${TABLE} WHERE id = ?`;
        const [deleteResult] = await connection.execute(deleteSql, [productId]);

        if (deleteResult.affectedRows === 0) {
            await connection.query('ROLLBACK');
            return res.status(404).json({ message: 'Produto não encontrado para exclusão.' });
        }
        
        await connection.query('COMMIT');
        return res.status(200).json({ message: 'Produto excluído com sucesso (e imagens associadas no DB).' });

    } catch (error) {
        if (connection) await connection.query('ROLLBACK');
        console.error('Erro ao excluir produto:', error);
        return res.status(500).json({ message: 'Erro interno ao excluir o produto.' });
    } finally {
        if (connection) connection.release();
    }
});


module.exports = { productRouter };
