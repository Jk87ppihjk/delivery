// server.js (Atualizado)

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); 

const { compradorRouter } = require('./compradorAuth');
const { adminRouter } = require('./adminAuth');
const { productRouter } = require('./productController'); // <-- NOVO: Importa o roteador de Produtos

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração CORS: Permite todas as origens
app.use(cors()); 

// Middlewares
app.use(bodyParser.json());

// Rotas de Autenticação
app.use('/api/comprador', compradorRouter);
app.use('/api/admin', adminRouter);

// Rotas de Gerenciamento
app.use('/api/produtos', productRouter); // <-- NOVO: Rota para Produtos

// Rota de Teste
app.get('/', (req, res) => {
    res.send('Servidor Node.js rodando! Use /api/comprador, /api/admin ou /api/produtos.');
});

// Inicia o Servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
});
