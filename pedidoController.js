// pedidoController.js

require('dotenv').config();
const express = require('express');
const { db } = require('./db');

// Assumindo que você tem um middleware para autenticar compradores
const { compradorAuthMiddleware } = require('./compradorAuth'); 
// Assumindo que você tem os middlewares admin
const { authMiddleware: adminAuthMiddleware, checkPermission } = require('./adminAuth'); 

const pedidoRouter = express.Router();
const TABLE = 'pedidos';
const ITEMS_TABLE = 'itens_pedido';

// ====================================================================
// I. ROTA DO COMPRADOR: CRIAR NOVO PEDIDO
// ====================================================================
/**
 * @route POST /api/pedidos
 * Cria um novo pedido. Requer autenticação do comprador.
 * O corpo da requisição deve conter o 'endereco' e um array de 'itens'.
 */
pedidoRouter.post('/', compradorAuthMiddleware, async (req, res) => {
    const comprador_id = req.user.id; // ID do comprador vem do token
    const { endereco, itens } = req.body; // 'itens' é um array de { produto_id, quantidade }

    if (!endereco || !itens || itens.length === 0) {
        return res.status(400).json({ message: 'Endereço e itens do pedido são obrigatórios.' });
    }

    let connection;
    try {
        // Inicia Transação para garantir consistência (ou cria tudo, ou nada)
        connection = await db.getConnection();
        await connection.query('START TRANSACTION');

        let total = 0;
        let dbItens = [];

        // 1. Validação de Produtos e Cálculo do Total
        for (const item of itens) {
            const [produtoRows] = await connection.execute(
                'SELECT preco, nome, disponivel FROM produtos WHERE id = ?', 
                [item.produto_id]
            );

            if (produtoRows.length === 0 || !produtoRows[0].disponivel) {
                await connection.query('ROLLBACK');
                return res.status(404).json({ message: `Produto ID ${item.produto_id} não encontrado ou indisponível.` });
            }

            const precoUnitario = produtoRows[0].preco;
            const quantidade = parseInt(item.quantidade);

            if (isNaN(quantidade) || quantidade <= 0) {
                 await connection.query('ROLLBACK');
                 return res.status(400).json({ message: `Quantidade inválida para o produto ID ${item.produto_id}.` });
            }

            total += precoUnitario * quantidade;
            dbItens.push({ ...item, preco_unitario: precoUnitario });
        }

        // 2. Criação do Pedido Principal
        const pedidoSql = `INSERT INTO ${TABLE} (comprador_id, total, endereco, status) VALUES (?, ?, ?, 'novo')`;
        const [pedidoResult] = await connection.execute(pedidoSql, [comprador_id, total, endereco]);
        const pedidoId = pedidoResult.insertId;

        // 3. Inserção dos Itens do Pedido
        const itemSql = `INSERT INTO ${ITEMS_TABLE} (pedido_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)`;
        
        for (const item of dbItens) {
            await connection.execute(itemSql, [pedidoId, item.produto_id, item.quantidade, item.preco_unitario]);
        }

        await connection.query('COMMIT'); // Finaliza a transação

        return res.status(201).json({
            message: 'Pedido criado com sucesso! Aguardando aceitação.',
            pedido_id: pedidoId,
            total: total.toFixed(2),
            status: 'novo'
        });

    } catch (error) {
        if (connection) await connection.query('ROLLBACK');
        console.error('Erro ao criar pedido:', error);
        return res.status(500).json({ message: 'Erro interno ao processar o pedido.' });
    } finally {
        if (connection) connection.release();
    }
});


// ====================================================================
// II. ROTAS DO COMPRADOR: VISUALIZAR
// ====================================================================

/**
 * @route GET /api/pedidos/meus
 * Lista todos os pedidos do comprador autenticado.
 */
pedidoRouter.get('/meus', compradorAuthMiddleware, async (req, res) => {
    const comprador_id = req.user.id;

    try {
        const sql = `
            SELECT id, total, status, created_at, endereco 
            FROM ${TABLE} 
            WHERE comprador_id = ? 
            ORDER BY created_at DESC
        `;
        const result = await db.query(sql, [comprador_id]);

        return res.status(200).json({
            message: 'Seus pedidos foram listados.',
            pedidos: result.rows
        });
    } catch (error) {
        console.error('Erro ao listar pedidos do comprador:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar pedidos.' });
    }
});

/**
 * @route GET /api/pedidos/meus/:id
 * Detalha um pedido específico do comprador.
 */
pedidoRouter.get('/meus/:id', compradorAuthMiddleware, async (req, res) => {
    const pedidoId = req.params.id;
    const comprador_id = req.user.id;

    try {
        // 1. Busca o pedido e verifica se pertence ao comprador
        const pedidoSql = `
            SELECT id, total, status, endereco, created_at 
            FROM ${TABLE} 
            WHERE id = ? AND comprador_id = ?
        `;
        const pedidoResult = await db.query(pedidoSql, [pedidoId, comprador_id]);

        if (pedidoResult.rows.length === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado ou você não tem permissão.' });
        }

        const pedido = pedidoResult.rows[0];

        // 2. Busca os itens do pedido
        const itensSql = `
            SELECT i.quantidade, i.preco_unitario, p.nome AS produto_nome 
            FROM ${ITEMS_TABLE} i
            JOIN produtos p ON i.produto_id = p.id
            WHERE i.pedido_id = ?
        `;
        const itensResult = await db.query(itensSql, [pedidoId]);

        pedido.itens = itensResult.rows;

        return res.status(200).json({ pedido });

    } catch (error) {
        console.error('Erro ao detalhar pedido:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar detalhes do pedido.' });
    }
});


// ====================================================================
// III. ROTAS DO ADMINISTRADOR: GESTÃO (CRUD BÁSICO E STATUS)
// ====================================================================

/**
 * @route GET /api/pedidos/admin (Lista todos os pedidos - Admin)
 * Acesso a todos os administradores ('funcionario', 'gerente', 'dono').
 */
pedidoRouter.get('/admin', adminAuthMiddleware, async (req, res) => {
    // Funcionários podem ver todos os pedidos para gerenciar
    
    try {
        const sql = `
            SELECT p.id, p.total, p.status, p.created_at, c.nome AS comprador_nome, p.endereco
            FROM ${TABLE} p
            JOIN compradores c ON p.comprador_id = c.id
            ORDER BY p.created_at DESC
        `;
        const result = await db.query(sql);

        return res.status(200).json({
            message: 'Lista completa de pedidos.',
            pedidos: result.rows
        });
    } catch (error) {
        console.error('Erro ao listar todos os pedidos:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar pedidos.' });
    }
});


/**
 * @route PUT /api/pedidos/admin/:id/status
 * Atualiza o status de um pedido. Acesso restrito a 'funcionario' ou superior.
 * Funcionalidades: aceitar, preparar, sair_entrega, entregue, cancelado.
 */
pedidoRouter.put('/admin/:id/status', 
    adminAuthMiddleware, 
    checkPermission('funcionario'), // Funcionários podem mudar status
    async (req, res) => {

    const pedidoId = req.params.id;
    const { novo_status } = req.body;

    const statusValidos = ['aceito', 'preparando', 'saiu_entrega', 'entregue', 'cancelado'];

    if (!novo_status || !statusValidos.includes(novo_status)) {
        return res.status(400).json({ message: `Status inválido. Use: ${statusValidos.join(', ')}` });
    }
    
    // Regra de Negócio Opcional: Impedir cancelamento após sair para entrega
    if (novo_status === 'cancelado') {
        const [pedidoRows] = await db.query('SELECT status FROM pedidos WHERE id = ?', [pedidoId]);
        if (pedidoRows.length > 0 && pedidoRows[0].status === 'saiu_entrega') {
            return res.status(403).json({ message: 'Não é possível cancelar um pedido que já saiu para entrega.' });
        }
    }


    try {
        const sql = `UPDATE ${TABLE} SET status = ? WHERE id = ?`;
        const result = await db.query(sql, [novo_status, pedidoId]);

        if (result.rows.affectedRows === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado.' });
        }

        // Se o status for 'cancelado', notificar comprador, etc.
        // Lógica de notificação (BREVO/email) seria implementada aqui.

        return res.status(200).json({ 
            message: `Status do pedido ${pedidoId} atualizado para: ${novo_status}.`,
            pedido_id: pedidoId,
            novo_status: novo_status
        });

    } catch (error) {
        console.error('Erro ao atualizar status do pedido:', error);
        return res.status(500).json({ message: 'Erro interno ao atualizar status.' });
    }
});


/**
 * @route DELETE /api/pedidos/admin/:id (Deletar Pedido)
 * Excluir um pedido. Acesso restrito a 'gerente' ou superior (geralmente não é permitido excluir, apenas cancelar).
 */
pedidoRouter.delete('/admin/:id', 
    adminAuthMiddleware, 
    checkPermission('gerente'), // Apenas Gerentes ou Donos podem deletar fisicamente
    async (req, res) => {
    
    const pedidoId = req.params.id;
    let connection;

    try {
        connection = await db.getConnection();
        await connection.query('START TRANSACTION');

        // 1. Deleta Itens do Pedido (Chave Estrangeira)
        await connection.execute(`DELETE FROM ${ITEMS_TABLE} WHERE pedido_id = ?`, [pedidoId]);

        // 2. Deleta o Pedido Principal
        const [pedidoResult] = await connection.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [pedidoId]);

        if (pedidoResult.affectedRows === 0) {
            await connection.query('ROLLBACK');
            return res.status(404).json({ message: 'Pedido não encontrado para exclusão.' });
        }

        await connection.query('COMMIT');
        return res.status(200).json({ message: 'Pedido e seus itens excluídos permanentemente.' });

    } catch (error) {
        if (connection) await connection.query('ROLLBACK');
        console.error('Erro ao deletar pedido:', error);
        return res.status(500).json({ message: 'Erro interno ao deletar pedido.' });
    } finally {
        if (connection) connection.release();
    }
});


module.exports = { pedidoRouter };
