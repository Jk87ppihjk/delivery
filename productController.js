// productController.js (Corrigido para Admin Auth)

require('dotenv').config();
const express = require('express');
const { db } = require('./db');
// Importa as funções de upload e os middlewares
const { upload, uploadToCloudinary } = require('./upload'); 
const { authMiddleware, checkPermission } = require('./adminAuth'); 
// O compradorAuthMiddleware não é mais necessário nesta rota
// const { compradorAuthMiddleware } = require('./compradorAuth'); 

const productRouter = express.Router();
const TABLE = 'produtos';
const ITEMS_TABLE = 'imagens_produto';

// ====================================================================
// A. Rota: CRIAR Produto (COM UPLOAD DE MÚLTIPLAS IMAGENS)
// Requer autenticação e permissão de 'gerente' ou superior.
// ====================================================================
productRouter.post('/', 
    authMiddleware, 
    checkPermission('gerente'), 
    upload.array('imagens', 10), // Usa Multer para o campo 'imagens', até 10 arquivos
    async (req, res) => {

    // Dados de texto vêm em req.body
    const { nome, descricao, preco, categoria, disponivel = true } = req.body;
    const created_by = req.user.id;
    const files = req.files; // Arquivos enviados (buffers)

    if (!nome || !preco) {
        return res.status(400).json({ message: 'Nome e Preço são campos obrigatórios.' });
    }
    
    let connection;
    try {
        // 1. Validação
        const precoNumerico = parseFloat(preco);
        if (isNaN(precoNumerico)) {
             return res.status(400).json({ message: 'Preço deve ser um valor numérico.' });
        }
        
        connection = await db.getConnection();
        await connection.query('START TRANSACTION');

        // 2. Criação do Produto Principal
        const productSql = `
            INSERT INTO ${TABLE} (nome, descricao, preco, categoria, disponivel, created_by) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const productParams = [nome, descricao || null, precoNumerico, categoria || null, disponivel, created_by];
        
        const [productResult] = await connection.execute(productSql, productParams);
        const newProductId = productResult.insertId;

        // 3. Upload e Inserção das Imagens
        if (files && files.length > 0) {
            // Executa o upload de todos os arquivos em paralelo
            const uploadPromises = files.map(file => uploadToCloudinary(file));
            const imageResults = await Promise.all(uploadPromises);

            for (let i = 0; i < imageResults.length; i++) {
                const img = imageResults[i];
                const is_main = i === 0; // Define a primeira imagem como principal
                
                const imgSql = `
                    INSERT INTO ${ITEMS_TABLE} (produto_id, url, public_id, is_main)
                    VALUES (?, ?, ?, ?)
                `;
                await connection.execute(imgSql, [newProductId, img.secure_url, img.public_id, is_main]);
            }
        }

        await connection.query('COMMIT'); // Finaliza a transação

        return res.status(201).json({ 
            message: 'Produto e imagens criados com sucesso!',
            produto: { id: newProductId, nome, preco: precoNumerico, imagens_count: files.length }
        });

    } catch (error) {
        if (connection) await connection.query('ROLLBACK');
        console.error('Erro ao criar produto e imagens:', error);
        
        // Trata erros específicos do Multer/Validação
        if (error.message.includes('Apenas arquivos') || error.message.includes('too large') || error.message.includes('files')) {
            return res.status(400).json({ message: error.message });
        }
        
        return res.status(500).json({ message: 'Erro interno ao salvar o produto e imagens.' });
    } finally {
        if (connection) connection.release();
    }
});


// ====================================================================
// B. Rota: LER/LISTAR Todos os Produtos (CORRIGIDO PARA ADMIN)
// Agora requer autenticação de Admin (Funcionário ou superior).
// ====================================================================
productRouter.get('/', 
    authMiddleware,             // 1. Garante que o token é válido e popula req.user (incluindo a 'role')
    checkPermission('funcionario'), // 2. Garante que o usuário tem pelo menos a role 'funcionario'
    async (req, res) => {

    try {
        // Query para selecionar todos os produtos e a URL da imagem principal
        const sql = `
            SELECT 
                p.*, 
                a.nome AS nome_criador,
                (SELECT url FROM ${ITEMS_TABLE} WHERE produto_id = p.id AND is_main = TRUE LIMIT 1) AS imagem_principal
            FROM ${TABLE} p
            LEFT JOIN administradores a ON p.created_by = a.id
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
// ====================================================================
productRouter.get('/:id', 
    authMiddleware, // Acesso restrito a admins no painel (pode ser ajustado para compradorAuthMiddleware)
    async (req, res) => {
    
    const productId = req.params.id;

    try {
        // Busca o produto e TODAS as imagens
        const sql = `
            SELECT 
                p.*, 
                a.nome AS nome_criador,
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('url', ip.url, 'is_main', ip.is_main)) FROM ${ITEMS_TABLE} ip WHERE ip.produto_id = p.id) AS imagens_json
            FROM ${TABLE} p
            JOIN administradores a ON p.created_by = a.id
            WHERE p.id = ?
        `;
        const result = await db.query(sql, [productId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Produto não encontrado.' });
        }
        
        const produto = result.rows[0];
        produto.imagens = JSON.parse(produto.imagens_json); // Converte o JSON string em objeto
        delete produto.imagens_json;

        return res.status(200).json({ produto });

    } catch (error) {
        console.error('Erro ao buscar produto por ID:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar o produto.' });
    }
});


// ====================================================================
// D. Rota: ATUALIZAR Produto (PUT)
// Requer autenticação e permissão de 'gerente' ou superior.
// ATENÇÃO: Esta rota só atualiza os campos de texto. O gerenciamento de imagens é separado.
// ====================================================================
productRouter.put('/:id', 
    authMiddleware, 
    checkPermission('gerente'), 
    async (req, res) => {
    
    const productId = req.params.id;
    const { nome, descricao, preco, categoria, disponivel } = req.body;
    
    // Constrói a query dinamicamente
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
// Requer autenticação e permissão de 'gerente' ou superior.
// ATENÇÃO: Em produção, o DELETE deve limpar as imagens no Cloudinary.
// ====================================================================
productRouter.delete('/:id', 
    authMiddleware, 
    checkPermission('gerente'), 
    async (req, res) => {
    
    const productId = req.params.id;
    let connection;

    try {
        // Em um cenário real, aqui você buscaria os public_ids das imagens
        // e usaria o SDK do Cloudinary para deletá-las antes de deletar do DB.
        
        connection = await db.getConnection();
        await connection.query('START TRANSACTION');

        // O ON DELETE CASCADE na tabela imagens_produto deve limpar as imagens
        // automaticamente, mas deletar no Cloudinary é manual.

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
