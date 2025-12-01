// server.js

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); 

// Importa os roteadores de CADA ARQUIVO DO BACKEND
const { compradorRouter } = require('./compradorAuth');
const { adminRouter } = require('./adminAuth');
const { productRouter } = require('./productController');
const { pedidoRouter } = require('./pedidoController');

const app = express();
// Usa a porta do ambiente ou 3000 como padrão
const PORT = process.env.PORT || 3000; 

// ------------------------------------------------------------------
// MIDDLEWARES GLOBAIS
// ------------------------------------------------------------------

// Configuração CORS: Permite todas as origens (essencial para o frontend)
app.use(cors()); 

// Middleware para analisar corpos de requisição JSON
app.use(bodyParser.json());

// ------------------------------------------------------------------
// ROTAS DO SISTEMA
// ------------------------------------------------------------------

// Rotas de Autenticação
app.use('/api/comprador', compradorRouter);
app.use('/api/admin', adminRouter);

// Rotas de Gerenciamento de Dados
app.use('/api/produtos', productRouter); 
app.use('/api/pedidos', pedidoRouter);   

// Rota Raiz (Teste de Status)
app.get('/', (req, res) => {
    res.send('Servidor Node.js rodando! Rotas disponíveis: /api/comprador, /api/admin, /api/produtos, /api/pedidos.');
});

// ------------------------------------------------------------------
// INICIALIZAÇÃO
// ------------------------------------------------------------------

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
});
