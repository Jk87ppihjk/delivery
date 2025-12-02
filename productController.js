// productController.js (FINAL E CORRIGIDO)

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
// Requer autenticação e permissão de 'gerente' ou superior.
// ====================================================================
productRouter.post('/', 
    authMiddleware, 
    checkPermission('gerente'), 
    upload.array('imagens', 10), // Usa Multer para o campo 'imagens', até 10 arquivos
    async (req, res) => {

    // Dados de texto vêm em req.body
    const { nome, descricao, preco, categoria } = req.body;
    
    // CORREÇÃO CRÍTICA: Converte a string 'true'/'false' em um booleano JavaScript.
    const disponivelBoolean = req.body.disponivel === 'true'; 

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
        // Usa disponivelBoolean na lista de parâmetros
        const productParams = [nome, descricao || null, precoNumerico, categoria || null, disponivelBoolean, created_by];
        
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
// B1. Rota: LER/LISTAR Produtos para o Catálogo (Público)
// * Rota pública que lista apenas produtos DISPONÍVEIS.
// ====================================================================
productRouter.get('/', 
    // ROTA PÚBLICA: Sem middleware de autenticação
    async (req, res) => {

    try {
        // Query para selecionar APENAS produtos que estão disponíveis e agrega todas as imagens
        const sql = `
            SELECT 
                p.*, 
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('url', ip.url, 'is_main', ip.is_main)) FROM ${ITEMS_TABLE} ip WHERE ip.produto_id = p.id) AS imagens_json
            FROM ${TABLE} p
            WHERE p.disponivel = TRUE 
            ORDER BY p.id DESC
        `;
        const result = await db.query(sql);

        // Mapeamento para processar o JSON das imagens (necessário porque o resultado é uma string JSON)
        const produtos = result.rows.map(produto => {
            try {
                // Converte a string JSON em um array de objetos de imagem
                produto.imagens = produto.imagens_json ? JSON.parse(produto.imagens_json) : [];
            } catch (e) {
                produto.imagens = [];
            }
            delete produto.imagens_json;
            // Adiciona imagem_principal para compatibilidade com o resto do código, se necessário
            produto.imagem_principal = produto.imagens.find(img => img.is_main)?.url || null;
            return produto;
        });

        return res.status(200).json({ 
            message: 'Lista de produtos para o catálogo retornada com sucesso.',
            produtos: produtos // Retorna a lista de produtos processada
        });

    } catch (error) {
        console.error('Erro ao listar produtos (catálogo):', error);
        return res.status(500).json({ message: 'Erro interno ao buscar produtos.' });
    }
});


// ====================================================================
// B2. Rota: LER/LISTAR Todos os Produtos para o Admin (Gerenciamento)
// * Mostra TODOS os produtos, disponíveis ou não.
// ====================================================================
productRouter.get('/admin', 
    authMiddleware,             
    checkPermission('funcionario'), 
    async (req, res) => {

    try {
        // Query para selecionar TODOS os produtos, independente do status 'disponivel'
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
    // Middleware para tentar autenticar como comprador ou admin
    (req, res, next) => {
        const authHeader = req.headers.authorization;
        const isAdmin = authHeader && authHeader.includes('adminToken'); // Assumindo padrão de token/uso
        
        if (authHeader && isAdmin) {
            return authMiddleware(req, res, next);
        }
        if (authHeader && !isAdmin) {
            return compradorAuthMiddleware(req, res, next);
        }
        
        // Se não houver token, permite continuar (Pode ser ajustado se o produto for 100% público)
        next(); 
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
        // Adicionando tratamento para JSON nulo/falho
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
// Requer autenticação e permissão de 'gerente' ou superior.
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
    if (disponivel !== undefined) { 
        // Conversão de string 'true'/'false' para booleano aqui também
        const disponivelBoolean = disponivel === 'true' || disponivel === true;
        updates.push('disponivel = ?');
        params.push(disponivelBoolean); 
    }

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

        // A exclusão em cascata deve cuidar das imagens em 'imagens_produto'

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
